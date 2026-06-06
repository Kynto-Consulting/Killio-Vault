import { speakCartesia } from './cartesia';
import { sanitizeForSpeech, speechLang } from './sanitize';

/**
 * Native TTS wrapper (react-native-tts → Android system engine). Per plan F we
 * use the device's built-in voice. Capture is ducked while speaking so the
 * diary doesn't record the assistant's own voice.
 *
 * react-native-tts is a NATIVE module — absent in Expo Go. Lazy-required so a
 * plain import doesn't crash boot; speak() degrades to a no-op when unavailable.
 */
export interface SpeakOptions {
  language?: string;
  rate?: number; // 0.0–1.0 (Android)
  pitch?: number;
  /** Called around playback so the caller can pause capture. */
  onStart?(): void;
  onFinish?(): void;
  /** Called when synthesis/playback fails, so a caller can surface it. */
  onError?(err: unknown): void;
}

let Tts: any = undefined;
function getTts(): any {
  if (Tts !== undefined) return Tts;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Tts = require('react-native-tts').default ?? require('react-native-tts');
  } catch {
    Tts = null;
  }
  return Tts;
}

let initialized = false;
async function ensureInit(tts: any): Promise<void> {
  if (initialized) return;
  try {
    await tts.getInitStatus();
  } catch {
    // 'no_engine' etc. — speaking will no-op; not fatal for the app.
  }
  initialized = true;
}

/**
 * Speaks `text`. NEVER throws and NEVER rejects — TTS is a best-effort,
 * non-critical side effect, so a synthesis failure must not bubble up into a
 * render/async path and unmount the React tree (that produced the "black
 * screen on test voice" crash). On any failure we log, fire `onFinish` so the
 * caller's capture-ducking stays balanced, and resolve quietly.
 *
 * If `opts.onError` is provided it's invoked with the error so a caller (e.g.
 * the voice-test buttons) can surface a user-facing Alert.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  try {
    // Strip XML tool markup / refs / markdown / URLs so the voice reads clean prose.
    const clean = sanitizeForSpeech(text, speechLang(opts.language));
    if (!clean) return;

    // Custom voice (Cartesia) — synthesized server-side, played via expo-av.
    if (opts.language === 'cartesia') {
      await speakCartesia(clean, { onStart: opts.onStart, onFinish: opts.onFinish });
      return;
    }

    const tts = getTts();
    if (!tts) {
      // No native TTS (Expo Go) — fire callbacks so capture ducking still balances.
      opts.onStart?.();
      opts.onFinish?.();
      return;
    }
    await ensureInit(tts);

    // Guard each setter: an unsupported language/rate/pitch can throw
    // synchronously (not just reject) on some engines — swallow it.
    try {
      if (opts.language) await Promise.resolve(tts.setDefaultLanguage(opts.language)).catch(() => {});
      if (typeof opts.rate === 'number') await Promise.resolve(tts.setDefaultRate(opts.rate)).catch(() => {});
      if (typeof opts.pitch === 'number') await Promise.resolve(tts.setDefaultPitch(opts.pitch)).catch(() => {});
    } catch {
      /* engine rejected a setter — speaking the default voice is still fine */
    }

    await new Promise<void>((resolve) => {
      const onStart = () => opts.onStart?.();
      const onDone = () => {
        tts.removeEventListener?.('tts-start', onStart);
        tts.removeEventListener?.('tts-finish', onDone);
        tts.removeEventListener?.('tts-cancel', onDone);
        opts.onFinish?.();
        resolve();
      };
      tts.addEventListener('tts-start', onStart);
      tts.addEventListener('tts-finish', onDone);
      tts.addEventListener('tts-cancel', onDone);
      try {
        tts.stop();
        tts.speak(clean);
      } catch (e) {
        // speak() threw synchronously — clean up and resolve.
        opts.onError?.(e);
        onDone();
      }
    });
  } catch (e) {
    // Catch-all so a TTS failure can never unmount the screen.
    // eslint-disable-next-line no-console
    console.warn('[tts] speak failed', e);
    opts.onError?.(e);
    opts.onFinish?.();
  }
}

export function stopSpeaking(): void {
  getTts()?.stop?.();
}
