import { api } from './http';

export interface ActivityLogEntry {
  id: string;
  scope: string;
  scopeId: string;
  actorId: string | null;
  actorName?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

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
