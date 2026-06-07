import { api } from './http';

/**
 * Re-export shared contracts so consumers that did
 * `import { BoardSummary } from '@/core/api/boards.client'`
 * keep compiling. The canonical shape lives in `@/types/contracts`.
 */
export type { BoardSummary } from '@/types';
import type { BoardSummary } from '@/types';

export interface BoardCard {
  id: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  position?: number;
  assignees?: { id: string; name?: string; email?: string; avatarUrl?: string }[];
  tags?: { id: string; name: string; color?: string; tagKind?: string }[];
  /** Cover image URL for the card row thumbnail. Web stores this on the card row. */
  coverUrl?: string | null;
  /** Parent card id (for relations / sub-cards). Cloud may return null. */
  parentCardId?: string | null;
  /** Bricks attached to the card. Optional — the kanban list endpoint usually omits these. */
  blocks?: any[];
  listId?: string;
}

export interface BoardList {
  id: string;
  name: string;
  position?: number;
  cards: BoardCard[];
  archivedAt?: string | null;
  /**
   * Per-list tint color (hex). Web stores tint in `boardAppearance.themeCustom.listColors[id]`,
   * we mirror it onto the list itself for ergonomic access in Vault. The dual
   * router only needs to write/read this field; cloud cycles will reflect it
   * via the board appearance payload (see `updateBoardListColor`).
   */
  color?: string | null;
}

export interface BoardDetail {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string | null;
  boardType?: 'kanban' | 'mesh';
  lists: BoardList[];
}

export async function listTeamBoards(teamId: string): Promise<BoardSummary[]> {
  const { data } = await api.get<BoardSummary[]>(`/teams/${teamId}/boards`);
  return data ?? [];
}

export async function createCloudBoard(
  teamId: string,
  input: { name: string; boardType: 'kanban' | 'mesh'; description?: string },
): Promise<BoardSummary> {
  // Backend endpoint: POST /teams/:teamId/boards
  // (Killio-Backend/src/modules/teams/teams.controller.ts:96 — already wired
  // to teamsService.createBoard.)
  const { data } = await api.post<BoardSummary>(`/teams/${teamId}/boards`, {
    name: input.name,
    boardType: input.boardType,
    description: input.description ?? null,
  });
  return data;
}

export async function getBoard(boardId: string): Promise<BoardDetail> {
  const { data } = await api.get<BoardDetail>(`/boards/${boardId}`);
  return data;
}

export interface ArchivedList {
  id: string;
  name: string;
  archivedAt: string;
}

export async function listArchivedLists(boardId: string): Promise<ArchivedList[]> {
  const { data } = await api.get<ArchivedList[]>(`/boards/${boardId}/archived-lists`);
  return data ?? [];
}

export async function archiveList(
  boardId: string,
  listId: string,
  archived: boolean,
): Promise<void> {
  await api.patch(`/boards/${boardId}/lists/${listId}`, { isArchived: archived });
}

export async function createList(
  boardId: string,
  name: string,
  color?: string,
): Promise<BoardList> {
  const { data } = await api.post<BoardList>(`/boards/${boardId}/lists`, { name, color });
  return data;
}

// ─── Cards ──────────────────────────────────────────────────────────────────

export async function createCard(input: {
  listId: string;
  title: string;
  description?: string;
  dueAt?: string;
}): Promise<BoardCard> {
  const { data } = await api.post<BoardCard>(`/cards`, input);
  return data;
}

export async function updateCard(
  cardId: string,
  patch: {
    title?: string;
    summary?: string;
    status?: string;
    startAt?: string | null;
    dueAt?: string | null;
    list_id?: string;
    listId?: string;
    position?: number;
    coverUrl?: string | null;
    parentCardId?: string | null;
  },
): Promise<BoardCard> {
  const { data } = await api.patch<BoardCard>(`/cards/${cardId}`, patch);
  return data;
}

// ─── List reorder + color (web parity) ──────────────────────────────────────
//
// Backend gap (2026-06): /boards/:id/lists/reorder is NOT exposed on the
// boards controller (only updateList for name + archive). We POST to a best-
// effort endpoint and fall back to per-list position patches. If you add the
// route later, this helper switches over without UI changes.

export async function reorderLists(
  boardId: string,
  orderedListIds: string[],
): Promise<void> {
  // Try the batch endpoint first.
  try {
    await api.patch(`/boards/${boardId}/lists/reorder`, { listIds: orderedListIds });
    return;
  } catch {
    // Fallback: PATCH each list with its new position. Cloud `updateList`
    // currently only accepts {name}, so positions are lost on cloud until the
    // backend route lands. Local mode handles this directly in the dual router.
    await Promise.all(
      orderedListIds.map((id, position) =>
        api
          .patch(`/boards/${boardId}/lists/${id}`, { position })
          .catch(() => undefined),
      ),
    );
  }
}

