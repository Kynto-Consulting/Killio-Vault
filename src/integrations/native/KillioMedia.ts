import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Thin TS wrapper over the native `KillioMedia` Expo module (Kotlin), which
 * dispatches hardware media-key events via `AudioManager.dispatchMediaKeyEvent`.
 *
 * This controls whatever app holds the active media session (Spotify, YouTube
 * Music, etc.) WITHOUT opening it and WITHOUT closing Killio. No permission
 * required. Absent in Expo Go — `isAvailable()` lets callers fall back / error
 * clearly.
 *
 * Native contract (all resolve to true on dispatch):
 *   playPause(): Promise<boolean>
 *   play(): Promise<boolean>
 *   pause(): Promise<boolean>
 *   next(): Promise<boolean>
 *   previous(): Promise<boolean>
 */
const native: any = requireOptionalNativeModule('KillioMedia');

export function isAvailable(): boolean {
  return !!native;
}

function ensure(): any {
  if (!native) {
    throw new Error('Media native module unavailable (requires a dev-build / APK, not Expo Go).');
  }
  return native;
}

export async function playPause(): Promise<boolean> {
  return ensure().playPause();
}

export async function play(): Promise<boolean> {
  return ensure().play();
}

export async function pause(): Promise<boolean> {
  return ensure().pause();
}

export async function next(): Promise<boolean> {
  return ensure().next();
}

export async function previous(): Promise<boolean> {
  return ensure().previous();
}
