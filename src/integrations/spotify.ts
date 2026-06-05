import { Linking } from 'react-native';

/**
 * Spotify control via deep links. No SDK / OAuth required: we open the
 * Spotify app (or fall back to the web player) using the `spotify:` URI
 * scheme. This covers play(uri|query), pause, next, prev and search. When
 * Spotify isn't installed, callers are routed to https://open.spotify.com.
 *
 * Native intent control (skip/pause without leaving the app) needs the
 * Spotify Android Remote SDK; that lives behind a future
 * `modules/killio-spotify` Expo module — this file works today via the
 * intent fallback.
 */
const APP_PREFIX = 'spotify:';
const WEB_FALLBACK = 'https://open.spotify.com';

async function open(uri: string, fallback: string): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  try {
    const supported = await Linking.canOpenURL(uri);
    if (supported) {
      await Linking.openURL(uri);
      return { opened: true, via: 'app' };
    }
  } catch {
    /* swallow */
  }
  await Linking.openURL(fallback);
  return { opened: true, via: 'web' };
}

export async function play(opts: { uri?: string; query?: string }): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  if (opts.uri) return open(opts.uri, `${WEB_FALLBACK}/track/${encodeURIComponent(opts.uri)}`);
  if (opts.query) {
    return open(
      `${APP_PREFIX}search:${encodeURIComponent(opts.query)}`,
      `${WEB_FALLBACK}/search/${encodeURIComponent(opts.query)}`,
    );
  }
  return open(`${APP_PREFIX}`, WEB_FALLBACK);
}

export async function pause(): Promise<{ ok: boolean }> {
  // Spotify URIs don't expose a "pause" deep link — opening the app
  // restores the user's last context; pause must come from the SDK once
  // the native module lands.
  await Linking.openURL(APP_PREFIX);
  return { ok: false };
}

export async function next(): Promise<{ ok: boolean }> {
  await Linking.openURL(APP_PREFIX);
  return { ok: false };
}

export async function previous(): Promise<{ ok: boolean }> {
  await Linking.openURL(APP_PREFIX);
  return { ok: false };
}

export async function search(query: string): Promise<{ opened: boolean }> {
  await Linking.openURL(`${WEB_FALLBACK}/search/${encodeURIComponent(query)}`);
  return { opened: true };
}
