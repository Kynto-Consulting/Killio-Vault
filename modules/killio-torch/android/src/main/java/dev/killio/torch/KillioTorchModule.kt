package dev.killio.torch

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module that toggles the device torch (flashlight) via the system
 * [CameraManager.setTorchMode] API.
 *
 * Why native: expo-camera 16 dropped the imperative torch API, leaving only the
 * `enableTorch` prop on `<CameraView>`. Driving an off-screen CameraView is
 * flaky (the camera often never starts so the torch never engages) and it
 * re-prompts for CAMERA permission on every use.
 *
 * `CameraManager.setTorchMode` does NOT require the CAMERA permission — it is a
 * system-level torch toggle that needs no preview surface and no per-use
 * permission prompt. We just find the first camera that advertises
 * FLASH_INFO_AVAILABLE (normally the back camera) and flip its torch.
 *
 * JS API (see src/integrations/native/KillioTorch.ts):
 *   setTorch(on: Boolean) -> Promise<Boolean>   // resolves to the new state
 *   isAvailable() -> Boolean                     // any camera with a flash unit
 */
class KillioTorchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KillioTorch")

    /** True when the device has at least one camera with a flash unit. */
    Function("hasTorch") {
      runCatching { firstFlashCameraId() != null }.getOrDefault(false)
    }

    AsyncFunction("setTorch") { on: Boolean ->
      val ctx: Context = appContext.reactContext
        ?: throw IllegalStateException("No React context")
      val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        ?: throw IllegalStateException("CameraManager unavailable")
      val cameraId = firstFlashCameraId(manager)
        ?: throw IllegalStateException("No camera with a flash unit on this device")
      // setTorchMode throws CameraAccessException if the camera is in use by
      // another app; surface that as a normal rejected promise.
      manager.setTorchMode(cameraId, on)
      on
    }
  }

  /** First camera id advertising a flash unit, or null. Opens its own manager. */
  private fun firstFlashCameraId(): String? {
    val ctx = appContext.reactContext ?: return null
    val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return null
    return firstFlashCameraId(manager)
  }

  private fun firstFlashCameraId(manager: CameraManager): String? {
    for (id in manager.cameraIdList) {
      val chars = manager.getCameraCharacteristics(id)
      val hasFlash = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      if (hasFlash) return id
    }
    return null
  }
}
