import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Thin TS wrapper over the native `KillioTorch` Expo module (Kotlin), which
 * toggles the device flashlight via `CameraManager.setTorchMode`.
 *
 * This needs NO camera preview and NO CAMERA permission prompt — unlike the old
 * hidden-<CameraView> approach which was flaky (camera often never started) and
 * re-prompted for permission on every toggle.
 *
 * Absent in Expo Go — `isAvailable()` lets callers fall back / error clearly.
 *
 * Native contract:
 *   setTorch(on: boolean): Promise<boolean>   — resolves to the new torch state
 *   hasTorch(): boolean                        — device has a flash unit
 */
const native: any = requireOptionalNativeModule('KillioTorch');

export function isAvailable(): boolean {
  return !!native;
}

/** Whether the device has a camera with a flash unit. */
export function hasTorch(): boolean {
  if (!native?.hasTorch) return false;
  try {
    return !!native.hasTorch();
  } catch {
    return false;
  }
}

/**
 * Turn the torch on/off. Resolves to the new state. Throws a clear error when
 * the native module is unavailable (Expo Go) or the device has no flash.
 */
export async function setTorch(on: boolean): Promise<boolean> {
  if (!native) {
    throw new Error('Torch native module unavailable (requires a dev-build / APK, not Expo Go).');
  }
  return native.setTorch(on);
}
