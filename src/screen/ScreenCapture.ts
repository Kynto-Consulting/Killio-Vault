import { NativeModulesProxy } from 'expo-modules-core';

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
const native = (NativeModulesProxy as any)?.KillioScreen ?? null;

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

export async function capture(): Promise<Screenshot | null> {
  if (!native) return null;
  return native.capture();
}

export async function listLocal(): Promise<Screenshot[]> {
  if (!native) return [];
  return native.list();
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
