package dev.killio.speech

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.SpeakerModel
import java.io.File
import java.io.FileOutputStream
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread

/**
 * Continuous, fully on-device speech recognition powered by Vosk (Kaldi).
 *
 * Replaces the previous Android SpeechRecognizer/RecognizerIntent core, which on
 * some devices (Samsung A34, es-ES) fired onStartOfSpeech but returned empty
 * results + NO_SPEECH_DETECTED every cycle because Google's offline Soda model
 * never transcribed. Vosk streams continuously from a raw AudioRecord PCM16 feed
 * — no per-utterance restart, no NO_SPEECH cycling, no Google/cloud dependency.
 *
 * Model strategy (offline guarantee): the small Spanish model (~39MB) is NOT
 * bundled in the APK. On first start it is downloaded once over HTTP into
 * filesDir/vosk-model-es/ and unzipped; every subsequent start loads it from
 * there with no network access. After the one-time fetch the engine is 100%
 * offline. If the download fails (e.g. no network on first run) we emit an error
 * event and stopSelf gracefully instead of crashing.
 *
 * Final transcripts are emitted to JS with a UTC timestamp, preserving the exact
 * event contract consumed by src/capture/CaptureController.ts:
 *   onTranscript { text: String, ts: Double (UTC ms) }
 *   onError      { message: String }
 */
class VaultSpeechService : Service() {
  companion object {
    @Volatile var emitter: ((String, Bundle) -> Unit)? = null
    private const val CHANNEL_ID = "killio_vault_speech"
    private const val NOTIF_ID = 4712
    private const val SAMPLE_RATE = 16_000
    private const val MODEL_DIR = "vosk-model-es"
    private const val MODEL_URL =
      "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip"

    // Speaker-identification model (~13MB). Loaded alongside the language model
    // and attached via recognizer.setSpeakerModel(); each final result then
    // carries a 128-dim "spk" x-vector we forward to JS for voice-ID. Same
    // download/unzip/offline pattern as the language model above.
    private const val SPK_MODEL_DIR = "vosk-model-spk"
    private const val SPK_MODEL_URL =
      "https://alphacephei.com/vosk/models/vosk-model-spk-0.4.zip"

    /** True once the model has been downloaded + unzipped into filesDir. */
    fun isModelPresent(ctx: android.content.Context): Boolean =
      modelRoot(File(ctx.filesDir, MODEL_DIR)) != null

    /**
     * Vosk needs the directory that directly contains the model files (am/, conf/,
     * graph/, ivector/ …). The zip unpacks into a versioned subfolder
     * (vosk-model-small-es-0.42/), so resolve to whichever dir holds conf/mfcc.conf.
     */
    private fun modelRoot(base: File): File? {
      if (!base.isDirectory) return null
      if (File(base, "conf/mfcc.conf").exists() || File(base, "am/final.mdl").exists()) {
        return base
      }
      base.listFiles()?.forEach { child ->
        if (child.isDirectory &&
          (File(child, "conf/mfcc.conf").exists() || File(child, "am/final.mdl").exists())
        ) {
          return child
        }
      }
      return null
    }

    /**
     * The speaker model zip unpacks into a versioned subfolder
     * (vosk-model-spk-0.4/) whose loadable dir contains `final.ext` (the
     * x-vector extractor) plus mean/transform files — it has no conf/mfcc.conf,
     * so it needs its own marker-file resolver.
     */
    private fun spkModelRoot(base: File): File? {
      if (!base.isDirectory) return null
      if (File(base, "final.ext").exists() || File(base, "mean").exists()) {
        return base
      }
      base.listFiles()?.forEach { child ->
        if (child.isDirectory &&
          (File(child, "final.ext").exists() || File(child, "mean").exists())
        ) {
          return child
        }
      }
      return null
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var worker: Thread? = null
  @Volatile private var running = false

  @Volatile private var model: Model? = null
  @Volatile private var spkModel: SpeakerModel? = null
  @Volatile private var recognizer: Recognizer? = null
  @Volatile private var audioRecord: AudioRecord? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notifText = intent?.getStringExtra("notificationText") ?: "Killio Vault is listening"

    // Starting a microphone-typed foreground service without RECORD_AUDIO granted
    // throws SecurityException and crashes the whole app (Android 14+). On a fresh
    // install the runtime permission isn't granted yet, so bail gracefully — JS
    // re-starts capture once the user grants the mic. (KEPT from prior impl.)
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      stopSelf()
      return START_NOT_STICKY
    }

    startForegroundWithNotification(notifText)
    acquireWakeLock()

    if (!running) {
      running = true
      // Model load + (first-run) download + the AudioRecord read loop all run off
      // the main thread. Vosk decoding is CPU-bound and the download can block.
      worker = thread(start = true) { recognitionLoop() }
    }
    return START_STICKY
  }

