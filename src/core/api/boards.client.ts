import { api } from './http';

export interface BoardSummary {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string | null;
  boardType?: 'kanban' | 'mesh';
}

export interface BoardCard {
  id: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  priority?: string | null;
  urgency?: string | null;
  position?: number;
  assignees?: { id: string; name?: string; email?: string; avatarUrl?: string }[];
  tags?: { id: string; name: string; color?: string; tagKind?: string }[];
  listId?: string;
}

export interface BoardList {
  id: string;
  name: string;
  position?: number;
  cards: BoardCard[];
  archivedAt?: string | null;
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
    urgency?: string;
    priority?: string;
    list_id?: string;
    listId?: string;
    position?: number;
  },
): Promise<BoardCard> {
  const { data } = await api.patch<BoardCard>(`/cards/${cardId}`, patch);
  return data;
}

export async function archiveCard(cardId: string): Promise<void> {
  await api.delete(`/cards/${cardId}`);
}

export async function getCard(cardId: string): Promise<BoardCard> {
  const { data } = await api.get<BoardCard>(`/cards/${cardId}`);
  return data;
}

export async function addCardAssignee(cardId: string, userId: string): Promise<void> {
  await api.post(`/cards/${cardId}/assignees`, { userId });
}

export async function removeCardAssignee(cardId: string, userId: string): Promise<void> {
  await api.delete(`/cards/${cardId}/assignees/${userId}`);
}
