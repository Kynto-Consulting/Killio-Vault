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
  status?: string;
  name?: string;
  displayName?: string;
  baseDisplayName?: string;
  /** Workspace-scoped alias (preferred display name in the team). */
  alias?: string | null;
  workspaceAlias?: string | null;
  email?: string;
  primaryEmail?: string;
  avatarUrl?: string | null;
  joinedAt?: string | null;
}

/** Lists active members of a team. Backend route: `GET /teams/:teamId/members`. */
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data } = await api.get<TeamMember[]>(`/teams/${teamId}/members`);
  return data ?? [];
}

// ── Invites ────────────────────────────────────────────────────────────────
// Re-exported from `@/types/contracts` so this stays in sync with the web app.
export type { TeamRole } from '@/types';

export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  /** 'pending' | 'accepted' | 'revoked' | 'expired'. */
  status: string;
  /** 'sent' | 'skipped' | 'failed' — populated by backend after mail send. */
  deliveryStatus?: string;
  createdAt: string;
  expiresAt?: string | null;
  invitedBy?: string | null;
  /** Raw token — backend echoes it ONLY on the POST response (never on list). */
  token?: string | null;
  /** Canonical accept-invite URL (`<FRONTEND>/accept-invite?token=…`). */
  acceptUrl?: string | null;
}

/** Lists pending/accepted invites. Backend route: `GET /teams/:teamId/invites`. */
export async function listTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const { data } = await api.get<TeamInvite[]>(`/teams/${teamId}/invites`);
  return data ?? [];
}

/** Sends an invite. Backend route: `POST /teams/:teamId/invites`. */
export async function inviteMember(
  teamId: string,
  body: { email: string; role: string },
): Promise<TeamInvite> {
  const { data } = await api.post<TeamInvite>(`/teams/${teamId}/invites`, body);
  return data;
}

/** Revokes a pending invite. Backend route: `DELETE /teams/:teamId/invites/:inviteId`. */
export async function revokeInvite(teamId: string, inviteId: string): Promise<void> {
  await api.delete(`/teams/${teamId}/invites/${inviteId}`);
}

/** Accepts an invite by token. Backend route: `POST /teams/invites/accept`. */
export async function acceptInvite(token: string): Promise<{
  teamId: string;
  teamName?: string;
  role?: string;
  inviteId?: string;
}> {
  const { data } = await api.post<{
    teamId: string;
    teamName?: string;
    role?: string;
    inviteId?: string;
    accepted?: boolean;
  }>('/teams/invites/accept', { token });
  return data;
}

// ── Member mutations ───────────────────────────────────────────────────────

/** Updates a member's role. Backend route: `PATCH /teams/:teamId/members/:memberId`. */
export async function updateMemberRole(
  teamId: string,
  membershipId: string,
  role: string,
): Promise<{ membershipId: string; role: string }> {
  const { data } = await api.patch<{ membershipId: string; role: string; updated?: boolean }>(
    `/teams/${teamId}/members/${membershipId}`,
    { role },
  );
  return data;
}

/** Updates a member's workspace alias. Backend route: `PATCH /teams/:teamId/members/:memberId/alias`. */
export async function updateMemberAlias(
  teamId: string,
  membershipId: string,
  alias: string | null,
): Promise<{ membershipId: string; id: string; alias: string | null }> {
  const { data } = await api.patch<{ membershipId: string; id: string; alias: string | null }>(
    `/teams/${teamId}/members/${membershipId}/alias`,
    { alias },
  );
  return data;
}

/** Removes a member from the team. Backend route: `DELETE /teams/:teamId/members/:memberId`. */
export async function removeMember(teamId: string, membershipId: string): Promise<void> {
  await api.delete(`/teams/${teamId}/members/${membershipId}`);
}

// ── Activity ───────────────────────────────────────────────────────────────

/** Activity log entry. Mirrors backend `ActivityLogEntry`. */
export interface TeamActivity {
  id: string;
  /** Backend `action` (e.g. `team.invite.created`, `team.member.removed`). */
  type: string;
  /** Backend `actorId` — the user who performed the action. */
  actor?: string | null;
  /** Free-form payload from the backend. */
  payload?: Record<string, unknown>;
  createdAt: string;
  /** Optional pre-rendered message. Vault generates this client-side from {type,payload}. */
  message?: string;
}

interface RawActivityEntry {
  id: string;
  action: string;
  actorId: string;
  scope: string;
  scopeId: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Lists activity for a team. Backend route: `GET /teams/:teamId/activity`. */
export async function listTeamActivity(teamId: string): Promise<TeamActivity[]> {
  const { data } = await api.get<RawActivityEntry[]>(`/teams/${teamId}/activity`);
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.action,
    actor: row.actorId,
    payload: row.payload,
    createdAt: row.createdAt,
  }));
}

// ── Metrics ────────────────────────────────────────────────────────────────

/** Lightweight metrics summary surfaced in the mobile teams strip. */
export interface TeamMetrics {
  membersCount: number;
  activeMembersCount: number;
  pendingInvites: number;
  storageBytes?: number;
  /** Raw backend response — passed through for callers that want detail. */
  raw?: unknown;
}

interface RawTeamMetrics {
  summary?: {
    memberCount?: number;
    pendingInviteCount?: number;
    adminCount?: number;
  };
  kpis?: {
    activeMemberCount?: number;
  };
}

/** Fetches workspace metrics. Backend route: `GET /teams/:teamId/metrics`. */
export async function getTeamMetrics(teamId: string): Promise<TeamMetrics> {
  const { data } = await api.get<RawTeamMetrics>(`/teams/${teamId}/metrics`);
  return {
    membersCount: data?.summary?.memberCount ?? 0,
    activeMembersCount: data?.kpis?.activeMemberCount ?? 0,
    pendingInvites: data?.summary?.pendingInviteCount ?? 0,
    raw: data,
  };
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
