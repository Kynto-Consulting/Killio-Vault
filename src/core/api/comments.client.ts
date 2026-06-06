import { api } from './http';

/**
 * Mobile wrapper for the entity-comments REST endpoints. Mirrors the web's
 * `listDocumentComments` / `addDocumentComment` and the equivalent card
 * endpoints (`/cards/:id/comments`). Comments here are NOT rooms — they are
 * the per-entity inline comment thread that backs the Notion-style sidebar.
 *
 * Backend endpoints (confirmed in the controllers):
 *   GET  /documents/:id/comments
 *   POST /documents/:id/comments
 *   GET  /cards/:cardId/comments
 *   POST /cards/:cardId/comments
 *
 * The backend does NOT (yet) expose PUT/DELETE for individual comments;
 * `updateComment` and `deleteComment` are wired to be 1:1 with the web
 * frontend's contract so the UI builds cleanly, and they fall back to a
 * 405 from the server until those routes land. The UI hides edit/delete
 * buttons when the actor id doesn't match the current user (see CommentsPane).
 */
export type CommentEntityType = 'document' | 'card';

export interface EntityComment {
  id: string;
  // The web payload nests the body under `payload.text`; Vault flattens to
  // `text` so the panel doesn't need to grok the legacy shape.
  text: string;
  authorId: string;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  // Optional reactions block — backend currently omits this; left in the
  // type so the row component can render once it ships.
  reactions?: Array<{ emoji: string; userIds: string[] }>;
}

/** Normalises the assorted comment shapes the backend returns (some endpoints
 * nest the body under `payload.text`, others put it directly on `text`). */
function normaliseComment(raw: any): EntityComment {
  const payload = (raw?.payload && typeof raw.payload === 'object') ? raw.payload : {};
  return {
    id: String(raw?.id ?? ''),
    text: String(raw?.text ?? payload?.text ?? ''),
    authorId: String(raw?.authorId ?? raw?.userId ?? raw?.actorId ?? ''),
    authorName: raw?.authorName ?? raw?.userName ?? raw?.author?.name ?? null,
    authorAvatarUrl: raw?.authorAvatarUrl ?? raw?.author?.avatarUrl ?? null,
    createdAt: String(raw?.createdAt ?? raw?.created_at ?? new Date().toISOString()),
    updatedAt: raw?.updatedAt ?? raw?.updated_at ?? null,
    reactions: Array.isArray(raw?.reactions) ? raw.reactions : undefined,
  };
}

export async function listComments(
  entityType: CommentEntityType,
  entityId: string,
): Promise<EntityComment[]> {
  const path = entityType === 'card'
    ? `/cards/${entityId}/comments`
    : `/documents/${entityId}/comments`;
  const { data } = await api.get<any[]>(path);
  return (Array.isArray(data) ? data : []).map(normaliseComment);
}

export async function createComment(input: {
  entityType: CommentEntityType;
  entityId: string;
  text: string;
}): Promise<EntityComment> {
  const path = input.entityType === 'card'
    ? `/cards/${input.entityId}/comments`
    : `/documents/${input.entityId}/comments`;
  const { data } = await api.post<any>(path, { text: input.text });
  return normaliseComment(data);
}

/**
 * Updates a comment body. The backend does not yet expose this endpoint —
 * shaped to the same path the web frontend would call (PUT) so that when
 * the route lands the client is a no-op change. Until then the UI hides
 * the edit affordance behind the same actor-id check.
 */
export async function updateComment(
  entityType: CommentEntityType,
  entityId: string,
  commentId: string,
  patch: { text: string },
): Promise<EntityComment> {
  const base = entityType === 'card'
    ? `/cards/${entityId}/comments`
    : `/documents/${entityId}/comments`;
  const { data } = await api.put<any>(`${base}/${commentId}`, { text: patch.text });
  return normaliseComment(data);
}

/** Deletes a comment. Same caveat as updateComment — backend route pending. */
export async function deleteComment(
  entityType: CommentEntityType,
  entityId: string,
  commentId: string,
): Promise<void> {
  const base = entityType === 'card'
    ? `/cards/${entityId}/comments`
    : `/documents/${entityId}/comments`;
  await api.delete(`${base}/${commentId}`);
}
