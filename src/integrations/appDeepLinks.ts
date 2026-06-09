import { Linking } from 'react-native';

/**
 * Gemini-style app control via Android deep-link Intents — open + search common
 * installed apps directly (no QR, no OAuth, no native module). Each helper tries
 * the app's deep scheme first via `Linking.canOpenURL`, then ALWAYS falls back
 * to an https web URL so the action resolves even when the app isn't installed.
 *
 * Mirrors the existing deep-link pattern in spotify.ts / ClientActions.ts (the
 * `open()` helper). Pure Linking — NO native code, so NO rebuild is needed.
 */

const enc = (s: string) => encodeURIComponent(String(s ?? '').trim());

/** Try the app deep-link, fall back to the web URL. Always resolves. */
async function openWithFallback(
  appUri: string | null,
  webUri: string,
): Promise<{ opened: boolean; via: 'app' | 'web' }> {
  if (appUri) {
    try {
      if (await Linking.canOpenURL(appUri)) {
        await Linking.openURL(appUri);
        return { opened: true, via: 'app' };
      }
    } catch {
      /* fall through to web */
    }
  }
  await Linking.openURL(webUri);
  return { opened: true, via: 'web' };
}

// ─── YouTube ────────────────────────────────────────────────────────────────
export async function youtubeSearch(query: string) {
  const web = `https://www.youtube.com/results?search_query=${enc(query)}`;
  // The YouTube app registers the https host, so canOpenURL(web) resolves it to
  // the app when installed; the same URL is the web fallback.
  return openWithFallback(web, web);
}

export async function youtubeOpen(opts: { url?: string; videoId?: string }) {
  const web = opts.url
    ? String(opts.url)
    : `https://www.youtube.com/watch?v=${enc(opts.videoId ?? '')}`;
  const app = opts.videoId ? `vnd.youtube:${enc(opts.videoId)}` : web;
  return openWithFallback(app, web);
}

// ─── Maps ─────────────────────────────────────────────────────────────────────
export async function mapsSearch(query: string) {
  const app = `geo:0,0?q=${enc(query)}`;
  const web = `https://www.google.com/maps/search/?api=1&query=${enc(query)}`;
  return openWithFallback(app, web);
}

export async function mapsNavigate(destination: string) {
  const app = `google.navigation:q=${enc(destination)}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${enc(destination)}`;
  return openWithFallback(app, web);
}

// ─── Instagram ──────────────────────────────────────────────────────────────
export async function instagramOpen(username?: string) {
  const u = (username ?? '').replace(/^@/, '').trim();
  if (!u) return openWithFallback('instagram://app', 'https://instagram.com');
  const app = `instagram://user?username=${enc(u)}`;
  const web = `https://instagram.com/${enc(u)}`;
  return openWithFallback(app, web);
}

// ─── Gmail / mail ─────────────────────────────────────────────────────────────
export async function gmailCompose(opts: {
  to?: string;
  subject?: string;
  body?: string;
}) {
  // mailto: is the most reliable — any installed mail app handles it.
  const params: string[] = [];
  if (opts.subject) params.push(`subject=${enc(opts.subject)}`);
  if (opts.body) params.push(`body=${enc(opts.body)}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  const mailto = `mailto:${enc(opts.to ?? '').replace(/%40/g, '@')}${qs}`;
  // No real web fallback for compose; mailto always resolves to a mail app.
  await Linking.openURL(mailto);
  return { opened: true, via: 'app' as const };
}

// ─── Twitter / X ──────────────────────────────────────────────────────────────
export async function twitterSearch(query: string) {
  const web = `https://twitter.com/search?q=${enc(query)}`;
  return openWithFallback(web, web);
}

export async function xOpen(opts: { url?: string; username?: string }) {
  const u = (opts.username ?? '').replace(/^@/, '').trim();
  const web = opts.url
    ? String(opts.url)
    : u
      ? `https://twitter.com/${enc(u)}`
      : 'https://twitter.com';
  return openWithFallback(web, web);
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
export async function telegramOpen(username?: string) {
  const u = (username ?? '').replace(/^@/, '').trim();
  if (!u) return openWithFallback('tg://', 'https://t.me');
  const app = `tg://resolve?domain=${enc(u)}`;
  const web = `https://t.me/${enc(u)}`;
  return openWithFallback(app, web);
}

// ─── TikTok ───────────────────────────────────────────────────────────────────
export async function tiktokSearch(query: string) {
  // TikTok has no reliable search scheme — use the web search URL.
  const web = `https://www.tiktok.com/search?q=${enc(query)}`;
  return openWithFallback(web, web);
}

// ─── Play Store ───────────────────────────────────────────────────────────────
export async function playStoreOpen(opts: { package?: string; query?: string }) {
  if (opts.package) {
    const app = `market://details?id=${enc(opts.package)}`;
    const web = `https://play.google.com/store/apps/details?id=${enc(opts.package)}`;
    return openWithFallback(app, web);
  }
  const q = opts.query ?? '';
  const app = `market://search?q=${enc(q)}`;
  const web = `https://play.google.com/store/search?q=${enc(q)}`;
  return openWithFallback(app, web);
}

// ─── Uber ─────────────────────────────────────────────────────────────────────
export async function uberRequest(dropoff?: string) {
  const app = dropoff
    ? `uber://?action=setPickup&pickup=my_location&dropoff[formatted_address]=${enc(dropoff)}`
    : 'uber://?action=setPickup&pickup=my_location';
  const web = dropoff
    ? `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${enc(dropoff)}`
    : 'https://m.uber.com/';
  return openWithFallback(app, web);
}

// ─── Generic escape hatch ─────────────────────────────────────────────────────
/** Schemes the AI is allowed to open via open_deeplink. */
const ALLOWED_SCHEMES = new Set([
  'https',
  'geo',
  'tel',
  'mailto',
  'tg',
  'instagram',
  'spotify',
  'youtube',
  'vnd.youtube',
  'market',
  'google.navigation',
  'whatsapp',
  'uber',
]);

export async function openDeeplink(uri: string): Promise<{
  opened: boolean;
  via: 'app' | 'web';
  uri: string;
}> {
  const raw = String(uri ?? '').trim();
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9.+-]*):/);
  const scheme = (m?.[1] ?? '').toLowerCase();
  if (!scheme || !ALLOWED_SCHEMES.has(scheme)) {
    throw new Error(`Scheme not allowed: ${scheme || '(none)'}`);
  }
  const r = await openWithFallback(raw, raw);
  return { ...r, uri: raw };
}
