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
  /**
   * Speaker embedding for this utterance, present only when the speaker model is
   * loaded. Used for owner voice-ID (see src/voiceid). The native side forwards
   * it as a JSON-array string; onTranscript() parses it back into a number[]
   * before handing it to JS consumers.
   *
   * NOTE: with the sherpa-onnx migration this is now the 3D-Speaker CAM++
   * embedding (192-dim), not the old Vosk 128-dim x-vector. voiceprint.ts is
   * dim-agnostic (it stores/compares whatever dim arrives), so consumers don't
   * care about the exact length.
   */
  spk?: number[];
}

export interface SpeechStartOptions {
  language?: string;
  notificationText?: string;
  preferOffline?: boolean;
  /**
   * Wake keywords for the on-device sherpa-onnx KeywordSpotter (agent names +
   * custom wake phrases). Built-in "hey/oye killio" are ALWAYS added natively.
   * Detected DIRECTLY from audio (no transcript) so the made-up brand "Killio"
   * triggers reliably despite the Spanish ASR mis-transcribing it.
   */
  keywords?: string[];
}

/**
 * Wake-word detection from the native KeywordSpotter. `keyword` is the ORIGINAL
 * phrase text (e.g. "oye killio" or an agent name) so JS can map it back to the
 * matching agent / default assistant.
 */
export interface WakeEvent {
  keyword: string;
  /** UTC epoch ms. */
  ts: number;
}

/**
 * VAD speech-activity transition from the native capture loop. Fires only on a
 * state CHANGE: active=true when the user starts speaking, active=false when the
 * mic goes silent (a real pause). The post-wake command capture uses this so its
 * "user stopped talking" silence timer only runs while the mic is actually
 * silent — never cutting the command mid-sentence between VAD segments.
 */
export interface SpeechActivityEvent {
  active: boolean;
  /** UTC epoch ms. */
  ts: number;
}

/**
 * Offline sherpa-onnx model lifecycle, emitted on first start while the
 * streaming Zipformer (per-language), Silero VAD, and speaker-embedding models
 * are fetched. The UI shows a progress banner for 'downloading'/'preparing' and
 * hides it on 'ready'. 'error' carries a message.
 */
export interface ModelStatusEvent {
  state: 'downloading' | 'preparing' | 'ready' | 'error';
  /** 0..100 while downloading (may be absent if Content-Length is unknown). */
  progress?: number;
  /** Bytes downloaded so far (downloading only). */
  bytes?: number;
  /** Total bytes to download (downloading only; absent if unknown). */
  total?: number;
  /** Failure message when state === 'error'. */
  message?: string;
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
  // Native delivers `spk` as a JSON-array string (kept off the Bundle as a
  // primitive). Parse it here so JS consumers always see a clean number[].
  const sub = emitter.addListener('onTranscript', (raw: any) => {
    let spk: number[] | undefined;
    const rawSpk = raw?.spk;
    if (typeof rawSpk === 'string' && rawSpk.length > 0) {
      try {
        const arr = JSON.parse(rawSpk);
        if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) spk = arr;
      } catch {
        /* malformed — drop the vector, keep the transcript */
      }
    } else if (Array.isArray(rawSpk)) {
      spk = rawSpk as number[];
    }
    cb({ text: raw.text, ts: raw.ts, ...(spk ? { spk } : {}) });
  });
  return { remove: () => sub.remove() };
}

/**
 * Subscribe to native wake-word detections from the KeywordSpotter. Fires
 * { keyword, ts } the instant a wake phrase / agent name is spotted in the audio
 * stream — independent of the diary transcript. This is the PRIMARY wake path;
 * the transcript-fuzzy matchWake() remains a fallback for phrases the KWS model
 * can't tokenize.
 */
export function onWake(cb: (e: WakeEvent) => void): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onWake', (raw: any) => {
    const keyword = typeof raw?.keyword === 'string' ? raw.keyword : '';
    const ts = typeof raw?.ts === 'number' ? raw.ts : Date.now();
    if (keyword) cb({ keyword, ts });
  });
  return { remove: () => sub.remove() };
}

/**
 * Subscribe to native VAD speech-activity transitions. Fires { active, ts } each
 * time the mic crosses the speech/silence boundary. Used by the wake-command
 * capture to gate its silence timer (see WakeListener). No-op if the native
 * module is absent.
 */
export function onSpeechActivity(
  cb: (e: SpeechActivityEvent) => void,
): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onSpeechActivity', (raw: any) => {
    const active = !!raw?.active;
    const ts = typeof raw?.ts === 'number' ? raw.ts : Date.now();
    cb({ active, ts });
  });
  return { remove: () => sub.remove() };
}

export function onError(cb: (e: { message: string }) => void): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onError', cb);
  return { remove: () => sub.remove() };
}

/**
 * Subscribe to offline-model download/prepare progress (Vosk first-run fetch).
 * Fires 'downloading' (with progress), 'preparing' (unzip), 'ready', 'error'.
 */
export function onModelStatus(cb: (e: ModelStatusEvent) => void): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onModelStatus', cb);
  return { remove: () => sub.remove() };
}

export async function start(opts: SpeechStartOptions = {}): Promise<void> {
  if (!native) throw new Error('KillioSpeech native module unavailable (use dev-build).');
  await native.start({
    language: opts.language ?? 'es-ES',
    notificationText: opts.notificationText ?? 'Killio Vault is listening',
    preferOffline: opts.preferOffline ?? true,
    keywords: opts.keywords ?? [],
  });
}

/**
 * Reload the wake keywords live (no capture restart). Built-in "hey/oye killio"
 * are always merged in natively. No-op if the native module / capture service
 * isn't running. Call when the agent list changes so new agent names become
 * wakeable immediately.
 */
export async function setKeywords(keywords: string[]): Promise<void> {
  if (!native?.setKeywords) return;
  try {
    await native.setKeywords(keywords);
  } catch {
    /* service not running — keywords apply on next start() */
  }
}

export async function stop(): Promise<void> {
  if (!native) return;
  await native.stop();
}

/**
 * Read the tail (~200KB) of the NATIVE diagnostic log (killio.log: KWS + whisper
 * download status + capture lines) from the app's external files dir. JS can't
 * reach that path via expo-file-system, so the native module returns it. Returns
 * '' if the native module is absent (Expo Go) or nothing is logged yet. Used by
 * the Settings "Export logs" to include the native log alongside the JS log.
 */
export async function readNativeLog(): Promise<string> {
  try {
    if (!native?.readNativeLog) return '';
    const s = await native.readNativeLog();
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

/** One-shot recognition for push-to-talk. Returns '' if nothing was heard. */
export async function recognizeOnce(language = 'es-ES'): Promise<string> {
  if (!native?.recognizeOnce) {
    throw new Error('Push-to-talk needs the dev-build (KillioSpeech native).');
  }
  return native.recognizeOnce(language);
}
