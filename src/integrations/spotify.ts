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

/**
 * Detect a concrete Spotify destination the OS can open directly:
 *   - a web link   https://open.spotify.com/{track|album|playlist|...}/<id>
 *   - a URI scheme spotify:{track|album|playlist}:<id>  (or spotify:search:…)
 * Returns the canonical open URL (the original https/URI is fine for Linking).
 * Plain free-text queries (no URL/URI) return null → caller does in-app search.
 */
function detectSpotifyUrl(input?: string): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/^https?:\/\/(open|play)\.spotify\.com\/\S+/i.test(s)) return s;
  if (/^spotify:[a-z]+(:|$)/i.test(s)) return s;
  return null;
}

/** Convert a spotify: URI to its open.spotify.com web equivalent (fallback). */
function uriToWeb(uri: string): string {
  return uri.startsWith('spotify:')
    ? `${WEB_FALLBACK}/${uri.slice('spotify:'.length).replace(/:/g, '/')}`
    : `${WEB_FALLBACK}/search/${encodeURIComponent(uri)}`;
}

/**
 * Resolve a play/open request into a deep link.
 *
 *  - A Spotify URL/URI (in `url`, `uri`, or embedded in `query`) → open it
 *    directly so Spotify plays/opens that exact track/album/playlist.
 *  - A free-text query → open the Spotify IN-APP SEARCH (spotify:search:<q>),
 *    prefilled in the app, with a web search fallback.
 *
 * NOTE: true headless auto-play of a *query* would require resolving it to a
 * track id via the Spotify Web API, which needs Premium + OAuth — not available
 * here. The prefilled in-app search is the best free behavior; the user taps the
 * top result. (Direct URLs/URIs DO auto-play because they already carry the id.)
 */
function resolveTarget(opts: {
  url?: string;
  uri?: string;
  query?: string;
}): { uri: string; fallback: string } {
  // 1) An explicit URL/URI param, or a URL/URI pasted into the query field.
  const direct =
    detectSpotifyUrl(opts.url) ??
    detectSpotifyUrl(opts.uri) ??
    detectSpotifyUrl(opts.query);
  if (direct) {
    return {
      uri: direct,
      fallback: direct.startsWith('spotify:') ? uriToWeb(direct) : direct,
    };
  }
  // 2) A bare spotify: URI without a scheme prefix (legacy `uri` path).
  if (opts.uri) {
    return { uri: opts.uri, fallback: uriToWeb(opts.uri) };
  }
  // 3) A free-text query → prefilled in-app search (no auto-play; see NOTE).
  if (opts.query) {
    const q = encodeURIComponent(opts.query);
    return { uri: `${APP_PREFIX}search:${q}`, fallback: `${WEB_FALLBACK}/search/${q}` };
  }
  // 4) Nothing specific → just open Spotify.
  return { uri: APP_PREFIX, fallback: WEB_FALLBACK };
}

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
  url?: string;
  uri?: string;
  query?: string;
}): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  // A direct URL/URI (track/album/playlist) plays/opens straight away; a bare
  // query falls back to the prefilled in-app search (see resolveTarget NOTE).
  const { uri, fallback } = resolveTarget(opts);
  return open(uri, fallback);
}

/**
 * open — deep-link Spotify to a URL/URI or to the in-app search screen for a
 * query. Used by the spotify_open client-action when the user explicitly wants
 * to OPEN Spotify (vs. background-search via the server-side spotify_search).
 */
export async function openSpotify(opts: {
  url?: string;
  uri?: string;
  query?: string;
}): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  const { uri, fallback } = resolveTarget(opts);
  return open(uri, fallback);
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