  /**
   * PARTIAL_WAKE_LOCK keeps the CPU alive so the AudioRecord→Vosk loop keeps
   * decoding with the screen off. Without it Doze suspends the worker within
   * seconds of the display turning off and 24/7 capture stops. (KEPT.)
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

  /**
   * Emit a model lifecycle update to JS via the shared emitter. Mirrors the
   * onTranscript/onError contract — a single `onModelStatus` event carrying a
   * `state` string plus optional progress fields. States:
   *   downloading { progress:Int 0..100, bytes:Long, total:Long }
   *   preparing   (indeterminate — unzip in progress)
   *   ready       (model present + recognizer created)
   *   error       { message:String }
   */
  private fun emitModelStatus(state: String, progress: Int = -1, bytes: Long = -1, total: Long = -1, message: String? = null) {
    emitter?.invoke("onModelStatus", Bundle().apply {
      putString("state", state)
      if (progress >= 0) putInt("progress", progress)
      if (bytes >= 0) putLong("bytes", bytes)
      if (total >= 0) putLong("total", total)
      if (message != null) putString("message", message)
    })
  }

  /** Worker body: ensure model → open AudioRecord → stream PCM16 into Vosk. */
  private fun recognitionLoop() {
    val modelRoot = try {
      ensureModel()
    } catch (e: Exception) {
      emitError("Vosk model unavailable (offline first run?): ${e.message}")
      stopSelf()
      return
    }
    if (modelRoot == null) {
      emitError("Vosk model could not be prepared")
      stopSelf()
      return
    }

    val m: Model = try {
      Model(modelRoot.absolutePath)
    } catch (e: Exception) {
      emitError("Failed to load Vosk model: ${e.message}")
      stopSelf()
      return
    }
    model = m
    Log.i("KillioVosk", "Model loaded from ${modelRoot.absolutePath}")

    val rec: Recognizer = try {
      Recognizer(m, SAMPLE_RATE.toFloat())
    } catch (e: Exception) {
      emitError("Failed to create Vosk recognizer: ${e.message}")
      stopSelf()
      return
    }
    recognizer = rec

    // Attach the speaker model (best-effort). When present, every final result
    // gains a 128-dim "spk" x-vector we forward to JS for owner voice-ID. If it
    // can't be downloaded/loaded (e.g. offline first run with no spk zip yet),
    // STT keeps working — we simply emit transcripts without an spk vector.
    try {
      val spkRoot = ensureSpkModel()
      if (spkRoot != null) {
        val sm = SpeakerModel(spkRoot.absolutePath)
        spkModel = sm
        rec.setSpeakerModel(sm)
        Log.i("KillioVosk", "Speaker model loaded from ${spkRoot.absolutePath}")
      } else {
        Log.w("KillioVosk", "Speaker model unavailable — continuing without voice-ID")
      }
    } catch (e: Exception) {
      Log.w("KillioVosk", "Speaker model load failed (continuing without voice-ID): ${e.message}")
    }

    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    // ~0.2s of 16kHz mono PCM16 per read, but never below the device minimum.
    val frameSamples = maxOf(minBuf / 2, SAMPLE_RATE / 5)
    val bufSize = maxOf(minBuf, frameSamples * 2)

    val recorder = try {
      AudioRecord(
        MediaRecorder.AudioSource.MIC,
        SAMPLE_RATE,
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
      recorder.release()
      stopSelf()
      return
    }
    audioRecord = recorder

    val buf = ShortArray(frameSamples)
    recorder.startRecording()
    // Model present + recognizer created + mic streaming → tell the UI the
    // download/prepare phase is over so it can hide any progress banner.
    emitModelStatus("ready")
    Log.i("KillioVosk", "Recognizer ready, AudioRecord started (16kHz) — listening loop running")
    try {
      while (running) {
        val read = recorder.read(buf, 0, frameSamples)
        if (read <= 0) continue
        // acceptWaveForm returns true at an utterance boundary → final result.
        if (rec.acceptWaveForm(buf, read)) {
          emitFinal(rec.result)
        }
        // (Partial results are intentionally not emitted — the diary only needs
        // finals, and finals keep the JS contract + wake-word scan simple.)
      }
      // Flush any tail utterance still buffered when stop() is requested.
      emitFinal(rec.finalResult)
    } catch (e: Exception) {
      if (running) emitError(e.message ?: "recognition error")
    } finally {
      try { recorder.stop() } catch (_: Exception) {}
      recorder.release()
    }
  }

  /**
   * Parse Vosk's result JSON and emit it (if non-empty) to JS. With a speaker
   * model attached the JSON also carries `"spk": [..128 floats..]` — the
   * utterance x-vector. We JSON-encode that array back into a string field
   * `spk` on the Bundle (keeps the Bundle simple; JS parses it) so the capture
   * layer can compare it to the enrolled owner voiceprint.
   */
  private fun emitFinal(json: String?) {
    if (json.isNullOrBlank()) return
    val obj = try {
      JSONObject(json)
    } catch (_: Exception) {
      null
    } ?: return
    val text = obj.optString("text").trim()
    if (text.isEmpty()) return

    Log.i("KillioVosk", "TRANSCRIPT: $text")
    emitter?.invoke("onTranscript", Bundle().apply {
      putString("text", text)
      putDouble("ts", System.currentTimeMillis().toDouble())
      // Forward the speaker x-vector as a JSON array string when present.
      val spk: JSONArray? = obj.optJSONArray("spk")
      if (spk != null && spk.length() > 0) {
        putString("spk", spk.toString())
      }
    })
  }

  /**
   * Return the loadable model directory, downloading + unzipping it on first run.
   * Idempotent: if a valid model already exists on disk we skip the network call
   * entirely (the offline guarantee). Runs on the worker thread.
   */
  private fun ensureModel(): File? {
    val base = File(filesDir, MODEL_DIR)
    modelRoot(base)?.let {
      // Cached path: no download bar — the model is already on disk. The UI
      // will get the definitive "ready" once the recognizer is up.
      Log.i("KillioVosk", "Model already present (offline) at ${it.absolutePath}")
      emitModelStatus("ready")
      return it
    }

    // First run (or a previous partial download): (re)fetch the zip.
    Log.i("KillioVosk", "Model not found — downloading $MODEL_URL (first run only)")
    base.deleteRecursively()
    base.mkdirs()

    val tmpZip = File(filesDir, "$MODEL_DIR.download.zip")
    if (tmpZip.exists()) tmpZip.delete()

    val conn = (URL(MODEL_URL).openConnection() as HttpURLConnection).apply {
      connectTimeout = 20_000
      readTimeout = 60_000
      requestMethod = "GET"
    }
    try {
      conn.connect()
      if (conn.responseCode != HttpURLConnection.HTTP_OK) {
        throw java.io.IOException("HTTP ${conn.responseCode} fetching model")
      }
      val total = conn.contentLength.toLong() // -1 if the server omits Content-Length
      // Manual read loop (replaces input.copyTo) so we can track bytesRead vs
      // total and emit onModelStatus progress. Throttled to ~every 1% OR 500ms
      // so we don't flood the JS bridge during the ~39MB fetch.
      emitModelStatus("downloading", progress = 0, bytes = 0, total = if (total > 0) total else -1)
      conn.inputStream.use { input ->
        FileOutputStream(tmpZip).use { out ->
          val buffer = ByteArray(64 * 1024)
          var downloaded = 0L
          var lastPct = -1
          var lastEmit = 0L
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            downloaded += n
            val pct = if (total > 0) ((downloaded * 100L) / total).toInt().coerceIn(0, 100) else -1
            val now = System.currentTimeMillis()
            if ((pct >= 0 && pct != lastPct) || now - lastEmit >= 500L) {
              lastPct = pct
              lastEmit = now
              emitModelStatus("downloading", progress = pct, bytes = downloaded, total = if (total > 0) total else -1)
            }
          }
          emitModelStatus("downloading", progress = 100, bytes = downloaded, total = if (total > 0) total else downloaded)
        }
      }
    } finally {
      conn.disconnect()
    }

    Log.i("KillioVosk", "Download done (${tmpZip.length()} bytes) — unzipping")
    // Unzip is non-trivial for a ~39MB archive — flag it as an indeterminate
    // "preparing" phase so the banner switches off the percentage bar.
    emitModelStatus("preparing")
    unzip(tmpZip, base)
    tmpZip.delete()
    Log.i("KillioVosk", "Model unzipped + ready")

    return modelRoot(base)
  }

