import { Linking, Platform } from 'react-native';

import { uploadScreenshot } from '../screen/ScreenCapture';
import * as Calendar from '../calendar/Calendar';
import * as Device from '../integrations/device';
import * as Spotify from '../integrations/spotify';
import * as AppIntent from '../integrations/appIntent';
import * as Clipboard from '../integrations/clipboard';
import * as ShareInt from '../integrations/share';
import * as DeviceControls from '../integrations/deviceControls';
import * as AppLinks from '../integrations/appDeepLinks';
import * as Cron from '../cron/cron.store';

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
        // A Spotify URL/URI (in `url`, `uri`, or pasted into `query`) plays
        // directly; a free-form query opens the prefilled in-app search. The
        // backend may also resolve a query → track URI before sending this.
        const r = await Spotify.play({
          url: input.url as string | undefined,
          uri: input.uri as string | undefined,
          query: input.query as string | undefined,
        });
        return tag({
          success: true,
          output: {
            ...r,
            ...(input.url ? { url: input.url } : {}),
            ...(input.uri ? { uri: input.uri } : {}),
          },
        });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'spotify play failed' };
      }
    case 'spotify_open':
      try {
        const r = await Spotify.openSpotify({
          url: input.url as string | undefined,
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

    // ─── Installed-app discovery + launch (device) ──────────────────────────
    case 'list_installed_apps':
      try {
        const apps = await AppIntent.listInstalledApps();
        return {
          success: true,
          output: {
            count: apps.length,
            apps: apps.map((a) => ({ label: a.label, package: a.packageName })),
          },
        };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'list installed apps failed' };
      }
    case 'search_app':
      try {
        const matches = await AppIntent.searchApps(String(input.query ?? ''));
        const apps = matches.map((a) => ({ label: a.label, package: a.packageName }));
        // Optionally open straight away: when `open` is set and there's a single
        // (or unambiguous top) match, launch it and end the chat if asked.
        if (input.open === true && apps.length > 0) {
          const target = apps[0];
          try {
            const r = await AppIntent.launchApp(target.package);
            return tag({
              success: true,
              output: { count: apps.length, apps, opened: true, launched: { ...target, ...r } },
            });
          } catch (e) {
            return {
              success: false,
              error: (e as Error)?.message ?? `could not open ${target.package}`,
            };
          }
        }
        return { success: true, output: { count: apps.length, apps } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'search app failed' };
      }
    case 'open_installed_app':
      try {
        const r = await AppIntent.launchApp(String(input.package ?? ''));
        return tag({ success: true, output: { opened: true, package: r.packageName } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'open installed app failed' };
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

    // ─── App deep-links (Gemini-style app control via Android Intents) ─────────
    case 'youtube_search':
      try {
        const r = await AppLinks.youtubeSearch(String(input.query ?? ''));
        return tag({ success: true, output: { ...r, app: 'youtube', query: input.query ?? '' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'youtube search failed' };
      }
    case 'youtube_open':
      try {
        const r = await AppLinks.youtubeOpen({
          url: input.url as string | undefined,
          videoId: input.videoId as string | undefined,
        });
        return tag({ success: true, output: { ...r, app: 'youtube' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'youtube open failed' };
      }
    case 'maps_search':
      try {
        const r = await AppLinks.mapsSearch(String(input.query ?? ''));
        return tag({ success: true, output: { ...r, app: 'maps', query: input.query ?? '' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'maps search failed' };
      }
    case 'maps_navigate':
      try {
        const r = await AppLinks.mapsNavigate(String(input.destination ?? ''));
        return tag({ success: true, output: { ...r, app: 'maps', destination: input.destination ?? '' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'maps navigate failed' };
      }
    case 'instagram_open':
      try {
        const r = await AppLinks.instagramOpen(input.username as string | undefined);
        return tag({ success: true, output: { ...r, app: 'instagram', username: input.username ?? null } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'instagram open failed' };
      }
    case 'gmail_compose':
      try {
        const r = await AppLinks.gmailCompose({
          to: input.to as string | undefined,
          subject: input.subject as string | undefined,
          body: input.body as string | undefined,
        });
        return tag({ success: true, output: { ...r, app: 'gmail', to: input.to ?? null } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'gmail compose failed' };
      }
    case 'twitter_search':
      try {
        const r = await AppLinks.twitterSearch(String(input.query ?? ''));
        return tag({ success: true, output: { ...r, app: 'twitter', query: input.query ?? '' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'twitter search failed' };
      }
    case 'x_open':
      try {
        const r = await AppLinks.xOpen({
          url: input.url as string | undefined,
          username: input.username as string | undefined,
        });
        return tag({ success: true, output: { ...r, app: 'twitter', username: input.username ?? null } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'x open failed' };
      }
    case 'telegram_open':
      try {
        const r = await AppLinks.telegramOpen(input.username as string | undefined);
        return tag({ success: true, output: { ...r, app: 'telegram', username: input.username ?? null } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'telegram open failed' };
      }
    case 'tiktok_search':
      try {
        const r = await AppLinks.tiktokSearch(String(input.query ?? ''));
        return tag({ success: true, output: { ...r, app: 'tiktok', query: input.query ?? '' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'tiktok search failed' };
      }
    case 'play_store_open':
      try {
        const r = await AppLinks.playStoreOpen({
          package: input.package as string | undefined,
          query: input.query as string | undefined,
        });
        return tag({ success: true, output: { ...r, app: 'play_store' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'play store open failed' };
      }
    case 'uber_request':
      try {
        const r = await AppLinks.uberRequest(input.dropoff as string | undefined);
        return tag({ success: true, output: { ...r, app: 'uber', dropoff: input.dropoff ?? null } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'uber request failed' };
      }
    case 'open_deeplink':
      try {
        const r = await AppLinks.openDeeplink(String(input.uri ?? ''));
        return tag({ success: true, output: { ...r, app: 'deeplink' } });
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'open deeplink failed' };
      }

    // ─── Local cron jobs (on-device recurring prompts) ─────────────────────────
    // LOCAL-ONLY: jobs only fire while the Vault app is alive (see CronRunner).
    case 'cron_create':
      try {
        const r = Cron.createCronJob({
          schedule: String(input.schedule ?? ''),
          prompt: String(input.prompt ?? ''),
          conversationId: (input.conversationId as string | undefined) ?? null,
          label: (input.label as string | undefined) ?? null,
          maxRuns: input.maxRuns as number | undefined,
        });
        if (!r.created) return { success: false, error: r.error ?? 'could not create cron job' };
        return {
          success: true,
          output: {
            created: true,
            id: r.id,
            nextRun: r.nextRun ?? null,
            // Surfaced so the AI reminds the user of the local-only limitation.
            note: 'Runs locally only while the Vault app is open.',
          },
        };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'cron create failed' };
      }
    case 'cron_list':
      try {
        const jobs = Cron.listCronJobs().map((j) => ({
          id: j.id,
          schedule: j.schedule,
          prompt: j.prompt,
          label: j.label,
          conversationId: j.conversation_id,
          active: j.active === 1,
          runsDone: j.runs_done,
          maxRuns: j.max_runs,
          nextRun: j.next_run_at,
          lastRun: j.last_run_at,
        }));
        return { success: true, output: { count: jobs.length, jobs } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'cron list failed' };
      }
    case 'cron_delete':
      try {
        const deleted = Cron.deleteCronJob(String(input.id ?? ''));
        return { success: true, output: { deleted, id: input.id ?? null } };
      } catch (e) {
        return { success: false, error: (e as Error)?.message ?? 'cron delete failed' };
      }

    default:
      return { success: false, error: `Unknown client action: ${tool}` };
  }
}

/** Tools that mutate the world / cost the user — require explicit confirmation. */
export const NEEDS_CONFIRM = new Set([
  'call_number',
  'open_app',
  'open_installed_app',
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
  // Transactional app deep-link (costs the user money) — confirm. Searches/opens do not.
  'uber_request',
]);

/** Tools whose only effect is on the Vault app itself (no native side effect). */
export const APP_LOCAL_TOOLS = new Set(['vault_disconnect']);
