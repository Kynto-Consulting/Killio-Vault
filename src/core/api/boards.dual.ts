import { useMemo } from 'react';

import { useLocalWorkspace } from '../../local-workspace/LocalWorkspaceProvider';
import * as cloud from './boards.client';
import * as local from '../../local-workspace/local-boards-store';
import type {
  ArchivedList,
  BoardCard,
  BoardDetail,
  BoardList,
  BoardSummary,
  BoardTag,
} from './boards.client';

/**
 * Dual router for the board API. The boards screens read
 * `useLocalWorkspace().mode` and call `useBoardsApi()` — the hook returns the
 * matching set of functions so the screen code itself stays mode-agnostic.
 *
 * The shape mirrors `boards.client.ts` 1:1. Cloud functions take the cloud
 * arguments verbatim (e.g. `listTeamBoards(teamId)`); the local variants
 * route through the local store, which is scoped to the active local
 * workspace.
 *
 * `createBoard` is the one helper that hides the cloud/local fork — in cloud
 * mode it calls `createCloudBoard(activeTeamId, …)`, in local mode it calls
 * `createLocalBoard(activeWorkspaceId, …)`. Callers pass only the board
 * payload; the workspace id is captured at hook call time.
 */
export interface BoardsApi {
  mode: 'cloud' | 'local';
  /** Workspace identifier — cloud teamId or local workspace id. */
  workspaceId: string | null;
  listBoards(workspaceId: string): Promise<BoardSummary[]>;
  getBoard(boardId: string): Promise<BoardDetail>;
  createBoard(input: {
    name: string;
    boardType: 'kanban' | 'mesh';
    description?: string;
  }): Promise<BoardSummary>;
  listArchivedLists(boardId: string): Promise<ArchivedList[]>;
  archiveList(boardId: string, listId: string, archived: boolean): Promise<void>;
  createList(boardId: string, name: string): Promise<BoardList>;
  createCard(input: {
    listId: string;
    title: string;
    description?: string;
    dueAt?: string;
  }): Promise<BoardCard>;
  updateCard(
    cardId: string,
    patch: Parameters<typeof cloud.updateCard>[1],
  ): Promise<BoardCard>;
  archiveCard(cardId: string): Promise<void>;
  getCard(cardId: string): Promise<BoardCard>;
  addCardAssignee(cardId: string, userId: string): Promise<void>;
  removeCardAssignee(cardId: string, userId: string): Promise<void>;
  listBoardTags(boardId: string): Promise<BoardTag[]>;
  addCardTag(cardId: string, tagId: string): Promise<void>;
  removeCardTag(cardId: string, tagId: string): Promise<void>;
  /** Reorder lists within a board (web parity). Local: persists positions; cloud: best-effort. */
  reorderLists(boardId: string, orderedListIds: string[]): Promise<void>;
  /** Set per-list tint color. */
  setListColor(boardId: string, listId: string, color: string | null): Promise<void>;
  /** Start tracking time on a card (backend may not be wired yet — see boards.client). */
  startCardTimer(cardId: string): Promise<void>;
  /** Stop tracking time. */
  stopCardTimer(cardId: string): Promise<void>;
}

export function useBoardsApi(cloudTeamId?: string | null): BoardsApi {
  const localWs = useLocalWorkspace();
  return useMemo<BoardsApi>(() => {
    if (localWs.mode === 'local' && localWs.active) {
      const workspaceId = localWs.active.id;
      return {
        mode: 'local',
        workspaceId,
        listBoards: (wsId) => local.listLocalBoards(wsId),
        getBoard: (boardId) => local.getLocalBoard(boardId),
        createBoard: (input) => local.createLocalBoard(workspaceId, input),
        listArchivedLists: (boardId) => local.listLocalArchivedLists(boardId),
        archiveList: (boardId, listId, archived) =>
          local.archiveLocalList(boardId, listId, archived),
        createList: (boardId, name) => local.createLocalList(boardId, name),
        createCard: (input) => local.createLocalCard(input),
        updateCard: (cardId, patch) => local.updateLocalCard(cardId, patch),
        archiveCard: (cardId) => local.archiveLocalCard(cardId),
        getCard: (cardId) => local.getLocalCard(cardId),
        addCardAssignee: (cardId, userId) =>
          local.addLocalCardAssignee(cardId, userId),
        removeCardAssignee: (cardId, userId) =>
          local.removeLocalCardAssignee(cardId, userId),
        listBoardTags: (boardId) => local.listLocalBoardTags(boardId),
        addCardTag: (cardId, tagId) => local.addLocalCardTag(cardId, tagId),
        removeCardTag: (cardId, tagId) => local.removeLocalCardTag(cardId, tagId),
        reorderLists: (boardId, ids) => local.reorderLocalLists(boardId, ids),
        setListColor: (boardId, listId, color) =>
          local.setLocalListColor(boardId, listId, color),
        // Mobile: local mode has no real timer backend — these are no-ops so
        // the UI doesn't have to branch. The buttons still render.
        startCardTimer: async () => {
          /* local: no timer persistence yet */
        },
        stopCardTimer: async () => {
          /* local: no timer persistence yet */
        },
      };
    }
    const workspaceId = cloudTeamId ?? null;
    return {
      mode: 'cloud',
      workspaceId,
      listBoards: (wsId) => cloud.listTeamBoards(wsId),
      getBoard: (boardId) => cloud.getBoard(boardId),
      createBoard: (input) => {
        if (!workspaceId) {
          throw new Error('No active team — cannot create cloud board.');
        }
        return cloud.createCloudBoard(workspaceId, input);
      },
      listArchivedLists: (boardId) => cloud.listArchivedLists(boardId),
      archiveList: (boardId, listId, archived) =>
        cloud.archiveList(boardId, listId, archived),
      createList: (boardId, name) => cloud.createList(boardId, name),
      createCard: (input) => cloud.createCard(input),
      updateCard: (cardId, patch) => cloud.updateCard(cardId, patch),
      archiveCard: (cardId) => cloud.archiveCard(cardId),
      getCard: (cardId) => cloud.getCard(cardId),
      addCardAssignee: (cardId, userId) => cloud.addCardAssignee(cardId, userId),
      removeCardAssignee: (cardId, userId) =>
        cloud.removeCardAssignee(cardId, userId),
      listBoardTags: (boardId) => cloud.listBoardTags(boardId),
      addCardTag: (cardId, tagId) => cloud.addCardTag(cardId, tagId),
      removeCardTag: (cardId, tagId) => cloud.removeCardTag(cardId, tagId),
      reorderLists: (boardId, ids) => cloud.reorderLists(boardId, ids),
      setListColor: (boardId, listId, color) =>
        cloud.updateBoardListColor(boardId, listId, color),
      startCardTimer: (cardId) => cloud.startCardTimer(cardId),
      stopCardTimer: (cardId) => cloud.stopCardTimer(cardId),
    };
  }, [localWs.mode, localWs.active?.id, cloudTeamId]);
}