  /**
   * Speaker model counterpart to ensureModel(). Idempotent + offline after the
   * one-time ~13MB fetch. Reuses the same download bar (onModelStatus) so the
   * UI shows a single combined "preparing voice model" experience. Returns null
   * (rather than throwing) on failure so the caller can degrade to STT-only.
   */
  private fun ensureSpkModel(): File? {
    val base = File(filesDir, SPK_MODEL_DIR)
    spkModelRoot(base)?.let {
      Log.i("KillioVosk", "Speaker model already present (offline) at ${it.absolutePath}")
      return it
    }

    Log.i("KillioVosk", "Speaker model not found — downloading $SPK_MODEL_URL (first run only)")
    base.deleteRecursively()
    base.mkdirs()

    val tmpZip = File(filesDir, "$SPK_MODEL_DIR.download.zip")
    if (tmpZip.exists()) tmpZip.delete()

    val conn = (URL(SPK_MODEL_URL).openConnection() as HttpURLConnection).apply {
      connectTimeout = 20_000
      readTimeout = 60_000
      requestMethod = "GET"
    }
    try {
      conn.connect()
      if (conn.responseCode != HttpURLConnection.HTTP_OK) {
        throw java.io.IOException("HTTP ${conn.responseCode} fetching speaker model")
      }
      val total = conn.contentLength.toLong()
      emitModelStatus("downloading", progress = 0, bytes = 0, total = if (total > 0) total else -1)
      conn.inputStream.use { input ->
        FileOutputStream(tmpZip).use { out ->
          val buffer = ByteArray(64 * 1024)
          var downloaded = 0L
          var lastPct = -1
          var lastEmit = 0L
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            downloaded += n
            val pct = if (total > 0) ((downloaded * 100L) / total).toInt().coerceIn(0, 100) else -1
            val now = System.currentTimeMillis()
            if ((pct >= 0 && pct != lastPct) || now - lastEmit >= 500L) {
              lastPct = pct
              lastEmit = now
              emitModelStatus("downloading", progress = pct, bytes = downloaded, total = if (total > 0) total else -1)
            }
          }
        }
      }
    } catch (e: Exception) {
      // Voice-ID is opt-in/best-effort — don't fail the whole STT session.
      Log.w("KillioVosk", "Speaker model download failed: ${e.message}")
      return null
    } finally {
      conn.disconnect()
    }

