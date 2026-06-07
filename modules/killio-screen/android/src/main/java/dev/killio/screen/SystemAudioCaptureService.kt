package dev.killio.screen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.PowerManager
import kotlin.concurrent.thread

/**
 * MediaProjection-typed foreground service that captures DEVICE PLAYBACK audio
 * (the OTHER party in a call, a meeting, a video — anything coming out of the
 * speaker) via Android 10+ AudioPlaybackCapture, NOT the microphone.
 *
 * It records 16-bit mono PCM at the requested sample rate (default 16 kHz to
 * match the mic path in killio-capture / VaultCaptureService) and streams
 * fixed-size frames to JS through KillioScreenModule using the SAME event shape
 * as the mic frames ('onAudioFrame' { samples:IntArray, sampleRate:Int, ts }),
 * so the existing VAD/STT pipeline ingests playback audio unchanged.
 *
 * Token reuse: this service needs a MediaProjection token, which it obtains from
 * the (resultCode, resultData) consent extras acquired by KillioScreenModule's
 * existing ProjectionConsentActivity permission flow — the same consent used for
 * screen capture. No second system dialog.
 *
 * Android 14+ typed-FGS ordering: startForeground(type=mediaProjection) MUST be
 * called BEFORE getMediaProjection(), or the system throws SecurityException.
 *
 * SDK guard: AudioPlaybackCapture requires API 29 (Q). On older devices the
 * service emits an 'onError' and stops itself rather than crashing.
 */
class SystemAudioCaptureService : Service() {

  companion object {
    private const val CHANNEL_ID = "killio_vault_system_audio"
    private const val NOTIF_ID = 4713

    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    const val EXTRA_SAMPLE_RATE = "sampleRate"
    const val EXTRA_FRAME_SAMPLES = "frameSamples"
    const val EXTRA_NOTIFICATION_TEXT = "notificationText"

    /** Set by KillioScreenModule; (eventName, payload) → JS. Same emitter shape
     *  as VaultCaptureService so the existing pipeline ingests frames unchanged. */
    @Volatile var emitter: ((String, Bundle) -> Unit)? = null
  }

  @Volatile private var running = false
  private var worker: Thread? = null
  private var projection: MediaProjection? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val sampleRate = intent?.getIntExtra(EXTRA_SAMPLE_RATE, 16_000) ?: 16_000
    val frameSamples = intent?.getIntExtra(EXTRA_FRAME_SAMPLES, 320) ?: 320
    val notifText = intent?.getStringExtra(EXTRA_NOTIFICATION_TEXT)
      ?: "Killio Vault is capturing call audio"

    // (1) startForeground FIRST — Android 14 typed-FGS requirement before
    // getMediaProjection().
    startForegroundWithNotification(notifText)
    acquireWakeLock()

    // SDK guard: AudioPlaybackCapture is API 29+. Bail gracefully on older.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      emitError("System-audio capture requires Android 10 (API 29)+")
      stopSelf()
      return START_NOT_STICKY
    }

    val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
    val resultData: Intent? =
      if (Build.VERSION.SDK_INT >= 33) {
        intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
      } else {
        @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_RESULT_DATA)
      }

    // Guard: needs the MediaProjection consent token (from killio-screen's
    // permission flow). Bail gracefully (stopSelf) if absent — mirrors how the
    // mic FGS (VaultCaptureService) bails when RECORD_AUDIO is missing, so this
    // never crashes the app.
    if (resultData == null) {
      emitError("Missing MediaProjection consent — request screen-capture permission first")
      stopSelf()
      return START_NOT_STICKY
    }

    val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val mp: MediaProjection? = try {
      mpm.getMediaProjection(resultCode, resultData)
    } catch (t: Throwable) {
      emitError("getMediaProjection failed: ${t.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    if (mp == null) {
      emitError("MediaProjection is null (consent revoked?)")
      stopSelf()
      return START_NOT_STICKY
    }
    projection = mp

    // Required on Android 14+: register a callback before using the projection.
    mp.registerCallback(object : MediaProjection.Callback() {
      override fun onStop() {
        // System tore us down — stop the loop and the service.
        running = false
        stopSelf()
      }
    }, Handler(mainLooper))

    if (!running) {
      running = true
      worker = thread(start = true) { captureLoop(mp, sampleRate, frameSamples) }
    }
    return START_STICKY
  }

  private fun captureLoop(mp: MediaProjection, sampleRate: Int, frameSamples: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return

    val config = AudioPlaybackCaptureConfiguration.Builder(mp)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .addMatchingUsage(AudioAttributes.USAGE_GAME)
      .build()

    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(sampleRate)
      .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
      .build()

    val minBuf = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val bufSize = maxOf(minBuf, frameSamples * 2 * 4)

    val recorder = try {
      AudioRecord.Builder()
        .setAudioFormat(format)
        .setBufferSizeInBytes(bufSize)
        .setAudioPlaybackCaptureConfig(config)
        .build()
    } catch (e: SecurityException) {
      emitError("AudioPlaybackCapture denied: ${e.message}")
      stopSelf()
      return
    } catch (e: Exception) {
      emitError("AudioPlaybackCapture init failed: ${e.message}")
      stopSelf()
      return
    }

    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      emitError("AudioRecord (playback) failed to initialize")
      recorder.release()
      stopSelf()
      return
    }

    val frame = ShortArray(frameSamples)
    recorder.startRecording()
    try {
      while (running) {
        val read = recorder.read(frame, 0, frameSamples)
        if (read <= 0) continue
        val samples = IntArray(read) { frame[it].toInt() }
        val body = Bundle().apply {
          putIntArray("samples", samples)
          putInt("sampleRate", sampleRate)
          putDouble("ts", System.currentTimeMillis().toDouble())
        }
        emitter?.invoke("onAudioFrame", body)
      }
    } catch (e: Exception) {
      emitError(e.message ?: "system-audio capture error")
    } finally {
      try { recorder.stop() } catch (_: Exception) {}
      recorder.release()
    }
  }

  private fun emitError(message: String) {
    emitter?.invoke("onError", Bundle().apply { putString("message", message) })
  }

  /**
   * Hold a PARTIAL_WAKE_LOCK so the CPU keeps running with the screen off —
   * mirrors VaultCaptureService. Released in onDestroy().
   */
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(PowerManager::class.java)
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KillioVault:systemAudio").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: Exception) {}
    wakeLock = null
  }

  private fun startForegroundWithNotification(text: String) {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Killio Vault call audio",
        NotificationManager.IMPORTANCE_LOW,
      )
      nm.createNotificationChannel(channel)
    }
    val notification: Notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Killio Vault")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  override fun onDestroy() {
    running = false
    worker?.join(500)
    try { projection?.stop() } catch (_: Exception) {}
    projection = null
    releaseWakeLock()
    super.onDestroy()
  }
}
