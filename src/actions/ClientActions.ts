import { Linking, Platform } from 'react-native';

import { uploadScreenshot } from '../screen/ScreenCapture';
import * as Calendar from '../calendar/Calendar';
import * as Device from '../integrations/device';
import * as Spotify from '../integrations/spotify';
import * as AppIntent from '../integrations/appIntent';
import * as Clipboard from '../integrations/clipboard';
import * as ShareInt from '../integrations/share';
import * as DeviceControls from '../integrations/deviceControls';

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
  /** When true, the assistant has flagged this as the last tool call of the
   *  turn — Vault should silence the AI and return to wake-word mode after
   *  delivering the result. Set by the dispatcher when the AI emits the
   *  tool with `endConversation: true` on the input. */
  endConversation?: boolean;
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
    // Launch the app by package. There is no RN/Linking API that resolves a
    // package's launch intent, so we open its Play Store / market page as a
    // reliable, always-resolvable target (the previous empty MAIN intent
    // silently launched nothing and falsely reported success). If the Play
    // Store app is present it deep-links straight into the installed app's
    // store page from which the user can open it.
    const market = `market://details?id=${encodeURIComponent(input.package)}`;
    const web = `https://play.google.com/store/apps/details?id=${encodeURIComponent(input.package)}`;
    try {
      if (await Linking.canOpenURL(market)) {
        await Linking.openURL(market);
        return { success: true, output: { opened: true, package: input.package, via: 'market' } };
      }
      await Linking.openURL(web);
      return { success: true, output: { opened: true, package: input.package, via: 'web' } };
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
  const endConversation = input.endConversation === true;
  const tag = (r: ClientActionResult): ClientActionResult =>
    endConversation ? { ...r, endConversation: true } : r;
  // Diagnostic: surfaces the real device-side result/error in logcat (tag
  // KillioCA) so a failing client-action can be traced even in release builds.
  const trace = (r: ClientActionResult): ClientActionResult => {
    try { console.warn(`[KillioCA] ${tool} ->`, JSON.stringify(r)); } catch { /* noop */ }
    return r;
  };
  try {
    return trace(await dispatchClientAction(tool, input, tag));
  } catch (e) {
    return trace({ success: false, error: (e as Error)?.message ?? `${tool} threw` });
  }
}

async function dispatchClientAction(
  tool: string,
  input: Record<string, unknown>,
  tag: (r: ClientActionResult) => ClientActionResult,
): Promise<ClientActionResult> {
  switch (tool) {
    case 'call_number':
      return tag(await callNumber(String(input.number ?? '')));
    case 'open_browser':
      return tag(await openBrowser(String(input.url ?? '')));
    case 'open_app':
      return tag(await openApp({ package: input.package as string, url: input.url as string }));
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
        // Echo the event details back (not just the id) so the AI can confirm
        // what it scheduled in its reply.
        return tag({
          success: true,
          output: {
            created: true,
            id: (created as any)?.id ?? null,
            title: String(input.title ?? ''),
            start: Number(input.start),
            end: Number(input.end),
            location: input.location ?? null,
          },
        });
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
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'sms failed' };
      }
    case 'vault_disconnect':
      // Handled by the WakeListener / assistant itself (silences AI, returns to
      // wake mode). Treat as success here so the agent loop finalizes cleanly.
      return { success: true, output: { disconnected: true, reason: input.reason ?? null } };

    // ─── Spotify ───────────────────────────────────────────────────────────
    // NOTE: spotify_search + spotify_current are SERVER-SIDE (Spotify Web API),
    // handled in the backend tool-executor — they never reach the device.
    case 'spotify_play':
      try {
        // The backend resolves a free-form query → track URI before sending
        // this action, so `uri` is usually present. play(uri) plays directly.
        const r = await Spotify.play({
          uri: input.uri as string | undefined,
          query: input.query as string | undefined,
        });
        return tag({ success: true, output: { ...r, ...(input.uri ? { uri: input.uri } : {}) } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify play failed' };
      }
    case 'spotify_open':
      try {
        const r = await Spotify.openSpotify({
          uri: input.uri as string | undefined,
          query: input.query as string | undefined,
        });
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify open failed' };
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

    // ─── App intents (WhatsApp call/message — App-Action style) ─────────────
    case 'whatsapp_message':
      try {
        const r = await AppIntent.whatsappMessage(
          String(input.phone ?? ''),
          input.text as string | undefined,
        );
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'whatsapp message failed' };
      }
    case 'whatsapp_call':
      try {
        const r = await AppIntent.whatsappCall(String(input.phone ?? ''));
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'whatsapp call failed' };
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
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'share failed' };
      }

    // ─── Device controls (file/battery/torch/brightness/alarm/vibrate/info) ─
    case 'pick_file':
      try {
        const r = await DeviceControls.pickFile(
          input.type as 'any' | 'image' | 'pdf' | 'text' | undefined,
        );
        return { success: true, output: r };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'file pick failed' };
      }
    case 'battery_status':
      try {
        return { success: true, output: await DeviceControls.batteryStatus() };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'battery status failed' };
      }
    case 'flashlight':
      try {
        return { success: true, output: await DeviceControls.setFlashlight(input.on === true) };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'flashlight failed' };
      }
    case 'set_brightness':
      try {
        const r = await DeviceControls.setBrightness({
          level: input.level as number | undefined,
          restore: input.restore as boolean | undefined,
        });
        return { success: true, output: r };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'set brightness failed' };
      }
    case 'set_alarm':
      try {
        const r = await DeviceControls.setAlarm({
          hour: Number(input.hour),
          minute: Number(input.minute),
          label: input.label as string | undefined,
        });
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'set alarm failed' };
      }
    case 'set_timer':
      try {
        const r = await DeviceControls.setTimer({
          seconds: Number(input.seconds),
          label: input.label as string | undefined,
        });
        return tag({ success: true, output: r });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'set timer failed' };
      }
    case 'vibrate':
      try {
        const r = await DeviceControls.vibrate(
          input.pattern as 'light' | 'medium' | 'heavy' | 'success' | 'error' | undefined,
        );
        return { success: true, output: r };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'vibrate failed' };
      }
    case 'device_info':
      try {
        return { success: true, output: await DeviceControls.deviceInfo() };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'device info failed' };
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
  'spotify_open',
  'whatsapp_message',
  'whatsapp_call',
  'clipboard_write',
  'share_text',
  'set_alarm',
  'set_timer',
  'set_brightness',
  'flashlight',
]);

/** Tools whose only effect is on the Vault app itself (no native side effect). */
export const APP_LOCAL_TOOLS = new Set(['vault_disconnect']);
