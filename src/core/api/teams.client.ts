import { api } from './http';
import { Team } from './types';

export interface BoardCatalogEntry {
  id: string;
  name: string;
  slug: string;
  boardType?: 'kanban' | 'mesh';
  description?: string | null;
}

export interface TeamCatalog {
  boards: BoardCatalogEntry[];
  documents: { id: string; title: string }[];
  cards: { id: string; title: string; boardId: string; boardName: string }[];
}

export async function getTeamCatalog(teamId: string): Promise<TeamCatalog> {
  const { data } = await api.get<TeamCatalog>(`/teams/${teamId}/catalog`);
  return {
    boards: data?.boards ?? [],
    documents: data?.documents ?? [],
    cards: data?.cards ?? [],
  };
}

export interface TeamMember {
  /** users.id — pass this to addCardAssignee. */
  id: string;
  /** team_memberships.id — only useful for membership-level mutations. */
  membershipId?: string;
  role?: string;
  name?: string;
  displayName?: string;
  baseDisplayName?: string;
  email?: string;
  avatarUrl?: string | null;
}

/** Lists active members of a team. Backend route: `GET /teams/:teamId/members`. */
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data } = await api.get<TeamMember[]>(`/teams/${teamId}/members`);
  return data ?? [];
}

/** Lists the workspaces the current user belongs to. */
export async function listTeams(): Promise<Team[]> {
  const { data } = await api.get<Team[]>('/teams');
  return data.filter((t) => !t.isArchived);
}

/** Creates a new cloud workspace owned by the current user. */
export async function createTeam(input: {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
}): Promise<Team> {
  const { data } = await api.post<Team>('/teams', input);
  return data;
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
