import * as SecureStore from 'expo-secure-store';

import { CaptureMode } from '../capture/schedule';

import { NativeModules, Platform } from 'react-native';

const CAPTURE_MODE_KEY = 'killio.captureMode';
const CONSENT_KEY = 'killio.captureConsentAt';
const VOICE_KEY = 'killio.assistantVoice';
const WAKE_WORD_KEY = 'killio.wakeWordEnabled';
const STT_LANGUAGE_KEY = 'killio.sttLanguage';

const DEFAULT_MODE: CaptureMode = { kind: 'off' };

/**
 * Supported offline STT recognition languages. Each maps 1:1 to a Vosk model
 * bundled-on-demand by the native side (es → vosk-model-small-es-0.42,
 * en → vosk-model-small-en-us-0.15). The value is an IETF locale tag passed to
 * Speech.start({ language }) / recognizeOnce(language); the native side parses
 * the leading code (es/en) to pick the model.
 */
export const STT_LANGUAGES = ['es-ES', 'en-US'] as const;
export type SttLanguage = (typeof STT_LANGUAGES)[number];

/**
 * Best-effort device language → a supported STT locale. Reads the OS locale
 * without an extra dependency (RN exposes it via NativeModules). Falls back to
 * Spanish when the device language is neither es nor en.
 */
function deviceSttDefault(): SttLanguage {
  let tag = '';
  try {
    if (Platform.OS === 'ios') {
      const s: any = NativeModules.SettingsManager?.settings;
      tag =
        s?.AppleLocale ||
        (Array.isArray(s?.AppleLanguages) ? s.AppleLanguages[0] : '') ||
        '';
    } else {
      tag = (NativeModules.I18nManager?.localeIdentifier as string) || '';
    }
  } catch {
    tag = '';
  }
  const code = tag.toLowerCase().replace('_', '-').split('-')[0];
  if (code === 'en') return 'en-US';
  return 'es-ES';
}

/**
 * Offline STT recognition language (es-ES / en-US). Default = device locale's
 * language if es or en, else es-ES. The native Vosk model for the chosen
 * language is downloaded on first use and offline thereafter.
 */
export async function getSttLanguage(): Promise<SttLanguage> {
  const raw = await SecureStore.getItemAsync(STT_LANGUAGE_KEY);
  if (raw && (STT_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as SttLanguage;
  }
  return deviceSttDefault();
}

export async function setSttLanguage(lang: SttLanguage): Promise<void> {
  await SecureStore.setItemAsync(STT_LANGUAGE_KEY, lang);
}

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
