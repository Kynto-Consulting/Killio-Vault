import * as SecureStore from 'expo-secure-store';

import { CaptureMode } from '../capture/schedule';

const CAPTURE_MODE_KEY = 'killio.captureMode';
const CONSENT_KEY = 'killio.captureConsentAt';
const VOICE_KEY = 'killio.assistantVoice';
const WAKE_WORD_KEY = 'killio.wakeWordEnabled';

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

/** Global assistant voice. "cartesia" routes through the custom voice; any
 *  IETF tag (es-ES, en-US, …) goes to the device's native TTS engine. */
export async function getAssistantVoice(): Promise<string> {
  return (await SecureStore.getItemAsync(VOICE_KEY)) ?? 'es-ES';
}

export async function setAssistantVoice(voice: string): Promise<void> {
  await SecureStore.setItemAsync(VOICE_KEY, voice);
}

/** Wake-word listener master toggle. Default on. */
export async function isWakeWordEnabled(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(WAKE_WORD_KEY);
  return raw === null ? true : raw === '1';
}

export async function setWakeWordEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(WAKE_WORD_KEY, on ? '1' : '0');
}
