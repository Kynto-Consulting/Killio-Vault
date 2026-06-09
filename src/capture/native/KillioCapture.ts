import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Thin TS wrapper over the native `KillioCapture` Expo module (Kotlin), which
 * runs the Android foreground service + AudioRecord and streams 16-bit mono PCM
 * frames to JS. Absent in Expo Go — `isAvailable()` lets callers fall back.
 *
 * Native contract:
 *   start(opts): Promise<void>   — start FGS + mic, begins emitting 'onAudioFrame'
 *   stop(): Promise<void>
 *   Event 'onAudioFrame' { samples:number[], sampleRate:number, ts:number }
 *   Event 'onError'      { message:string }
 */
const native: any = requireOptionalNativeModule('KillioCapture');

export interface AudioFrameEvent {
  /** 16-bit PCM samples (-32768..32767). */
  samples: number[];
  sampleRate: number;
  /** UTC epoch ms for the frame start. */
  ts: number;
}

export interface CaptureStartOptions {
  sampleRate?: number;
  frameSamples?: number;
  /** Persistent notification text shown while recording. */
  notificationText?: string;
}

export function isAvailable(): boolean {
  return !!native;
}

// In expo-modules-core 2.x the native module is itself the event emitter.
const emitter: any = native;

export function onAudioFrame(
  cb: (e: AudioFrameEvent) => void,
): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onAudioFrame', cb);
  return { remove: () => sub.remove() };
}

export function onError(cb: (e: { message: string }) => void): {
  remove(): void;
} {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onError', cb);
  return { remove: () => sub.remove() };
}

export async function start(opts: CaptureStartOptions = {}): Promise<void> {
  if (!native) throw new Error('KillioCapture native module unavailable (use dev-build).');
  await native.start({
    sampleRate: opts.sampleRate ?? 16_000,
    frameSamples: opts.frameSamples ?? 320,
    notificationText: opts.notificationText ?? 'Killio Vault is listening',
  });
}

export async function stop(): Promise<void> {
  if (!native) return;
  await native.stop();
}

/**
 * Start a NON-RECORDING foreground service purely to keep the JS runtime alive
 * in the background (so timers like the cron scheduler keep firing with the
 * screen off). No microphone is opened — it uses the dataSync FGS type and needs
 * no RECORD_AUDIO. No-op (throws-free) when the native module is absent (Expo
 * Go) — callers treat that as "can't keep alive in background". */
export async function startKeepAlive(
  notificationText = 'Killio Vault tasks running',
): Promise<void> {
  if (!native) throw new Error('KillioCapture native module unavailable (use dev-build).');
  await native.start({ keepAlive: true, notificationText });
}

/** Stop the keep-alive (or any) capture service. */
export async function stopKeepAlive(): Promise<void> {
  if (!native) return;
  await native.stop();
}

/** True when the native keep-alive FGS is usable on this build. */
export function canKeepAlive(): boolean {
  return !!native;
}

/**
 * Whether the app is exempt from Doze / battery optimization. When false,
 * Android can suspend the capture foreground service while the screen is off.
 * Returns true when the native module is absent (nothing to gate in Expo Go).
 */
export function isIgnoringBatteryOptimizations(): boolean {
  if (!native?.isIgnoringBatteryOptimizations) return true;
  try {
    return !!native.isIgnoringBatteryOptimizations();
  } catch {
    return true;
  }
}

/** Opens the system dialog to exempt the app from battery optimization. No-op
 *  if already exempt or the native module is unavailable. */
export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (!native?.requestIgnoreBatteryOptimizations) return;
  try {
    await native.requestIgnoreBatteryOptimizations();
  } catch {
    // user dismissed / no settings activity — non-fatal.
  }
}
