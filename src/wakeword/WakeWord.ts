import { NativeModulesProxy, EventEmitter } from 'expo-modules-core';

/**
 * Wake-word detection. Production uses Porcupine running inside the capture
 * foreground service on the same low-rate stream (no STT/credit cost). Three
 * phrases (plan E): "Hey Killio", "Oye Killio", and a per-agent
 * "Hey|Oye {CustomAgentName}".
 *
 * Native contract (KillioWakeWord Expo module, dev-build):
 *   start({ keywords: string[] }): Promise<void>
 *   stop(): Promise<void>
 *   event 'onWake' { keyword: string }
 *
 * Absent in Expo Go → isAvailable() false; the assistant falls back to
 * push-to-talk.
 */
const native = (NativeModulesProxy as any)?.KillioWakeWord ?? null;
const emitter: any = native ? new EventEmitter(native) : null;

export const BUILTIN_WAKE_PHRASES = ['Hey Killio', 'Oye Killio'];

/** Builds the phrase list for an optional custom agent name. */
export function wakePhrasesFor(agentName?: string): string[] {
  const phrases: string[] = [...BUILTIN_WAKE_PHRASES];
  const name = agentName?.trim();
  if (name) phrases.push(`Hey ${name}`, `Oye ${name}`);
  return phrases;
}

export function isAvailable(): boolean {
  return !!native;
}

export function onWake(cb: (keyword: string) => void): { remove(): void } {
  if (!emitter) return { remove() {} };
  const sub = emitter.addListener('onWake', (e: { keyword: string }) =>
    cb(e.keyword),
  );
  return { remove: () => sub.remove() };
}

export async function start(keywords: string[]): Promise<void> {
  if (!native) return;
  await native.start({ keywords });
}

export async function stop(): Promise<void> {
  if (!native) return;
  await native.stop();
}
