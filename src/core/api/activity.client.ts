import { api } from './http';
import type { ActivityLogEntry as SharedActivityLogEntry } from '@/types';

/**
 * ActivityLogEntry — shared base shape from `@/types/contracts` plus Vault-extras
 * the mobile sidebar relies on. We loosen `actorId` to `string | null` because
 * the backend can omit it for system-triggered activity, and we loosen `scope`
 * to `string` because Vault consumes activity from endpoints the web file does
 * not type (e.g. `/activity/team/:id`). When those diverge, prefer the wider
 * Vault shape locally so the picker doesn't reject backend responses.
 */
export type ActivityLogEntry = Omit<SharedActivityLogEntry, 'actorId' | 'scope' | 'payload'> & {
  // Vault-extra: backend can null-out the actor for system entries.
  actorId: string | null;
  // Vault-extra: `/activity/team/:id` returns activity across mixed scopes,
  // so we keep the wider `string` here instead of the narrow literal union.
  scope: string;
  // Vault-extra: pre-rendered actor display name (web resolves this separately).
  actorName?: string | null;
  // Vault-extra: payload is optional on Vault's looser response shape.
  payload?: Record<string, unknown>;
};

/** Activity feed scoped to a document — mirrors the web getDocumentActivity. */
export async function listDocumentActivity(documentId: string): Promise<ActivityLogEntry[]> {
  const { data } = await api.get<ActivityLogEntry[]>(`/activity/document/${documentId}`);
  return data ?? [];
}

/** Team-wide activity feed; used by the doc sidebar when the document has no
 *  own room yet (so the feed shows the user's recent context anyway). */
export async function listTeamActivity(teamId: string): Promise<ActivityLogEntry[]> {
  const { data } = await api.get<ActivityLogEntry[]>(`/activity/team/${teamId}`);
  return data ?? [];
}

/** Activity feed scoped to a single card — mirrors the web's getCardActivity.
 *  Used by the CardSidebar activity tab so users see exactly what changed
 *  on the card (status moves, assignee + tag adds, comments, etc.). */
export async function listCardActivity(cardId: string): Promise<ActivityLogEntry[]> {
  const { data } = await api.get<ActivityLogEntry[]>(`/activity/card/${cardId}`);
  return data ?? [];
}

/** Activity feed scoped to a board — handy when the card-level feed is empty
 *  but the user wants context from the surrounding board. */
export async function listBoardActivity(boardId: string): Promise<ActivityLogEntry[]> {
  const { data } = await api.get<ActivityLogEntry[]>(`/activity/board/${boardId}`);
  return data ?? [];
}
