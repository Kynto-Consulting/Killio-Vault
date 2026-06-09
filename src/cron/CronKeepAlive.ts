import * as Capture from '../capture/native/KillioCapture';
import { isCaptureFgsActive } from '../capture/capture-fgs-state';

/**
 * Keeps the JS runtime alive in the background for the cron scheduler.
 *
 * WHY: on Android the JS engine is suspended shortly after the screen turns off
 * UNLESS a foreground service (FGS) holds it. The CronRunner timer therefore
 * only survives backgrounding while some FGS is up.
 *
 * STRATEGY (no audio is ever recorded for cron):
 *   1. If capture already owns an FGS (24/7 / windows / system capture is on),
 *      cron rides on it for free — we do nothing.
 *   2. Otherwise, when there are active cron jobs, we start a dedicated
 *      NON-RECORDING keep-alive FGS (dataSync type, no mic, no RECORD_AUDIO) via
 *      the killio-capture native module. It is dropped again once no jobs remain
 *      or the scheduler stops.
 *
 * Resilience: every native call is best-effort and swallowed — failing to bring
 * up the FGS must never crash the app or break the tick. On Expo Go (no native
 * module) there is no way to stay alive in the background; cron then only catches
 * up when the app is next foregrounded (logged once).
 *
 * NATIVE HOOK: this depends on KillioCapture.startKeepAlive()/stopKeepAlive()
 * (VaultCaptureService keepAlive mode + the FOREGROUND_SERVICE_DATA_SYNC
 * permission). Those are NATIVE changes — a fresh APK build is required for the
 * background-cron behavior to take effect.
 */

/** Whether WE (cron) currently own a keep-alive FGS. */
let ourFgs = false;
/** Log the Expo-Go "no background" caveat only once. */
let warnedNoNative = false;

/** Ensure an FGS is up so the cron timer survives the screen turning off. */
export async function ensureCronKeepAlive(): Promise<void> {
  // Capture already holds an FGS → the JS stays alive; nothing to do. If we had
  // our own keep-alive up, drop it (capture's FGS now covers us).
  if (isCaptureFgsActive()) {
    if (ourFgs) await releaseCronKeepAlive();
    return;
  }
  if (ourFgs) return; // already keeping alive
  if (!Capture.canKeepAlive()) {
    if (!warnedNoNative) {
      warnedNoNative = true;
      try {
        // eslint-disable-next-line no-console
        console.warn(
          '[CronKeepAlive] No native FGS (Expo Go) — cron jobs only fire while the app is open.',
        );
      } catch {
        /* noop */
      }
    }
    return;
  }
  try {
    await Capture.startKeepAlive();
    ourFgs = true;
  } catch {
    // Couldn't start the service (permission/SDK) — cron degrades to
    // foreground-only. Never throw.
  }
}

/** Drop the cron-owned keep-alive FGS (if any). Safe to call repeatedly. */
export async function releaseCronKeepAlive(): Promise<void> {
  if (!ourFgs) return;
  ourFgs = false;
  try {
    await Capture.stopKeepAlive();
  } catch {
    /* best-effort */
  }
}
