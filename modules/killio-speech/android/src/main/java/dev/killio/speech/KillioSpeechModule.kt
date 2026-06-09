package dev.killio.speech

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlin.concurrent.thread

/**
 * Free, credential-less, fully offline on-device STT powered by Sherpa-ONNX
 * (k2-fsa, Apache-2.0 — no API key, no usage limits), run in a foreground
 * service so the diary keeps transcribing with the screen locked. Both the 24/7
 * capture (start/stop) and the push-to-talk one-shot (recognizeOnce) use the
 * SAME sherpa-onnx engine (VaultSpeechService) — never Android's SpeechRecognizer,
 * whose offline Soda model returned empty/NO_SPEECH. (Migrated from Vosk; the JS
 * event contract is unchanged.)
 *
 * JS API (src/stt/native/KillioSpeech.ts):
 *   isRecognitionAvailable() -> Boolean
 *   start({ language, notificationText, preferOffline }) -> Promise
 *   stop() -> Promise
 *   recognizeOnce(language) -> Promise<String>   // offline sherpa-onnx one-shot
 *   events: onTranscript { text:String, ts:Double }, onError { message:String }
 */
class SpeechStartOptions : Record {
  @Field var language: String = "es-ES"
  @Field var notificationText: String = "Killio Vault is listening"
  @Field var preferOffline: Boolean = true
  /** Wake keywords (agent names + custom wake phrases). Built-in "hey/oye
   *  killio" are always added natively. Detected DIRECTLY from audio by the
   *  sherpa-onnx KeywordSpotter (no transcript), so the brand name triggers
   *  reliably despite the Spanish ASR mis-transcribing it. */
  @Field var keywords: List<String> = emptyList()
}

class KillioSpeechModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KillioSpeech")

    Events("onTranscript", "onError", "onModelStatus", "onWake")

    OnCreate {
      VaultSpeechService.emitter = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      VaultSpeechService.emitter = null
    }

    // sherpa-onnx runs fully on-device; recognition is "available" as long as we
    // have a context (the model is fetched on first start()). We OR in an explicit
    // model-present check for clarity, but sherpa-onnx needs no system recognizer.
    Function("isRecognitionAvailable") {
      val ctx: Context? = appContext.reactContext
      ctx != null && (VaultSpeechService.isModelPresent(ctx) || true)
    }

    AsyncFunction("start") { options: SpeechStartOptions ->
      val ctx: Context = appContext.reactContext
        ?: throw IllegalStateException("No React context")
      // Persist enabled-state + language so BootReceiver can resume capture
      // after a reboot (RECEIVE_BOOT_COMPLETED).
      ctx.getSharedPreferences(BootReceiver.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(BootReceiver.KEY_ENABLED, true)
        .putString(BootReceiver.KEY_LANGUAGE, options.language)
        .apply()
      val intent = Intent(ctx, VaultSpeechService::class.java).apply {
        putExtra("language", options.language)
        putExtra("notificationText", options.notificationText)
        putExtra("preferOffline", options.preferOffline)
        // Wake keywords for the on-device KeywordSpotter. Re-delivering start()
        // with a new list hot-swaps the keyword set live (the service reads this
        // extra on every onStartCommand and reloads without a full restart).
        putExtra("keywords", options.keywords.toTypedArray())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      // Explicit Unit — startForegroundService/startService return a
      // ComponentName/Boolean, which Expo cannot serialize ("Unknown type: class
      // android.content.ComponentName") and would REJECT the call → JS sees the
      // 24/7 capture as status='error' even though the Vosk FGS actually started.
      Unit
    }

    AsyncFunction("stop") {
      val ctx: Context? = appContext.reactContext
      if (ctx != null) {
        // Clear the boot-resume flag so we don't auto-restart after the user
        // explicitly stopped capture.
        ctx.getSharedPreferences(BootReceiver.PREFS, Context.MODE_PRIVATE)
          .edit()
          .putBoolean(BootReceiver.KEY_ENABLED, false)
          .apply()
        ctx.stopService(Intent(ctx, VaultSpeechService::class.java))
      }
      // Explicit Unit — stopService() returns Boolean and would otherwise make
      // Kotlin infer a non-Unit lambda type, clashing with the no-context path.
      Unit
    }

    // Reload the wake keywords live without restarting capture. Re-delivers a
    // start Intent carrying the new keyword list; VaultSpeechService reads the
    // "keywords" extra on every onStartCommand and hot-swaps the KeywordSpotter
    // stream on its next loop iteration (cheap — no service/model rebuild). If
    // capture isn't running this is a no-op start that simply (re)launches it
    // with the right keywords. Built-in "hey/oye killio" are always merged in.
    AsyncFunction("setKeywords") { keywords: List<String> ->
      val ctx: Context = appContext.reactContext
        ?: throw IllegalStateException("No React context")
      val intent = Intent(ctx, VaultSpeechService::class.java).apply {
        putExtra("keywords", keywords.toTypedArray())
        putExtra("keywordsReloadOnly", true)
      }
      // Plain startService (NOT startForegroundService): this only delivers a new
      // onStartCommand to the ALREADY-RUNNING foreground service (which hot-swaps
      // its keywords). If capture isn't running the call is a harmless no-op
      // (background startService throws on O+, swallowed) — we never want
      // setKeywords to spin up capture the user has turned off.
      try {
        ctx.startService(intent)
      } catch (e: Exception) {
        // Service not running / background-start disallowed — keywords will be
        // applied on the next real start() instead.
      }
      Unit
    }

    // One-shot push-to-talk recognition using the SAME offline Vosk engine as
    // 24/7 capture (VaultSpeechService) — NOT Android's SpeechRecognizer, whose
    // offline Soda model returns empty/NO_SPEECH on the target devices.
    //
    // Resolves with the recognized text (or '' if nothing was heard); rejects
    // only on hard errors (no mic permission, model load / AudioRecord failure).
    // Runs entirely off the main thread (model open + blocking AudioRecord read
    // loop). If the 24/7 capture service is running, the one-shot transparently
    // pauses it for the duration so the mic isn't double-opened, then resumes.
    AsyncFunction("recognizeOnce") { language: String, promise: Promise ->
      val ctx: Context? = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "No React context", null)
        return@AsyncFunction
      }
      // RECORD_AUDIO guard — without it AudioRecord throws SecurityException.
      if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO)
          != PackageManager.PERMISSION_GRANTED) {
        promise.reject("no_mic_permission", "RECORD_AUDIO not granted", null)
        return@AsyncFunction
      }
      thread(start = true) {
        try {
          val text = VaultSpeechService.recognizeOnceBlocking(ctx, language)
          promise.resolve(text)
        } catch (e: Exception) {
          promise.reject("recognize_failed", e.message ?: "one-shot recognition failed", e)
        }
      }
      Unit
    }
  }
}
