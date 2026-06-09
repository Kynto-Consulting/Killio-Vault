import { Linking, Platform } from 'react-native';

import * as AppIntent from './native/KillioAppIntent';

/**
 * App-control via app-specific Android intents — the realistic "control
 * installed apps like Gemini does" path (App Actions / deep links). Backed by
 * the native `killio-appintent` module; falls back to wa.me Linking when the
 * native module is unavailable (Expo Go).
 */

/** whatsapp_message — open WhatsApp chat with a pre-filled message. */
export async function whatsappMessage(
  phone: string,
  text?: string,
): Promise<{ opened: boolean; via: string; phone: string }> {
  if (AppIntent.isAvailable() && Platform.OS === 'android') {
    return AppIntent.whatsappMessage(phone, text);
  }
  // Fallback: universal wa.me link (works on any platform with WhatsApp/web).
  const digits = String(phone).replace(/[^\d]/g, '');
  const url =
    `https://wa.me/${digits}` + (text ? `?text=${encodeURIComponent(text)}` : '');
  await Linking.openURL(url);
  return { opened: true, via: 'wa.me-link', phone: digits };
}

/** whatsapp_call — best-effort 1-tap WhatsApp voice call (saved contacts). */
export async function whatsappCall(
  phone: string,
): Promise<{ called: boolean; via: string; note?: string }> {
  if (AppIntent.isAvailable() && Platform.OS === 'android') {
    return AppIntent.whatsappCall(phone);
  }
  // Fallback: open the chat (no native module → can't fire the VoIP intent).
  const digits = String(phone).replace(/[^\d]/g, '');
  await Linking.openURL(`https://wa.me/${digits}`);
  return {
    called: false,
    via: 'wa.me-fallback',
    note: 'Native app-intent module unavailable (Expo Go); opened the chat instead.',
  };
}
