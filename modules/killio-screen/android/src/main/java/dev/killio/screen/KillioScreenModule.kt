package dev.killio.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Options for startSystemAudioCapture(); mirrors KillioCapture's StartOptions. */
class SystemAudioStartOptions : Record {
  @Field var sampleRate: Int = 16_000
  @Field var frameSamples: Int = 320
  @Field var notificationText: String = "Killio Vault is capturing call audio"
}

/**
 * Expo module bridging JS ↔ Android MediaProjection screen capture.
 *
 * JS API (see src/screen/ScreenCapture.ts):
 *   requestPermission(): Promise<boolean>   — shows the consent dialog
 *   capture(): Promise<{ id, uri, ts, width, height }>
 *   list(): Promise<Screenshot[]>            — local, most-recent first
 *
 * Permission flow:
 *   1) requestPermission() launches ProjectionConsentActivity (transparent).
 *   2) The activity finishes immediately after the user grants/denies.
 *   3) (resultCode, data) get cached statically here so capture() can spin up
 *      the foreground service without re-prompting.
 *
 * Capture flow (Android 14+ typed FGS ordering):
 *   ScreenCaptureService.startForeground(type=mediaProjection) MUST be called
 *   before getMediaProjection(resultCode, data) — otherwise SecurityException.
 */
class KillioScreenModule : Module() {

  companion object {
    @Volatile private var resultCode: Int = Activity.RESULT_CANCELED
    @Volatile private var resultData: Intent? = null

    @Volatile private var pendingConsent: ((Boolean) -> Unit)? = null

    /** Called by ProjectionConsentActivity after the system dialog resolves. */
    fun onConsentResult(code: Int, data: Intent?) {
      if (code == Activity.RESULT_OK && data != null) {
        resultCode = code
        resultData = data
      } else {
        resultCode = Activity.RESULT_CANCELED
        resultData = null
      }
      val cb = pendingConsent
      pendingConsent = null
      try { cb?.invoke(resultCode == Activity.RESULT_OK && resultData != null) } catch (_: Throwable) {}
    }

    fun hasConsent(): Boolean =
      resultCode == Activity.RESULT_OK && resultData != null
  }

  override fun definition() = ModuleDefinition {
    Name("KillioScreen")

    // Same event names/shape as KillioCapture so the existing VAD/STT pipeline
    // (CaptureController.handleFrame) ingests system-audio frames unchanged:
    //   onAudioFrame { samples:Int[], sampleRate:Int, ts:Double }
    //   onError      { message:String }
    Events("onAudioFrame", "onError")

    OnCreate {
      // Let SystemAudioCaptureService push frames/errors back through JS.
      SystemAudioCaptureService.emitter = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      SystemAudioCaptureService.emitter = null
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      try {
        val ctx: Context = appContext.reactContext
          ?: throw CodedException("E_NO_CONTEXT", "No React context", null)
        if (hasConsent()) {
          promise.resolve(true)
          return@AsyncFunction
        }
        // Only one pending request at a time; replace any prior pending callback.
        pendingConsent = { granted -> promise.resolve(granted) }
        ProjectionConsentActivity.launch(ctx)
      } catch (t: Throwable) {
        promise.reject(CodedException("E_REQUEST_FAILED", t.message ?: "requestPermission failed", t))
      }
    }

    AsyncFunction("capture") { promise: Promise ->
      try {
        val ctx: Context = appContext.reactContext
          ?: throw CodedException("E_NO_CONTEXT", "No React context", null)
        val code = resultCode
        val data = resultData
        if (!hasConsent() || data == null) {
          throw CodedException("E_NO_PROJECTION", "Screen capture permission not granted", null)
        }

        ScreenCaptureService.pendingResult = { shot, error ->
          if (shot != null) {
            val map = mapOf(
              "id" to shot.id,
              "uri" to "file://" + shot.file.absolutePath,
              "ts" to shot.ts.toDouble(),
              "width" to shot.width,
              "height" to shot.height,
            )
            promise.resolve(map)
          } else {
            promise.reject(CodedException("E_CAPTURE_FAILED", error ?: "capture failed", null))
          }
        }

        val intent = Intent(ctx, ScreenCaptureService::class.java).apply {
          putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, code)
          putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
      } catch (t: Throwable) {
        ScreenCaptureService.pendingResult = null
        if (t is CodedException) promise.reject(t)
        else promise.reject(CodedException("E_CAPTURE_FAILED", t.message ?: "capture failed", t))
      }
    }

    AsyncFunction("list") { promise: Promise ->
      try {
        val ctx: Context = appContext.reactContext
          ?: throw CodedException("E_NO_CONTEXT", "No React context", null)
        val out = ScreenStore.list(ctx).map { shot ->
          mapOf(
            "id" to shot.id,
            "uri" to "file://" + shot.file.absolutePath,
            "ts" to shot.ts.toDouble(),
            "width" to shot.width,
            "height" to shot.height,
          )
        }
        promise.resolve(out)
      } catch (t: Throwable) {
        promise.reject(CodedException("E_LIST_FAILED", t.message ?: "list failed", t))
      }
    }

    /**
     * Starts capturing DEVICE PLAYBACK audio (the remote party in a call, a
     * meeting, a video — what comes out of the speaker) via Android 10+
     * AudioPlaybackCapture, reusing the MediaProjection consent obtained by
     * requestPermission(). Emits 'onAudioFrame' with the same shape as the mic
     * path so the existing pipeline ingests it. Requires consent first — rejects
     * if absent (call requestPermission() before this).
     *
     * opts: { sampleRate?:Int=16000, frameSamples?:Int=320, notificationText?:String }
     */
    AsyncFunction("startSystemAudioCapture") { options: SystemAudioStartOptions, promise: Promise ->
      try {
        val ctx: Context = appContext.reactContext
          ?: throw CodedException("E_NO_CONTEXT", "No React context", null)
        val code = resultCode
        val data = resultData
        if (!hasConsent() || data == null) {
          throw CodedException(
            "E_NO_PROJECTION",
            "MediaProjection permission not granted — call requestPermission() first",
            null,
          )
        }
        val intent = Intent(ctx, SystemAudioCaptureService::class.java).apply {
          putExtra(SystemAudioCaptureService.EXTRA_RESULT_CODE, code)
          putExtra(SystemAudioCaptureService.EXTRA_RESULT_DATA, data)
          putExtra(SystemAudioCaptureService.EXTRA_SAMPLE_RATE, options.sampleRate)
          putExtra(SystemAudioCaptureService.EXTRA_FRAME_SAMPLES, options.frameSamples)
          putExtra(SystemAudioCaptureService.EXTRA_NOTIFICATION_TEXT, options.notificationText)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
        promise.resolve(null)
      } catch (t: Throwable) {
        if (t is CodedException) promise.reject(t)
        else promise.reject(
          CodedException("E_SYSTEM_AUDIO_FAILED", t.message ?: "startSystemAudioCapture failed", t),
        )
      }
    }

    AsyncFunction("stopSystemAudioCapture") {
      val ctx: Context? = appContext.reactContext
      if (ctx != null) {
        ctx.stopService(Intent(ctx, SystemAudioCaptureService::class.java))
      }
      // Explicit Unit so Kotlin doesn't infer the lambda's return type from
      // stopService()'s Boolean (matches KillioCaptureModule.stop()).
      Unit
    }
  }
}
