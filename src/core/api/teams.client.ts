import { api } from './http';
import { Team } from './types';

/** Lists the workspaces the current user belongs to. */
export async function listTeams(): Promise<Team[]> {
  const { data } = await api.get<Team[]>('/teams');
  return data.filter((t) => !t.isArchived);
}

/**
 * Resolves the user's personal workspace (teams.is_personal === true).
 * Default Vault target when the user has not picked a different workspace.
 */
export async function resolvePersonalTeam(): Promise<Team | null> {
  const teams = await listTeams();
  return teams.find((t) => t.isPersonal) ?? null;
}

/**
 * Workspaces this user is allowed to USE WITH VAULT given backend gating
 * (Free plan cannot use Vault on a non-personal workspace). This is a
 * client-side prediction — the backend is still the source of truth on
 * 403 — but it keeps the picker honest.
 */
export function vaultEligibleTeams(teams: Team[]): Team[] {
  return teams.filter((t) => {
    if (t.isPersonal) return true;
    const tier = (t.planTier ?? 'free').toLowerCase();
    return tier === 'pro' || tier === 'max' || tier === 'enterprise';
  });
}
