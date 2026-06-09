import { requireOptionalNativeModule } from 'expo-modules-core';

import { uploadFile } from '../core/api/uploads.client';
import { getPersonalTeamId } from '../core/auth/token-store';

/**
 * Screen capture (Android MediaProjection). Screenshots are stored LOCAL by
 * default; only uploaded when the AI calls vault_upload_screenshot (plan C3).
 *
 * Native contract (KillioScreen Expo module, added in the dev-build):
 *   requestPermission(): Promise<boolean>   — shows the MediaProjection consent
 *   capture(): Promise<{ id, uri, ts, width, height }>
 *   list(): Promise<Screenshot[]>           — local, most-recent first
 *
 * Absent in Expo Go → isAvailable() is false and capture is a no-op.
 */
interface KillioScreenSpec {
  requestPermission(): Promise<boolean>;
  capture(): Promise<Screenshot>;
  list(): Promise<Screenshot[]>;
  /** DIRECT screenshot path (AccessibilityService.takeScreenshot, API 30+):
   *  no MediaProjection consent dialog, no cast icon. Once the user enables the
   *  a11y service, capture() prefers this over MediaProjection. */
  isAccessibilityEnabled(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  captureViaAccessibility(): Promise<Screenshot>;
  /** Capture device PLAYBACK audio (remote call party / meeting / video) via
   *  AudioPlaybackCapture. Reuses the MediaProjection consent from
   *  requestPermission(). Emits 'onAudioFrame' (same shape as the mic path). */
  startSystemAudioCapture(opts: SystemAudioCaptureOptions): Promise<void>;
  stopSystemAudioCapture(): Promise<void>;
}

const native = requireOptionalNativeModule<KillioScreenSpec>('KillioScreen');

export interface Screenshot {
  id: string;
  uri: string;
  ts: number;
  width?: number;
  height?: number;
}

export function isAvailable(): boolean {
  return !!native;
}

export async function requestPermission(): Promise<boolean> {
  if (!native) return false;
  return native.requestPermission();
}

/**
 * True when the DIRECT screenshot path (AccessibilityService.takeScreenshot,
 * Android 11+) is enabled. When enabled, capture() screenshots without the
 * MediaProjection "start recording/casting?" prompt or the cast status-bar icon.
 */
export async function isAccessibilityEnabled(): Promise<boolean> {
  if (!native?.isAccessibilityEnabled) return false;
  try {
    return await native.isAccessibilityEnabled();
  } catch {
    return false;
  }
}

/** Opens Android's accessibility settings so the user can enable the direct path. */
export async function openAccessibilitySettings(): Promise<void> {
  if (!native?.openAccessibilitySettings) return;
  await native.openAccessibilitySettings();
}

/**
 * Captures the current screen.
 *
 * PREFERS the direct AccessibilityService path when enabled (no recording/cast
 * prompt, no cast icon); otherwise falls back to MediaProjection. No-op in
 * Expo Go (native module absent).
 */
export async function capture(): Promise<Screenshot | null> {
  if (!native) return null;
  if (await isAccessibilityEnabled()) {
    return native.captureViaAccessibility();
  }
  return native.capture();
}

export async function listLocal(): Promise<Screenshot[]> {
  if (!native) return [];
  return native.list();
}

// ---------------------------------------------------------------------------
// System-audio capture (device playback — the OTHER party in a call / a meeting
// / a video). Uses Android 10+ AudioPlaybackCapture under the SAME
// MediaProjection consent as screen capture. Emits PCM frames with the IDENTICAL
// shape as the mic path (KillioCapture.onAudioFrame), so the existing
// VAD/STT pipeline (CaptureController.handleFrame) ingests them unchanged.
// ---------------------------------------------------------------------------

/** Identical to KillioCapture.AudioFrameEvent so the same consumer handles both. */
export interface AudioFrameEvent {
  /** 16-bit PCM samples (-32768..32767). */
  samples: number[];
  sampleRate: number;
  /** UTC epoch ms for the frame start. */
  ts: number;
}

export interface SystemAudioCaptureOptions {
  sampleRate?: number;
  frameSamples?: number;
  /** Persistent notification text shown while capturing. */
  notificationText?: string;
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

/**
 * Starts system-audio (playback) capture. Acquires the MediaProjection consent
 * first if not already granted (reuses the screen-capture dialog). Throws if the
 * native module is absent or the user denies consent.
 */
export async function startSystemAudioCapture(
  opts: SystemAudioCaptureOptions = {},
): Promise<void> {
  if (!native) {
    throw new Error('KillioScreen native module unavailable (use dev-build).');
  }
  const granted = await native.requestPermission();
  if (!granted) throw new Error('MediaProjection permission denied.');
  await native.startSystemAudioCapture({
    sampleRate: opts.sampleRate ?? 16_000,
    frameSamples: opts.frameSamples ?? 320,
    notificationText:
      opts.notificationText ?? 'Killio Vault is capturing call audio',
  });
}

export async function stopSystemAudioCapture(): Promise<void> {
  if (!native) return;
  await native.stopSystemAudioCapture();
}

/**
 * Resolves a screenshot (by id, or the most recent) and uploads it to the cloud.
 * Returns the uploaded URL for the agent's tool result.
 */
export async function uploadScreenshot(
  screenshotId?: string,
): Promise<{ url?: string; key?: string }> {
  const shots = await listLocal();
  const shot = screenshotId
    ? shots.find((s) => s.id === screenshotId)
    : shots[0];
  if (!shot) throw new Error('No local screenshot available to upload.');

  const teamId = (await getPersonalTeamId()) ?? undefined;
  const result = await uploadFile({
    uri: shot.uri,
    name: `vault-screenshot-${shot.ts}.png`,
    type: 'image/png',
    ownerScopeType: teamId ? 'team' : undefined,
    ownerScopeId: teamId,
    usage: 'vault_screenshot',
  });
  return { url: result.url, key: result.key };
}
