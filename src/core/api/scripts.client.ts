import { api } from './http';

/**
 * Backend scripts (Killio workspace automations) — webhook-triggered scripts
 * power the form brick's "Conectar script" picker. Mirrors the web frontend
 * `@/lib/api/scripts` contract (the backend `/scripts` endpoint is the same
 * one consumed by the web app, so the shape is identical).
 */

export interface ScriptTriggerConfig {
  publicToken?: string;
  [k: string]: unknown;
}

export interface ScriptSummary {
  id: string;
  teamId: string;
  name: string;
  triggerType: string;
  triggerConfig?: ScriptTriggerConfig;
  isActive: boolean;
}

/**
 * Lists the team's scripts. The web frontend signature is
 * `listScripts(teamId, accessToken)` — we keep the parameter shape so callers
 * port over without changes (the Vault axios interceptor injects the bearer
 * token automatically; the accessToken arg is therefore ignored here, but kept
 * for source-parity with the web file).
 */
export async function listScripts(
  teamId: string,
  _accessToken?: string,
): Promise<ScriptSummary[]> {
  const { data } = await api.get<ScriptSummary[]>('/scripts', {
    params: { teamId },
  });
  return Array.isArray(data) ? data : [];
}
