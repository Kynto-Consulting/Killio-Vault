import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Native Android on-device STT (SpeechRecognizer) via a foreground service.
 * Free and credential-less — this is the default diary transcriber. Emits final
 * transcript segments with a UTC timestamp; no PCM/VAD/whisper needed.
 *
 * Absent in Expo Go → isAvailable() false (falls back to the AudioRecord path).
 * Uses requireOptionalNativeModule (expo-modules-core 2.x) — NativeModulesProxy
 * does NOT expose custom modules in SDK 52 (that caused the "demo mode" bug).
 */
const native: any = requireOptionalNativeModule('KillioSpeech');
// In expo-modules-core 2.x the native module itself is the event emitter.
const emitter: any = native;

export interface TranscriptEvent {
  text: string;
  /** UTC epoch ms (global time unit). */
  ts: number;
}

export interface SpeechStartOptions {
  language?: string;
  notificationText?: string;
  preferOffline?: boolean;
}

export function isAvailable(): boolean {
  return !!native;
}

/** True if the device actually has a recognition service installed. */
export function isRecognitionAvailable(): boolean {
  try {
    return !!native?.isRecognitionAvailable?.();
  } catch {
    return false;
  }
}

export function onTranscript(cb: (e: TranscriptEvent) => void): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onTranscript', cb);
  return { remove: () => sub.remove() };
}

export function onError(cb: (e: { message: string }) => void): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onError', cb);
  return { remove: () => sub.remove() };
}

export async function start(opts: SpeechStartOptions = {}): Promise<void> {
  if (!native) throw new Error('KillioSpeech native module unavailable (use dev-build).');
  await native.start({
    language: opts.language ?? 'es-ES',
    notificationText: opts.notificationText ?? 'Killio Vault is listening',
    preferOffline: opts.preferOffline ?? true,
  });
}

export async function stop(): Promise<void> {
  if (!native) return;
  await native.stop();
}

/** One-shot recognition for push-to-talk. Returns '' if nothing was heard. */
export async function recognizeOnce(language = 'es-ES'): Promise<string> {
  if (!native?.recognizeOnce) {
    throw new Error('Push-to-talk needs the dev-build (KillioSpeech native).');
  }
  return native.recognizeOnce(language);
}
