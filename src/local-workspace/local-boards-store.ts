import * as FileSystem from 'expo-file-system';

import type {
  ArchivedList,
  BoardCard,
  BoardDetail,
  BoardList,
  BoardSummary,
} from '../core/api/boards.client';

/**
 * Local on-device store for Kanban / Mesh boards. Mirrors the cloud API in
 * `src/core/api/boards.client.ts` 1:1 so the dual router in
 * `boards.dual.ts` can swap implementations transparently when
 * `useLocalWorkspace().mode === 'local'`.
 *
 * Persistence is a single JSON file per local workspace at
 *   <documentDirectory>/local-workspaces/<wsId>/.boards.json
 * That sits next to the .kd/.kb/etc files but is prefixed with a dot so the
 * regular file/folder listing helpers in LocalWorkspaceProvider skip it.
 * Writes are atomic: write a sibling .tmp first, then move into place — the
 * same pattern the doc store uses to survive an interrupted save.
 *
 * IDs use crypto.randomUUID() when available, falling back to a timestamp +
 * random suffix so the store works in older JS engines.
 */

const ROOT_DIR_NAME = 'local-workspaces';
const STORE_FILENAME = '.boards.json';

interface LocalAssignee {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

interface LocalCard {
  id: string;
  listId: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  priority?: string | null;
  urgency?: string | null;
  position: number;
  assignees: LocalAssignee[];
  tags: { id: string; name: string; color?: string; tagKind?: string }[];
  coverUrl?: string | null;
  parentCardId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LocalList {
  id: string;
  boardId: string;
  name: string;
  position: number;
  archivedAt?: string | null;
  /** Per-list tint colour (hex). Mirrors web `themeCustom.listColors[id]`. */
  color?: string | null;
  createdAt: string;
}

interface LocalBoard {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null;
  boardType: 'kanban' | 'mesh';
  createdAt: string;
}

interface BoardsFile {
  schemaVersion: '2026-v1';
  boards: LocalBoard[];
  lists: LocalList[];
  cards: LocalCard[];
}

const EMPTY_FILE: BoardsFile = {
  schemaVersion: '2026-v1',
  boards: [],
  lists: [],
  cards: [],
};

// ─── Helpers: storage path & atomic I/O ─────────────────────────────────────

function workspaceUri(workspaceId: string): string {
  return `${FileSystem.documentDirectory}${ROOT_DIR_NAME}/${workspaceId}/`;
}

function storePath(workspaceId: string): string {
  return `${workspaceUri(workspaceId)}${STORE_FILENAME}`;
}

async function readStore(workspaceId: string): Promise<BoardsFile> {
  const target = storePath(workspaceId);
  try {
    const raw = await FileSystem.readAsStringAsync(target, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.boards)) {
      return {
        schemaVersion: '2026-v1',
        boards: parsed.boards ?? [],
        lists: parsed.lists ?? [],
        cards: parsed.cards ?? [],
      };
    }
  } catch {
    /* missing or corrupt — fall back to empty */
  }
  return { ...EMPTY_FILE };
}

async function writeStore(workspaceId: string, file: BoardsFile): Promise<void> {
  // Ensure the workspace directory exists (might be a fresh workspace whose
  // doc store hasn't run yet).
  const dir = workspaceUri(workspaceId);
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    /* exists */
  }
  const target = storePath(workspaceId);
  const tmp = `${target}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(file), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  // FileSystem has no rename — delete-then-write keeps the .tmp around long
  // enough that a crash mid-flight still leaves a recoverable copy.
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
  } catch {
    /* ignore */
  }
  await FileSystem.moveAsync({ from: tmp, to: target });
}

/**
 * Most operations need to know which board / list / card lives in which
 * workspace. The store is one file per workspace, but call sites pass only
 * the boardId or cardId. We index by boardId → workspaceId by scanning every
 * workspace registered under the documentDirectory; results are cached for
 * the lifetime of the process. The number of local workspaces is small (a
 * handful at most) so the scan is cheap.
 */
const workspaceForBoard = new Map<string, string>();
const workspaceForList = new Map<string, string>();
const workspaceForCard = new Map<string, string>();

async function resolveWorkspaceForBoard(boardId: string): Promise<string | null> {
  if (workspaceForBoard.has(boardId)) return workspaceForBoard.get(boardId)!;
  await rebuildIndex();
  return workspaceForBoard.get(boardId) ?? null;
}

async function resolveWorkspaceForList(listId: string): Promise<string | null> {
  if (workspaceForList.has(listId)) return workspaceForList.get(listId)!;
  await rebuildIndex();
  return workspaceForList.get(listId) ?? null;
}

async function resolveWorkspaceForCard(cardId: string): Promise<string | null> {
  if (workspaceForCard.has(cardId)) return workspaceForCard.get(cardId)!;
  await rebuildIndex();
  return workspaceForCard.get(cardId) ?? null;
}

async function rebuildIndex(): Promise<void> {
  workspaceForBoard.clear();
  workspaceForList.clear();
  workspaceForCard.clear();
  const root = `${FileSystem.documentDirectory}${ROOT_DIR_NAME}`;
  let workspaceIds: string[] = [];
  try {
    workspaceIds = await FileSystem.readDirectoryAsync(root);
  } catch {
    return;
  }
  for (const wsId of workspaceIds) {
    let file: BoardsFile;
    try {
      file = await readStore(wsId);
    } catch {
      continue;
    }
    for (const b of file.boards) workspaceForBoard.set(b.id, wsId);
    for (const l of file.lists) workspaceForList.set(l.id, wsId);
    for (const c of file.cards) workspaceForCard.set(c.id, wsId);
  }
}

function newId(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `board-${Date.now()}`
  );
}

// ─── Shape converters: local rows → API DTOs ────────────────────────────────

function toBoardSummary(b: LocalBoard): BoardSummary {
  return {
    id: b.id,
    teamId: b.workspaceId, // local workspace id stands in for teamId
    name: b.name,
    slug: b.slug,
    description: b.description ?? null,
    boardType: b.boardType,
    // Cover/background/theme are not surfaced in local boards yet — fill with
    // neutral defaults so the shape matches the shared `@/types/contracts`
    // `BoardSummary`. Cloud boards override these from the backend.
    coverImageUrl: null,
    backgroundKind: 'none',
    backgroundValue: null,
    backgroundImageUrl: null,
    backgroundGradient: null,
    themeKind: 'preset',
    themePreset: null,
    themeCustom: {},
    updatedAt: b.createdAt,
  };
}

function toBoardCard(c: LocalCard): BoardCard {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary ?? null,
    status: c.status ?? null,
    startAt: c.startAt ?? null,
    dueAt: c.dueAt ?? null,
    completedAt: c.completedAt ?? null,
    archivedAt: c.archivedAt ?? null,
    priority: c.priority ?? null,
    urgency: c.urgency ?? null,
    position: c.position,
    assignees: c.assignees ?? [],
    tags: c.tags ?? [],
    coverUrl: c.coverUrl ?? null,
    parentCardId: c.parentCardId ?? null,
    listId: c.listId,
  };
}

function toBoardList(l: LocalList, cards: LocalCard[]): BoardList {
  return {
    id: l.id,
    name: l.name,
    position: l.position,
    archivedAt: l.archivedAt ?? null,
    color: l.color ?? null,
    cards: cards
      .filter((c) => c.listId === l.id)
      .sort((a, b) => a.position - b.position)
      .map(toBoardCard),
  };
}

function toBoardDetail(b: LocalBoard, lists: LocalList[], cards: LocalCard[]): BoardDetail {
  return {
    id: b.id,
    teamId: b.workspaceId,
    name: b.name,
    slug: b.slug,
    description: b.description ?? null,
    boardType: b.boardType,
    lists: lists
      .filter((l) => l.boardId === b.id && !l.archivedAt)
      .sort((a, b2) => a.position - b2.position)
      .map((l) => toBoardList(l, cards)),
  };
}

// ─── Public API (mirrors boards.client.ts) ──────────────────────────────────

export async function listLocalBoards(workspaceId: string): Promise<BoardSummary[]> {
  const file = await readStore(workspaceId);
  return file.boards.map(toBoardSummary);
}

export async function getLocalBoard(boardId: string): Promise<BoardDetail> {
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) throw new Error(`Local board not found: ${boardId}`);
  const file = await readStore(wsId);
  const board = file.boards.find((b) => b.id === boardId);
  if (!board) throw new Error(`Local board not found: ${boardId}`);
  return toBoardDetail(board, file.lists, file.cards);
}

export async function createLocalBoard(
  workspaceId: string,
  input: { name: string; boardType: 'kanban' | 'mesh'; description?: string },
): Promise<BoardSummary> {
  const file = await readStore(workspaceId);
  const id = newId();
  const board: LocalBoard = {
    id,
    workspaceId,
    name: input.name.trim() || 'Untitled board',
    slug: slugify(input.name),
    description: input.description ?? null,
    boardType: input.boardType,
    createdAt: new Date().toISOString(),
  };
  // Seed kanban boards with three default lists so the user has somewhere
  // to drop cards immediately — matches the cloud `createBoard` behavior.
  const seedLists: LocalList[] =
    input.boardType === 'kanban'
      ? ['To do', 'In progress', 'Done'].map((name, i) => ({
          id: newId(),
          boardId: id,
          name,
          position: i,
          archivedAt: null,
          createdAt: new Date().toISOString(),
        }))
      : [];
  const next: BoardsFile = {
    ...file,
    boards: [...file.boards, board],
    lists: [...file.lists, ...seedLists],
  };
  await writeStore(workspaceId, next);
  workspaceForBoard.set(id, workspaceId);
  for (const l of seedLists) workspaceForList.set(l.id, workspaceId);
  return toBoardSummary(board);
}

export async function listLocalArchivedLists(boardId: string): Promise<ArchivedList[]> {
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) return [];
  const file = await readStore(wsId);
  return file.lists
    .filter((l) => l.boardId === boardId && l.archivedAt)
    .map((l) => ({ id: l.id, name: l.name, archivedAt: l.archivedAt! }));
}

export async function archiveLocalList(
  boardId: string,
  listId: string,
  archived: boolean,
): Promise<void> {
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) throw new Error(`Local board not found: ${boardId}`);
  const file = await readStore(wsId);
  const next: BoardsFile = {
    ...file,
    lists: file.lists.map((l) =>
      l.id === listId
        ? { ...l, archivedAt: archived ? new Date().toISOString() : null }
        : l,
    ),
  };
  await writeStore(wsId, next);
}

export async function createLocalList(boardId: string, name: string): Promise<BoardList> {
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) throw new Error(`Local board not found: ${boardId}`);
  const file = await readStore(wsId);
  const siblings = file.lists.filter((l) => l.boardId === boardId);
  const position = siblings.reduce((m, l) => Math.max(m, l.position + 1), 0);
  const list: LocalList = {
    id: newId(),
    boardId,
    name: name.trim() || 'New list',
    position,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };
  await writeStore(wsId, { ...file, lists: [...file.lists, list] });
  workspaceForList.set(list.id, wsId);
  return toBoardList(list, []);
}

export async function createLocalCard(input: {
  listId: string;
  title: string;
  description?: string;
  dueAt?: string;
}): Promise<BoardCard> {
  const wsId = await resolveWorkspaceForList(input.listId);
  if (!wsId) throw new Error(`Local list not found: ${input.listId}`);
  const file = await readStore(wsId);
  const siblings = file.cards.filter((c) => c.listId === input.listId);
  const position = siblings.reduce((m, c) => Math.max(m, c.position + 1), 0);
  const card: LocalCard = {
    id: newId(),
    listId: input.listId,
    title: input.title.trim() || 'Untitled',
    summary: input.description ?? null,
    status: null,
    startAt: null,
    dueAt: input.dueAt ?? null,
    completedAt: null,
    archivedAt: null,
    priority: null,
    urgency: null,
    position,
    assignees: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeStore(wsId, { ...file, cards: [...file.cards, card] });
  workspaceForCard.set(card.id, wsId);
  return toBoardCard(card);
}

export async function updateLocalCard(
  cardId: string,
  patch: {
    title?: string;
    summary?: string;
    status?: string;
    startAt?: string | null;
    dueAt?: string | null;
    urgency?: string;
    priority?: string;
    list_id?: string;
    listId?: string;
    position?: number;
    coverUrl?: string | null;
    parentCardId?: string | null;
  },
): Promise<BoardCard> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  const idx = file.cards.findIndex((c) => c.id === cardId);
  if (idx < 0) throw new Error(`Local card not found: ${cardId}`);
  const targetListId = patch.listId ?? patch.list_id;
  const existing = file.cards[idx];
  const updated: LocalCard = {
    ...existing,
    title: patch.title ?? existing.title,
    summary: patch.summary !== undefined ? patch.summary : existing.summary,
    status: patch.status ?? existing.status,
    startAt: patch.startAt !== undefined ? patch.startAt : existing.startAt,
    dueAt: patch.dueAt !== undefined ? patch.dueAt : existing.dueAt,
    urgency: patch.urgency ?? existing.urgency,
    priority: patch.priority ?? existing.priority,
    listId: targetListId ?? existing.listId,
    position: patch.position ?? existing.position,
    coverUrl:
      patch.coverUrl !== undefined ? patch.coverUrl : existing.coverUrl,
    parentCardId:
      patch.parentCardId !== undefined
        ? patch.parentCardId
        : existing.parentCardId,
    updatedAt: new Date().toISOString(),
  };
  const cards = [...file.cards];
  cards[idx] = updated;
  await writeStore(wsId, { ...file, cards });
  return toBoardCard(updated);
}

export async function archiveLocalCard(cardId: string): Promise<void> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  const next: BoardsFile = {
    ...file,
    cards: file.cards.map((c) =>
      c.id === cardId ? { ...c, archivedAt: new Date().toISOString() } : c,
    ),
  };
  await writeStore(wsId, next);
}

export async function getLocalCard(cardId: string): Promise<BoardCard> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  const card = file.cards.find((c) => c.id === cardId);
  if (!card) throw new Error(`Local card not found: ${cardId}`);
  return toBoardCard(card);
}

export async function addLocalCardAssignee(cardId: string, userId: string): Promise<void> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  // Local mode has no team — assignees are just stubs (typically "me"). We
  // keep the shape so callers can render avatars without branching.
  const next: BoardsFile = {
    ...file,
    cards: file.cards.map((c) => {
      if (c.id !== cardId) return c;
      if (c.assignees.some((a) => a.id === userId)) return c;
      return {
        ...c,
        assignees: [...c.assignees, { id: userId, name: userId }],
        updatedAt: new Date().toISOString(),
      };
    }),
  };
  await writeStore(wsId, next);
}

export async function removeLocalCardAssignee(
  cardId: string,
  userId: string,
): Promise<void> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  const next: BoardsFile = {
    ...file,
    cards: file.cards.map((c) =>
      c.id === cardId
        ? {
            ...c,
            assignees: c.assignees.filter((a) => a.id !== userId),
            updatedAt: new Date().toISOString(),
          }
        : c,
    ),
  };
  await writeStore(wsId, next);
}

// ─── Tags (local-only) ─────────────────────────────────────────────────────
//
// Local mode has no separate tags table — tags live inline on the card. The
// API surface still mirrors the cloud one (`listLocalBoardTags`, `addLocalCardTag`,
// `removeLocalCardTag`) so the dual router can route uniformly. The tag id is
// the tag name (degraded local-string flavour described in the task plan).

export async function listLocalBoardTags(
  boardId: string,
): Promise<{ id: string; name: string; color?: string; tagKind?: string }[]> {
  // Aggregate every distinct tag seen on any card in lists belonging to the
  // board (cards know their list; lists know their board).
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) return [];
  const file = await readStore(wsId);
  const listIds = new Set(file.lists.filter((l) => l.boardId === boardId).map((l) => l.id));
  const seen = new Map<string, { id: string; name: string; color?: string; tagKind?: string }>();
  for (const card of file.cards) {
    if (!listIds.has(card.listId)) continue;
    for (const tag of card.tags ?? []) {
      if (!tag?.id) continue;
      if (!seen.has(tag.id)) seen.set(tag.id, { ...tag });
    }
  }
  return Array.from(seen.values());
}

export async function addLocalCardTag(cardId: string, tagId: string): Promise<void> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  const next: BoardsFile = {
    ...file,
    cards: file.cards.map((c) => {
      if (c.id !== cardId) return c;
      if ((c.tags ?? []).some((t) => t.id === tagId)) return c;
      return {
        ...c,
        tags: [...(c.tags ?? []), { id: tagId, name: tagId }],
        updatedAt: new Date().toISOString(),
      };
    }),
  };
  await writeStore(wsId, next);
}

export async function removeLocalCardTag(cardId: string, tagId: string): Promise<void> {
  const wsId = await resolveWorkspaceForCard(cardId);
  if (!wsId) throw new Error(`Local card not found: ${cardId}`);
  const file = await readStore(wsId);
  const next: BoardsFile = {
    ...file,
    cards: file.cards.map((c) =>
      c.id === cardId
        ? {
            ...c,
            tags: (c.tags ?? []).filter((t) => t.id !== tagId),
            updatedAt: new Date().toISOString(),
          }
        : c,
    ),
  };
  await writeStore(wsId, next);
}

// ─── List reorder + color (web parity) ──────────────────────────────────────

/**
 * Reorder lists within a single local board. Positions are reassigned to the
 * index in `orderedListIds`; any list belonging to the board but not present
 * in the array keeps its existing position bumped past the explicit ones.
 */
export async function reorderLocalLists(
  boardId: string,
  orderedListIds: string[],
): Promise<void> {
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) throw new Error(`Local board not found: ${boardId}`);
  const file = await readStore(wsId);
  const positionByList = new Map(orderedListIds.map((id, i) => [id, i] as const));
  const tail = orderedListIds.length;
  let nextTail = tail;
  const next: BoardsFile = {
    ...file,
    lists: file.lists.map((l) => {
      if (l.boardId !== boardId) return l;
      const pos = positionByList.get(l.id);
      if (pos !== undefined) return { ...l, position: pos };
      return { ...l, position: nextTail++ };
    }),
  };
  await writeStore(wsId, next);
}

/** Set a per-list tint color in the local store. Null clears it. */
export async function setLocalListColor(
  boardId: string,
  listId: string,
  color: string | null,
): Promise<void> {
  const wsId = await resolveWorkspaceForBoard(boardId);
  if (!wsId) throw new Error(`Local board not found: ${boardId}`);
  const file = await readStore(wsId);
  const next: BoardsFile = {
    ...file,
    lists: file.lists.map((l) =>
      l.id === listId && l.boardId === boardId ? { ...l, color } : l,
    ),
  };
  await writeStore(wsId, next);
}
