import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

import { API_BASE_URL } from '../core/api/config';
import { getAccessToken, getPersonalTeamId } from '../core/auth/token-store';
import { api } from '../core/api/http';

/**
 * Custom voice (Cartesia) playback. Posts text to the backend /vault/tts, which
 * returns MP3 bytes (gated to paid plans), writes them to a cache file, and
 * plays via expo-av. Used when an agent's voice is set to "cartesia".
 */
let sound: Audio.Sound | null = null;
let counter = 0;

export async function isCustomVoiceAvailable(): Promise<boolean> {
  const teamId = await getPersonalTeamId();
  if (!teamId) return false;
  try {
    const { data } = await api.get<{ available: boolean }>('/vault/voice/available', {
      params: { teamId },
    });
    return !!data.available;
  } catch {
    return false;
  }
}

/**
 * Synthesizes + plays text with the Cartesia voice. Resolves when playback ends.
 * Throws (rejects) on a genuine failure so the caller's `speak()` catch-all can
 * surface it — but it always guarantees `onFinish` runs first so capture ducking
 * stays balanced regardless of outcome.
 */
export async function speakCartesia(
  text: string,
  opts: { onStart?(): void; onFinish?(): void } = {},
): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const teamId = await getPersonalTeamId();
  const token = await getAccessToken();
  if (!teamId || !token) return;

  // Fetch MP3 bytes (POST with auth) → base64 → cache file.
  const res = await fetch(`${API_BASE_URL}/vault/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ teamId, text: clean }),
  });
  if (!res.ok) {
    // Surface the server error instead of feeding an error body to the player.
    const detail = await res.text().catch(() => '');
    opts.onStart?.();
    opts.onFinish?.();
    throw new Error(`Cartesia TTS failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  // Guard against the backend returning a non-audio body (e.g. a JSON error
  // with a 200, or an empty body) — handing that to expo-av throws an opaque
  // native error that previously crashed the screen.
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const buf = await res.arrayBuffer();
  if (
    buf.byteLength === 0 ||
    contentType.includes('application/json') ||
    contentType.includes('text/')
  ) {
    const body = contentType.includes('json') || contentType.includes('text')
      ? new TextDecoder().decode(buf).slice(0, 200)
      : '';
    opts.onStart?.();
    opts.onFinish?.();
    throw new Error(`Cartesia TTS returned non-audio response${body ? `: ${body}` : ''}`);
  }

  const base64 = arrayBufferToBase64(buf);
  const uri = `${FileSystem.cacheDirectory}vault-tts-${counter++}.mp3`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await stopCartesia();
  // staysActiveInBackground → keeps playing the reply when the screen is locked
  // (background/wake mode); the capture foreground service keeps the process alive.
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
  });

  let created: Audio.SoundObject;
  try {
    created = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  } catch (e) {
    opts.onStart?.();
    opts.onFinish?.();
    await stopCartesia();
    throw e;
  }
  sound = created.sound;
  opts.onStart?.();

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      opts.onFinish?.();
      void stopCartesia();
      resolve();
    };
    sound?.setOnPlaybackStatusUpdate((status) => {
      // `error` appears on the status object when playback fails mid-stream.
      if ('error' in status && (status as { error?: unknown }).error) {
        finish();
        return;
      }
      if ('didJustFinish' in status && status.didJustFinish) {
        finish();
      }
    });
  });
}

export async function stopCartesia(): Promise<void> {
  if (sound) {
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    sound = null;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // eslint-disable-next-line no-undef
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}
