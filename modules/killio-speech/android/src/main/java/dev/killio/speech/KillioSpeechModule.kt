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
 * Free, credential-less, fully offline on-device STT powered by Vosk, run in a
 * foreground service so the diary keeps transcribing with the screen locked.
 * Both the 24/7 capture (start/stop) and the push-to-talk one-shot
 * (recognizeOnce) use the SAME Vosk engine (VaultSpeechService) — never Android's
 * SpeechRecognizer, whose offline Soda model returned empty/NO_SPEECH.
 *
 * JS API (src/stt/native/KillioSpeech.ts):
 *   isRecognitionAvailable() -> Boolean
 *   start({ language, notificationText, preferOffline }) -> Promise
 *   stop() -> Promise
 *   recognizeOnce(language) -> Promise<String>   // offline Vosk one-shot
 *   events: onTranscript { text:String, ts:Double }, onError { message:String }
 */
class SpeechStartOptions : Record {
  @Field var language: String = "es-ES"
  @Field var notificationText: String = "Killio Vault is listening"
  @Field var preferOffline: Boolean = true
}

class KillioSpeechModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KillioSpeech")

    Events("onTranscript", "onError", "onModelStatus")

    OnCreate {
      VaultSpeechService.emitter = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      VaultSpeechService.emitter = null
    }

    // Vosk runs fully on-device; recognition is "available" as long as we have a
    // context (the model is fetched on first start()). We OR in an explicit
    // model-present check for clarity, but Vosk needs no system recognizer.
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
