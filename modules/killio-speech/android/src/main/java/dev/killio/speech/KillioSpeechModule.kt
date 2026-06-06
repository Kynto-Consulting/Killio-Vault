package dev.killio.speech

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Free, credential-less on-device STT using Android's SpeechRecognizer, run in a
 * foreground service so the diary keeps transcribing with the screen locked.
 *
 * JS API (src/stt/native/KillioSpeech.ts):
 *   isRecognitionAvailable() -> Boolean
 *   start({ language, notificationText, preferOffline }) -> Promise
 *   stop() -> Promise
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

    Events("onTranscript", "onError")

    OnCreate {
      VaultSpeechService.emitter = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      VaultSpeechService.emitter = null
    }

    Function("isRecognitionAvailable") {
      val ctx: Context? = appContext.reactContext
      ctx != null && SpeechRecognizer.isRecognitionAvailable(ctx)
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

    // One-shot recognition for push-to-talk in the assistant. Resolves with the
    // recognized text (or '' if nothing heard); rejects on hard errors.
    AsyncFunction("recognizeOnce") { language: String, promise: Promise ->
      val ctx: Context? = appContext.reactContext
      if (ctx == null) {
        promise.reject("no_context", "No React context", null)
        return@AsyncFunction
      }
      Handler(Looper.getMainLooper()).post {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
          promise.reject("unavailable", "Speech recognition not available", null)
          return@post
        }
        val recognizer = SpeechRecognizer.createSpeechRecognizer(ctx)
        var settled = false
        fun finish(text: String?, errCode: String?) {
          if (settled) return
          settled = true
          try { recognizer.destroy() } catch (_: Exception) {}
          if (errCode != null) promise.reject(errCode, errCode, null)
          else promise.resolve(text ?: "")
        }
        recognizer.setRecognitionListener(object : RecognitionListener {
          override fun onResults(results: Bundle?) {
            val text = results
              ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
              ?.firstOrNull()
              ?.trim()
            finish(text, null)
          }
          override fun onError(error: Int) {
            // No-match / timeout → resolve empty (user said nothing).
            if (error == SpeechRecognizer.ERROR_NO_MATCH ||
                error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
              finish("", null)
            } else {
              finish(null, "stt_error_$error")
            }
          }
          override fun onReadyForSpeech(params: Bundle?) {}
          override fun onBeginningOfSpeech() {}
          override fun onRmsChanged(rmsdB: Float) {}
          override fun onBufferReceived(buffer: ByteArray?) {}
          override fun onEndOfSpeech() {}
          override fun onPartialResults(partialResults: Bundle?) {}
          override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        try {
          recognizer.startListening(intent)
        } catch (e: Exception) {
          finish(null, "start_failed")
        }
      }
      // Handler.post() returns Boolean; pin the lambda to Unit so it matches
      // the early no-context return path.
      Unit
    }
  }
}