    Log.i("KillioVosk", "Speaker model download done (${tmpZip.length()} bytes) — unzipping")
    emitModelStatus("preparing")
    try {
      unzip(tmpZip, base)
    } catch (e: Exception) {
      Log.w("KillioVosk", "Speaker model unzip failed: ${e.message}")
      return null
    } finally {
      tmpZip.delete()
    }
    Log.i("KillioVosk", "Speaker model unzipped + ready")
    return spkModelRoot(base)
  }

  /** Plain java.util.zip unzip (no extra deps), guarded against path traversal. */
  private fun unzip(zip: File, dest: File) {
    ZipInputStream(zip.inputStream().buffered()).use { zis ->
      var entry = zis.nextEntry
      val destPath = dest.canonicalPath
      while (entry != null) {
        val outFile = File(dest, entry.name)
        if (!outFile.canonicalPath.startsWith(destPath)) {
          throw java.io.IOException("Zip entry escapes target dir: ${entry.name}")
        }
        if (entry.isDirectory) {
          outFile.mkdirs()
        } else {
          outFile.parentFile?.mkdirs()
          FileOutputStream(outFile).use { out -> zis.copyTo(out, 64 * 1024) }
        }
        zis.closeEntry()
        entry = zis.nextEntry
      }
    }
  }

  private fun emitError(message: String) {
    Log.e("KillioVosk", "ERROR: $message")
    emitter?.invoke("onError", Bundle().apply { putString("message", message) })
    // Also surface as a model-status error so a progress banner watching
    // onModelStatus can replace the bar with the failure message.
    emitModelStatus("error", message = message)
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
    // Stop the worker loop, then release native resources it owns.
    worker?.join(800)
    worker = null
    try { audioRecord?.let { if (it.state == AudioRecord.STATE_INITIALIZED) it.release() } } catch (_: Exception) {}
    audioRecord = null
    try { recognizer?.close() } catch (_: Exception) {}
    recognizer = null
    try { model?.close() } catch (_: Exception) {}
    model = null
    try { spkModel?.close() } catch (_: Exception) {}
    spkModel = null
    super.onDestroy()
  }
}
