package dev.killio.capture

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.core.content.ContextCompat
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import kotlin.concurrent.thread

/**
 * Microphone foreground service. Records 16-bit mono PCM via AudioRecord and
 * streams fixed-size frames to JS through KillioCaptureModule. Runs with the
 * screen locked (typed FGS: microphone).
 */
class VaultCaptureService : Service() {
  companion object {
    /** Set by KillioCaptureModule; (eventName, payload) → JS. */
    @Volatile var emitter: ((String, Bundle) -> Unit)? = null
    private const val CHANNEL_ID = "killio_vault_capture"
    private const val NOTIF_ID = 4711
  }

  @Volatile private var running = false
  private var worker: Thread? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val sampleRate = intent?.getIntExtra("sampleRate", 16_000) ?: 16_000
    val frameSamples = intent?.getIntExtra("frameSamples", 320) ?: 320
    val notifText = intent?.getStringExtra("notificationText") ?: "Killio Vault is listening"

    // RECORD_AUDIO required before a microphone-typed FGS — otherwise Android 14+
    // throws SecurityException and crashes the app. Bail gracefully if not yet
    // granted (fresh install); JS re-starts capture after the user grants mic.
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      stopSelf()
      return START_NOT_STICKY
    }

    startForegroundWithNotification(notifText)
    acquireWakeLock()
    if (!running) {
      running = true
      worker = thread(start = true) { recordLoop(sampleRate, frameSamples) }
    }
    return START_STICKY
  }

  private fun recordLoop(sampleRate: Int, frameSamples: Int) {
    val minBuf = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val bufSize = maxOf(minBuf, frameSamples * 2 * 4)
    val recorder = try {
      AudioRecord(
        MediaRecorder.AudioSource.MIC,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize,
      )
    } catch (e: SecurityException) {
      emitError("Microphone permission denied")
      stopSelf()
      return
    }

    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      emitError("AudioRecord failed to initialize")
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
      emitError(e.message ?: "capture error")
    } finally {
      try { recorder.stop() } catch (_: Exception) {}
      recorder.release()
    }
  }

  private fun emitError(message: String) {
    emitter?.invoke("onError", Bundle().apply { putString("message", message) })
  }

  /**
   * Hold a PARTIAL_WAKE_LOCK so the CPU keeps running with the screen off.
   * Without this the recording thread is suspended under Doze within seconds of
   * the display turning off, killing 24/7 capture. The lock is released in
   * onDestroy(). No timeout — the foreground service is the lifecycle bound.
   */
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(PowerManager::class.java)
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KillioVault:capture").apply {
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
        "Killio Vault capture",
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
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  override fun onDestroy() {
    running = false
    worker?.join(500)
    releaseWakeLock()
    super.onDestroy()
  }
}
