package dev.killio.screen

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.Executors

/**
 * AccessibilityService that captures the screen via
 * AccessibilityService.takeScreenshot() (API 30+) — WITHOUT MediaProjection.
 *
 * This is the DIRECT screenshot path: once the user enables this service in
 * Android's accessibility settings, Killio can screenshot the display with no
 * "start recording/casting?" consent dialog and no cast status-bar icon.
 *
 * The MediaProjection path (ScreenCaptureService) remains as the fallback for
 * devices where this service is not enabled or API < 30.
 *
 * Bridge: KillioScreenModule.captureViaAccessibility() calls capture() on the
 * live INSTANCE (set in onServiceConnected). The result is persisted via the
 * SAME ScreenStore the MediaProjection path uses, so the JS-visible
 * { id, uri, ts, width, height } shape is identical.
 *
 * Rate limit: takeScreenshot() is throttled to ~1 call/second; rapid calls fail
 * with ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT, surfaced as a clear error.
 */
class KillioScreenAccessibilityService : AccessibilityService() {

  companion object {
    /** Live instance, set in onServiceConnected and cleared in onDestroy. */
    @Volatile
    var instance: KillioScreenAccessibilityService? = null

    /** True when the service is connected and able to take screenshots. */
    fun isConnected(): Boolean = instance != null
  }

  private val executor = Executors.newSingleThreadExecutor()

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    try { executor.shutdownNow() } catch (_: Throwable) {}
    super.onDestroy()
  }

  // We do not scrape window content; required overrides are no-ops.
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
  override fun onInterrupt() {}

  /**
   * Captures the default display and persists it as PNG via ScreenStore.
   * Delivers (shot, null) on success or (null, errorMessage) on failure.
   */
  fun capture(callback: (StoredShot?, String?) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      callback(null, "takeScreenshot requires Android 11 (API 30)+")
      return
    }
    try {
      takeScreenshot(
        Display.DEFAULT_DISPLAY,
        executor,
        object : TakeScreenshotCallback {
          override fun onSuccess(screenshot: ScreenshotResult) {
            try {
              val buffer = screenshot.hardwareBuffer
              val bitmap = try {
                val hw = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
                  ?: throw IllegalStateException("wrapHardwareBuffer returned null")
                // Copy to a software (ARGB_8888) bitmap so we can compress to PNG;
                // hardware bitmaps cannot be encoded directly.
                val software = hw.copy(Bitmap.Config.ARGB_8888, false)
                hw.recycle()
                software ?: throw IllegalStateException("hardware→software copy failed")
              } finally {
                try { buffer.close() } catch (_: Throwable) {}
              }
              val shot = ScreenStore.save(this@KillioScreenAccessibilityService, bitmap)
              bitmap.recycle()
              callback(shot, null)
            } catch (t: Throwable) {
              callback(null, t.message ?: "screenshot conversion failed")
            }
          }

          override fun onFailure(errorCode: Int) {
            val msg = when (errorCode) {
              ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT ->
                "Screenshot rate-limited (try again in ~1s)"
              ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "Invalid display"
              ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS ->
                "Accessibility service lacks screenshot capability"
              else -> "takeScreenshot failed (code $errorCode)"
            }
            callback(null, msg)
          }
        },
      )
    } catch (t: Throwable) {
      callback(null, t.message ?: "takeScreenshot threw")
    }
  }
}
