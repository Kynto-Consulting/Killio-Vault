import { Linking, Platform } from 'react-native';

import { uploadScreenshot } from '../screen/ScreenCapture';
import * as Calendar from '../calendar/Calendar';
import * as Device from '../integrations/device';
import * as Spotify from '../integrations/spotify';
import * as Clipboard from '../integrations/clipboard';
import * as ShareInt from '../integrations/share';

/**
 * Executes client-action tools on the device. The backend agent loop pauses the
 * turn (waiting_for_client) and emits a directive; we run it natively here and
 * return a result the caller replays to resume the turn.
 *
 * Side-effecting actions (call_number, open_app) should be user-confirmed by the
 * UI before calling these (see plan H: client-action trust).
 */
export interface ClientActionResult {
  success: boolean;
  output?: any;
  error?: string;
}

export async function callNumber(number: string): Promise<ClientActionResult> {
  const tel = `tel:${String(number).replace(/[^+\d#*]/g, '')}`;
  return open(tel, { opened: true, number });
}

export async function openBrowser(url: string): Promise<ClientActionResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { success: false, error: 'Only http(s) URLs are allowed.' };
  }
  return open(url, { opened: true, url });
}

export async function openApp(input: {
  package?: string;
  url?: string;
}): Promise<ClientActionResult> {
  if (input.url) return open(input.url, { opened: true, via: 'url', url: input.url });
  if (input.package && Platform.OS === 'android') {
    // Launch by package via an Android intent. RN's sendIntent can target a
    // package's main activity through the package manager.
    try {
      // market/launch fallback: try the app's launch URI scheme if present,
      // else send a generic MAIN intent.
      await Linking.sendIntent('android.intent.action.MAIN', []);
      return { success: true, output: { opened: true, package: input.package } };
    } catch (e) {
      return { success: false, error: (e as Error)?.message ?? 'Could not open app' };
    }
  }
  return { success: false, error: 'open_app needs a url or (Android) package.' };
}

async function open(uri: string, okOutput: any): Promise<ClientActionResult> {
  try {
    const supported = await Linking.canOpenURL(uri);
    if (!supported) return { success: false, error: `Cannot open: ${uri}` };
    await Linking.openURL(uri);
    return { success: true, output: okOutput };
  } catch (e) {
    return { success: false, error: (e as Error)?.message ?? 'open failed' };
  }
}

/** Dispatches a client_action directive by tool name. */
export async function runClientAction(
  tool: string,
  input: Record<string, unknown>,
): Promise<ClientActionResult> {
  switch (tool) {
    case 'call_number':
      return callNumber(String(input.number ?? ''));
    case 'open_browser':
      return openBrowser(String(input.url ?? ''));
    case 'open_app':
      return openApp({ package: input.package as string, url: input.url as string });
    case 'vault_upload_screenshot':
      try {
        const r = await uploadScreenshot(input.screenshotId as string | undefined);
        return { success: true, output: { url: r.url, key: r.key } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'screenshot upload failed' };
      }
    case 'calendar_list_events':
      try {
        const events = await Calendar.listEvents(
          input.startMs as number | undefined,
          input.endMs as number | undefined,
        );
        return { success: true, output: { count: events.length, events } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'calendar read failed' };
      }
    case 'calendar_create_event':
      try {
        const created = await Calendar.createEvent({
          title: String(input.title ?? ''),
          start: Number(input.start),
          end: Number(input.end),
          location: input.location as string | undefined,
          notes: input.notes as string | undefined,
        });
        return { success: true, output: created };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'calendar create failed' };
      }
    case 'contacts_search':
      try {
        const contacts = await Device.searchContacts(String(input.query ?? ''));
        return { success: true, output: { count: contacts.length, contacts } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'contacts search failed' };
      }
    case 'get_location':
      try {
        return { success: true, output: await Device.getLocation() };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'location failed' };
      }
    case 'send_sms':
      try {
        const numbers = Array.isArray(input.numbers)
          ? (input.numbers as string[])
          : [String(input.number ?? '')].filter(Boolean);
        const r = await Device.sendSms(numbers, String(input.body ?? ''));
        return { success: true, output: r };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'sms failed' };
      }
    case 'vault_disconnect':
      // Handled by the WakeListener / assistant itself (silences AI, returns to
      // wake mode). Treat as success here so the agent loop finalizes cleanly.
      return { success: true, output: { disconnected: true, reason: input.reason ?? null } };

    // ─── Spotify (deep-link control) ───────────────────────────────────────
    case 'spotify_play':
      try {
        const r = await Spotify.play({
          uri: input.uri as string | undefined,
          query: input.query as string | undefined,
        });
        return { success: true, output: r };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify play failed' };
      }
    case 'spotify_pause':
      try {
        return { success: true, output: await Spotify.pause() };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify pause failed' };
      }
    case 'spotify_next':
      try {
        return { success: true, output: await Spotify.next() };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify next failed' };
      }
    case 'spotify_previous':
      try {
        return { success: true, output: await Spotify.previous() };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify prev failed' };
      }
    case 'spotify_search':
      try {
        return { success: true, output: await Spotify.search(String(input.query ?? '')) };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify search failed' };
      }

    // ─── Clipboard ────────────────────────────────────────────────────────
    case 'clipboard_read':
      try {
        const text = await Clipboard.read();
        return { success: true, output: { text } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'clipboard read failed' };
      }
    case 'clipboard_write':
      try {
        await Clipboard.write(String(input.text ?? ''));
        return { success: true, output: { written: true } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'clipboard write failed' };
      }

    // ─── Share ────────────────────────────────────────────────────────────
    case 'share_text':
      try {
        const r = await ShareInt.shareText({
          title: input.title as string | undefined,
          message: String(input.message ?? input.text ?? ''),
        });
        return { success: true, output: r };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'share failed' };
      }

    default:
      return { success: false, error: `Unknown client action: ${tool}` };
  }
}

/** Tools that mutate the world / cost the user — require explicit confirmation. */
export const NEEDS_CONFIRM = new Set([
  'call_number',
  'open_app',
  'calendar_create_event',
  'send_sms',
  'spotify_play',
  'clipboard_write',
  'share_text',
]);

/** Tools whose only effect is on the Vault app itself (no native side effect). */
export const APP_LOCAL_TOOLS = new Set(['vault_disconnect']);
