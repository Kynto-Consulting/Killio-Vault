import { Linking } from 'react-native';

import * as Media from './native/KillioMedia';

/**
 * Spotify control. Two mechanisms:
 *
 *  1. DEEP LINKS (play/open/search) — open the Spotify app (or web player) via
 *     the `spotify:` URI scheme. play(uri) plays directly; play(query) opens
 *     the in-app search. (The backend now resolves a query → track URI via the
 *     Web API before this runs, so play usually receives a real URI.)
 *
 *  2. MEDIA KEYS (pause/next/previous) — the public `spotify:` scheme has NO
 *     transport deep links, so we drive playback through the device media
 *     session via the native `killio-media` module
 *     (AudioManager.dispatchMediaKeyEvent). This pauses / skips whatever is
 *     playing (Spotify, etc.) WITHOUT opening or closing any app. When the
 *     native module is unavailable (Expo Go), we honestly report
 *     controlled:false and surface the Spotify app as a fallback.
 */
const APP_PREFIX = 'spotify:';
const WEB_FALLBACK = 'https://open.spotify.com';

async function open(
  uri: string,
  fallback: string,
): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  try {
    if (await Linking.canOpenURL(uri)) {
      await Linking.openURL(uri);
      return { opened: true, via: 'app' };
    }
  } catch {
    /* fall through to web */
  }
  await Linking.openURL(fallback);
  return { opened: true, via: 'web' };
}

export async function play(opts: {
  uri?: string;
  query?: string;
}): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  // A bare spotify:track:<id> / spotify:album:<id> URI plays directly in the
  // app. The web fallback needs the type/id split out of the URI.
  if (opts.uri) {
    const webPath = opts.uri.startsWith('spotify:')
      ? `${WEB_FALLBACK}/${opts.uri.slice('spotify:'.length).replace(/:/g, '/')}`
      : `${WEB_FALLBACK}/search/${encodeURIComponent(opts.uri)}`;
    return open(opts.uri, webPath);
  }
  if (opts.query) {
    return open(
      `${APP_PREFIX}search:${encodeURIComponent(opts.query)}`,
      `${WEB_FALLBACK}/search/${encodeURIComponent(opts.query)}`,
    );
  }
  return open(`${APP_PREFIX}`, WEB_FALLBACK);
}

/**
 * open — deep-link Spotify to a URI or to the in-app search screen for a query.
 * Used by the spotify_open client-action when the user explicitly wants to OPEN
 * Spotify (vs. background-search via the server-side spotify_search tool).
 */
export async function openSpotify(opts: {
  uri?: string;
  query?: string;
}): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  if (opts.uri) {
    const webPath = opts.uri.startsWith('spotify:')
      ? `${WEB_FALLBACK}/${opts.uri.slice('spotify:'.length).replace(/:/g, '/')}`
      : `${WEB_FALLBACK}/search/${encodeURIComponent(opts.uri)}`;
    return open(opts.uri, webPath);
  }
  if (opts.query) {
    return open(
      `${APP_PREFIX}search:${encodeURIComponent(opts.query)}`,
      `${WEB_FALLBACK}/search/${encodeURIComponent(opts.query)}`,
    );
  }
  return open(`${APP_PREFIX}`, WEB_FALLBACK);
}

/**
 * Transport control via the device media session (killio-media native module).
 * Controls Spotify (or whatever is playing) WITHOUT opening or closing any app.
 * When the native module is unavailable (Expo Go), report controlled:false so
 * the assistant tells the user to use the Spotify UI rather than lying.
 */
type TransportResult =
  | { controlled: true; action: 'pause' | 'next' | 'previous'; via: 'media-keys' }
  | { controlled: false; action: 'pause' | 'next' | 'previous'; reason: string };

async function transport(
  action: 'pause' | 'next' | 'previous',
): Promise<TransportResult> {
  if (Media.isAvailable()) {
    try {
      if (action === 'pause') await Media.playPause();
      else if (action === 'next') await Media.next();
      else await Media.previous();
      return { controlled: true, action, via: 'media-keys' };
    } catch (e) {
      return {
        controlled: false,
        action,
        reason: (e as Error)?.message ?? 'media key dispatch failed',
      };
    }
  }
  return {
    controlled: false,
    action,
    reason:
      'Media-key control needs the native APK (not Expo Go). Use the Spotify controls directly.',
  };
}

export function pause() {
  return transport('pause');
}

export function next() {
  return transport('next');
}

export function previous() {
  return transport('previous');
}
