import { Linking } from 'react-native';

/**
 * Spotify control via deep links. No SDK / OAuth required: we open the
 * Spotify app (or fall back to the web player) using the `spotify:` URI
 * scheme. This covers play(uri|query) and search. When Spotify isn't
 * installed, callers are routed to https://open.spotify.com.
 *
 * IMPORTANT LIMITATION: the public `spotify:` URI scheme has NO transport
 * control deep links — there is no URI that pauses, skips, or goes to the
 * previous track. Those require the Spotify Android App Remote SDK (a future
 * `modules/killio-spotify` Expo module). So pause/next/previous here can only
 * surface Spotify; they report `controlled:false` honestly so the assistant
 * tells the user to use the Spotify UI instead of claiming it skipped.
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
 * Surface Spotify. The deep-link scheme cannot pause/skip, so we just bring the
 * app forward and report that transport wasn't actually controlled.
 */
async function surface(): Promise<{ opened: boolean; controlled: false; reason: string }> {
  const reason =
    'Spotify deep links cannot control playback (pause/skip). Opened the app — use its controls.';
  try {
    if (await Linking.canOpenURL(APP_PREFIX)) {
      await Linking.openURL(APP_PREFIX);
      return { opened: true, controlled: false, reason };
    }
  } catch {
    /* not installed */
  }
  await Linking.openURL(WEB_FALLBACK);
  return { opened: true, controlled: false, reason };
}

export function pause() {
  return surface();
}

export function next() {
  return surface();
}

export function previous() {
  return surface();
}

export async function search(query: string): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  // Prefer the in-app search screen; fall back to the web search page.
  return open(
    `${APP_PREFIX}search:${encodeURIComponent(query)}`,
    `${WEB_FALLBACK}/search/${encodeURIComponent(query)}`,
  );
}
