package dev.killio.speech

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Continuous on-device speech recognition. SpeechRecognizer transcribes one
 * utterance then stops, so we restart it on every result/error to approximate a
 * 24/7 stream. Offline is preferred (no network / credentials). Final
 * transcripts are emitted with a UTC timestamp straight to JS.
 */
class VaultSpeechService : Service() {
  companion object {
    @Volatile var emitter: ((String, Bundle) -> Unit)? = null
    private const val CHANNEL_ID = "killio_vault_speech"
    private const val NOTIF_ID = 4712
  }

  private var recognizer: SpeechRecognizer? = null
  private val main = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  @Volatile private var running = false
  private var language = "es-ES"
  private var preferOffline = true

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    language = intent?.getStringExtra("language") ?: "es-ES"
    preferOffline = intent?.getBooleanExtra("preferOffline", true) ?: true
    val notifText = intent?.getStringExtra("notificationText") ?: "Killio Vault is listening"

    startForegroundWithNotification(notifText)
    acquireWakeLock()

    if (!running) {
      running = true
      main.post { initRecognizer() }
    }
    return START_STICKY
  }

  /**
   * PARTIAL_WAKE_LOCK keeps the CPU alive so SpeechRecognizer keeps restarting
   * and transcribing with the screen off. Without it Doze suspends the service
   * loop within seconds of the display turning off and 24/7 capture stops.
   */
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(PowerManager::class.java)
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KillioVault:speech").apply {
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

  private fun initRecognizer() {
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      emitError("Speech recognition not available on this device")
      stopSelf()
      return
    }
    recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
      setRecognitionListener(listener)
    }
    startListening()
  }

  private fun recognizerIntent(): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(
        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
      )
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
      }
    }

  private fun startListening() {
    if (!running) return
    try {
      recognizer?.startListening(recognizerIntent())
    } catch (e: Exception) {
      scheduleRestart(800)
    }
  }

  /** Recreate-and-restart after a short delay (debounces error storms). */
  private fun scheduleRestart(delayMs: Long) {
    if (!running) return
    main.postDelayed({
      if (running) {
        try { recognizer?.cancel() } catch (_: Exception) {}
        startListening()
      }
    }, delayMs)
  }

  private val listener = object : RecognitionListener {
    override fun onResults(results: Bundle?) {
      val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
      val text = list?.firstOrNull()?.trim().orEmpty()
      if (text.isNotEmpty()) {
        emitter?.invoke("onTranscript", Bundle().apply {
          putString("text", text)
          putDouble("ts", System.currentTimeMillis().toDouble())
        })
      }
      scheduleRestart(150)
    }

    override fun onError(error: Int) {
      // ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT are normal in silence — just restart.
      val backoff = when (error) {
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> 1200L
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> 2000L
        else -> 400L
      }
      scheduleRestart(backoff)
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onPartialResults(partialResults: Bundle?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun emitError(message: String) {
    emitter?.invoke("onError", Bundle().apply { putString("message", message) })
  }

  private fun startForegroundWithNotification(text: String) {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Killio Vault speech", NotificationManager.IMPORTANCE_LOW),
      )
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
    releaseWakeLock()
    main.post {
      try { recognizer?.destroy() } catch (_: Exception) {}
      recognizer = null
    }
    super.onDestroy()
  }
}