/**
 * Persist a per-list tint color. Web stores this on the board appearance
 * (`themeCustom.listColors[listId]`), we mirror that 1:1 so the same payload
 * shape works across both clients.
 *
 * Mobile: callers should also patch the local board state to avoid a flash
 * waiting for the GET round-trip.
 */
export async function updateBoardListColor(
  boardId: string,
  listId: string,
  color: string | null,
): Promise<void> {
  // Read-modify-write the appearance.themeCustom.listColors map. We re-fetch
  // because the board detail endpoint returns appearance fields, but we don't
  // want to overwrite other listColors set in parallel.
  const { data: board } = await api.get<{ themeCustom?: Record<string, unknown> }>(
    `/boards/${boardId}`,
  );
  const themeCustom = (board.themeCustom ?? {}) as Record<string, unknown>;
  const listColors = ((themeCustom.listColors as Record<string, string> | undefined) ??
    {}) as Record<string, string | null>;
  if (color === null) {
    delete listColors[listId];
  } else {
    listColors[listId] = color;
  }
  await api.patch(`/boards/${boardId}/appearance`, {
    themeCustom: { ...themeCustom, listColors },
  });
}

// ─── Card timer (web ActiveCardTimer parity) ────────────────────────────────
//
// The "timer" model = a card with start_at + due_at set and completed_at null
// (CardsRepository.getActiveTimerForUser). There is NO separate timer table /
// route — start/stop are just targeted PATCH /cards/:id field writes:
//   start → start_at=now (+ due_at=now+1h if missing), completed_at=null
//   stop  → completed_at=now
// This matches the backend agent tools card_timer_start / card_timer_stop.

export async function startCardTimer(cardId: string, dueAt?: string): Promise<void> {
  const due = dueAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await api.patch(`/cards/${cardId}`, {
    start_at: new Date().toISOString(),
    due_at: due,
    completed_at: null,
  });
}

export async function stopCardTimer(cardId: string): Promise<void> {
  await api.patch(`/cards/${cardId}`, { completed_at: new Date().toISOString() });
}

export interface ActiveTimer {
  cardId: string;
  startedAt: string;
}

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  try {
    const { data } = await api.get<ActiveTimer | null>(`/cards/active-timer/current`);
    return data ?? null;
  } catch {
    return null;
  }
}

export async function archiveCard(cardId: string): Promise<void> {
  await api.delete(`/cards/${cardId}`);
}

export async function getCard(cardId: string): Promise<BoardCard> {
  const { data } = await api.get<BoardCard>(`/cards/${cardId}`);
  return data;
}

export async function addCardAssignee(cardId: string, userId: string): Promise<void> {
  // Backend route: POST /cards/:cardId/assignees/:assigneeId
  await api.post(`/cards/${cardId}/assignees/${userId}`);
}

export async function removeCardAssignee(cardId: string, userId: string): Promise<void> {
  await api.delete(`/cards/${cardId}/assignees/${userId}`);
}

// ─── Tags ───────────────────────────────────────────────────────────────────

export interface BoardTag {
  id: string;
  name: string;
  slug?: string;
  color?: string;
  tagKind?: string;
}

/** Lists tags scoped to a board. Backend route: `GET /tags/scope/board/:boardId`. */
export async function listBoardTags(boardId: string): Promise<BoardTag[]> {
  const { data } = await api.get<BoardTag[]>(`/tags/scope/board/${boardId}`);
  return data ?? [];
}

export async function addCardTag(cardId: string, tagId: string): Promise<void> {
  await api.post(`/cards/${cardId}/tags/${tagId}`);
}

/**
 * Create a new tag scoped to a board, then return it for immediate assignment.
 * Backend route: `POST /tags` (mirrors Killio-Frontend `createTag`). The
 * backend returns `tag_kind` (snake_case); we normalise to `tagKind` so the
 * result matches `BoardTag`.
 */
export async function createBoardTag(input: {
  boardId: string;
  name: string;
  color?: string;
  tagKind?: 'priority' | 'ux' | 'bug' | 'feature' | 'custom';
}): Promise<BoardTag> {
  const { data } = await api.post<any>(`/tags`, {
    scopeType: 'board',
    scopeId: input.boardId,
    name: input.name,
    color: input.color,
    tagKind: input.tagKind ?? 'custom',
  });
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    color: data.color ?? input.color,
    tagKind: data.tagKind ?? data.tag_kind,
  };
}

export async function removeCardTag(cardId: string, tagId: string): Promise<void> {
  await api.delete(`/cards/${cardId}/tags/${tagId}`);
}
