import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Thin TS wrapper over the native `KillioAppIntent` Expo module (Kotlin), which
 * fires app-specific Android intents — the realistic "control installed apps"
 * path (deep links + App-Action intents), like Google Assistant App Actions.
 *
 * Absent in Expo Go — `isAvailable()` lets callers fall back / error clearly.
 *
 * Native contract:
 *   whatsappMessage(phone, text?): Promise<{ opened, via, phone }>
 *   whatsappCall(phone): Promise<{ called, via, note? }>
 *   openAppAction(packageName?, action?, data?): Promise<{ opened, package, action }>
 */
const native: any = requireOptionalNativeModule('KillioAppIntent');

export function isAvailable(): boolean {
  return !!native;
}

function ensure(): any {
  if (!native) {
    throw new Error('App-intent native module unavailable (requires a dev-build / APK, not Expo Go).');
  }
  return native;
}

export async function whatsappMessage(
  phone: string,
  text?: string,
): Promise<{ opened: boolean; via: string; phone: string }> {
  return ensure().whatsappMessage(phone, text ?? '');
}

export async function whatsappCall(
  phone: string,
): Promise<{ called: boolean; via: string; note?: string }> {
  return ensure().whatsappCall(phone);
}

export async function openAppAction(opts: {
  package?: string;
  action?: string;
  data?: string;
}): Promise<{ opened: boolean; package: string; action: string }> {
  return ensure().openAppAction(opts.package ?? null, opts.action ?? null, opts.data ?? null);
}
