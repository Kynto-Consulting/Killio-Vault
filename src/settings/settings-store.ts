import * as SecureStore from 'expo-secure-store';

import { CaptureMode } from '../capture/schedule';

const CAPTURE_MODE_KEY = 'killio.captureMode';
const CONSENT_KEY = 'killio.captureConsentAt';

const DEFAULT_MODE: CaptureMode = { kind: 'off' };

export async function getCaptureMode(): Promise<CaptureMode> {
  const raw = await SecureStore.getItemAsync(CAPTURE_MODE_KEY);
  if (!raw) return DEFAULT_MODE;
  try {
    return JSON.parse(raw) as CaptureMode;
  } catch {
    return DEFAULT_MODE;
  }
}

export async function setCaptureMode(mode: CaptureMode): Promise<void> {
  await SecureStore.setItemAsync(CAPTURE_MODE_KEY, JSON.stringify(mode));
}

/** 24/7 recording requires explicit, timestamped consent (privacy gate). */
export async function hasConsent(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(CONSENT_KEY));
}

export async function grantConsent(): Promise<void> {
  await SecureStore.setItemAsync(CONSENT_KEY, String(Date.now()));
}

export async function revokeConsent(): Promise<void> {
  await SecureStore.deleteItemAsync(CONSENT_KEY);
}
