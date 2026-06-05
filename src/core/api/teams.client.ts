import { api } from './http';
import { Team } from './types';

/** Lists the workspaces the current user belongs to. */
export async function listTeams(): Promise<Team[]> {
  const { data } = await api.get<Team[]>('/teams');
  return data;
}

/**
 * Resolves the user's personal workspace (teams.is_personal === true).
 * Vault writes the diary + Vault room into this team. Returns null if none
 * exists (shouldn't happen for a normal account, but the caller decides).
 */
export async function resolvePersonalTeam(): Promise<Team | null> {
  const teams = await listTeams();
  return teams.find((t) => t.isPersonal) ?? null;
}
