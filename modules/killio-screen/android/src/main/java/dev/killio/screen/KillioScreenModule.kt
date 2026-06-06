package dev.killio.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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
  }
}
