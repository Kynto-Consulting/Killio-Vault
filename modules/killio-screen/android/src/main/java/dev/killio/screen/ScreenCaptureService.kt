package dev.killio.screen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.File

/**
 * MediaProjection-typed foreground service. Captures EXACTLY ONE frame, persists
 * it as PNG via ScreenStore, and stops itself. KillioScreenModule awaits the
 * result via the static callback set on the companion.
 *
 * Android 14+ requires that startForeground() with foregroundServiceType=
 * mediaProjection happens BEFORE getMediaProjection(), or the system throws
 * SecurityException: "Media projections require a foreground service of type
 * ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION".
 */
class ScreenCaptureService : Service() {

  companion object {
    private const val CHANNEL_ID = "killio_vault_screen"
    private const val NOTIF_ID = 4712
    private const val VD_NAME = "killio-vault-vd"

    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"

    /** Set by KillioScreenModule.capture() — invoked with the saved shot or null. */
    @Volatile
    var pendingResult: ((StoredShot?, String?) -> Unit)? = null
  }

  private var projection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var handlerThread: HandlerThread? = null
  private var handler: Handler? = null
  @Volatile private var captured = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // (1) startForeground FIRST — Android 14 typed-FGS requirement.
    startForegroundWithNotification()

    val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
    val resultData: Intent? =
      if (Build.VERSION.SDK_INT >= 33) {
        intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
      } else {
        @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_RESULT_DATA)
      }

    if (resultData == null) {
      finishWithError("Missing MediaProjection consent extras")
      return START_NOT_STICKY
    }

    val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val mp: MediaProjection? = try {
      mpm.getMediaProjection(resultCode, resultData)
    } catch (t: Throwable) {
      finishWithError("getMediaProjection failed: ${t.message}")
      return START_NOT_STICKY
    }
    if (mp == null) {
      finishWithError("MediaProjection is null (consent revoked?)")
      return START_NOT_STICKY
    }
    projection = mp

    // Required on Android 14+: register a callback before creating the virtual display.
    mp.registerCallback(object : MediaProjection.Callback() {
      override fun onStop() {
        // System tore us down — make sure pending awaiters resolve.
        if (!captured) finishWithError("MediaProjection stopped before capture")
      }
    }, Handler(mainLooper))

    val (w, h, density) = getDisplaySize()
    val reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
    imageReader = reader

    handlerThread = HandlerThread("killio-screen").also { it.start() }
    handler = Handler(handlerThread!!.looper)

    reader.setOnImageAvailableListener({ r ->
      if (captured) return@setOnImageAvailableListener
      val image: Image? = try { r.acquireLatestImage() } catch (_: Throwable) { null }
      if (image == null) return@setOnImageAvailableListener
      captured = true
      try {
        val bitmap = imageToBitmap(image, w, h)
        image.close()
        val shot = ScreenStore.save(this@ScreenCaptureService, bitmap)
        bitmap.recycle()
        deliver(shot, null)
      } catch (t: Throwable) {
        try { image.close() } catch (_: Throwable) {}
        deliver(null, t.message ?: "capture failed")
      }
    }, handler)

    virtualDisplay = mp.createVirtualDisplay(
      VD_NAME,
      w,
      h,
      density,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      handler,
    )

    return START_NOT_STICKY
  }

  private data class DisplaySize(val width: Int, val height: Int, val density: Int)

  private fun getDisplaySize(): DisplaySize {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val metrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    wm.defaultDisplay.getRealMetrics(metrics)
    return DisplaySize(metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
  }

  /**
   * Converts an RGBA_8888 Image to a Bitmap, accounting for rowStride padding
   * (pixelStride * width may be less than rowStride on some devices).
   */
  private fun imageToBitmap(image: Image, width: Int, height: Int): Bitmap {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val rowPadding = rowStride - pixelStride * width

    val paddedWidth = width + rowPadding / pixelStride
    val padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
    padded.copyPixelsFromBuffer(buffer)
    return if (rowPadding == 0) {
      padded
    } else {
      val cropped = Bitmap.createBitmap(padded, 0, 0, width, height)
      if (cropped !== padded) padded.recycle()
      cropped
    }
  }

  private fun deliver(shot: StoredShot?, error: String?) {
    val cb = pendingResult
    pendingResult = null
    try { cb?.invoke(shot, error) } catch (_: Throwable) {}
    cleanupAndStop()
  }

  private fun finishWithError(msg: String) {
    deliver(null, msg)
  }

  private fun cleanupAndStop() {
    try { virtualDisplay?.release() } catch (_: Throwable) {}
    virtualDisplay = null
    try { imageReader?.close() } catch (_: Throwable) {}
    imageReader = null
    try { projection?.stop() } catch (_: Throwable) {}
    projection = null
    try { handlerThread?.quitSafely() } catch (_: Throwable) {}
    handlerThread = null
    handler = null
    stopSelf()
  }

  override fun onDestroy() {
    cleanupAndStop()
    super.onDestroy()
  }

  private fun startForegroundWithNotification() {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Killio Vault screen",
        NotificationManager.IMPORTANCE_LOW,
      )
      nm.createNotificationChannel(channel)
    }
    val notification: Notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Killio Vault")
      .setContentText("Capturing screen…")
      .setSmallIcon(android.R.drawable.ic_menu_camera)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }
}
