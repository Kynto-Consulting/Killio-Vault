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
