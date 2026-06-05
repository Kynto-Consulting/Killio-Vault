import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'killio.deviceId';

/**
 * Stable per-install device id. Diary ingestion keys idempotency on
 * (deviceId, ts), so this must survive app restarts. Prefers the OS install id,
 * falls back to a generated UUID persisted in secure storage.
 */
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const osId =
    Application.getAndroidId?.() ??
    (await Application.getIosIdForVendorAsync?.()) ??
    Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, osId);
  cached = osId;
  return osId;
}
