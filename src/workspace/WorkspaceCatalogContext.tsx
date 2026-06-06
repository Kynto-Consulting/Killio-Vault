import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '../core/auth/AuthContext';
import { useLocalWorkspace } from '../local-workspace/LocalWorkspaceProvider';
import {
  getTeamCatalog,
  listTeamMembers,
  type BoardCatalogEntry,
  type TeamCatalog,
  type TeamMember,
} from '../core/api/teams.client';
import {
  listDocuments,
  listFolders,
  type DocSummary,
  type FolderSummary,
} from '../core/api/documents.client';
import type {
  PickerBoard,
  PickerCard,
  PickerDocument,
  PickerFolder,
  PickerUser,
} from '../types/picker';

/**
 * Workspace-wide catalogue (docs / boards / cards / folders / users) shared by
 * every consumer that needs `@`-mention autocomplete, ref pills, or jump-to
 * affordances. ONE fetch per active team. Stale state is fine; consumers can
 * force a `refresh()` after a mutation.
 *
 * Replaces the per-screen prefetch effects that used to live in
 * `app/document/[id].tsx`.
 *
 * Local-mode workspaces resolve to empty arrays — there is no team catalogue
 * to fetch. The picker still works for any category data passed inline (e.g.
 * a doc's own brick list).
 */

export interface WorkspaceCatalog {
  documents: PickerDocument[];
  boards: PickerBoard[];
  cards: PickerCard[];
  folders: PickerFolder[];
  users: PickerUser[];
  rawMembers: TeamMember[];
  rawFolders: FolderSummary[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Force a re-fetch — call after creating/deleting docs/folders/boards. */
  refresh(): Promise<void>;
  /** Optimistically add a doc to the in-memory list (e.g. just-created). */
  addDocument(doc: PickerDocument): void;
  /** Optimistically add a folder to the in-memory list. */
  addFolder(folder: PickerFolder): void;
}

const EMPTY: WorkspaceCatalog = {
  documents: [],
  boards: [],
  cards: [],
  folders: [],
  users: [],
  rawMembers: [],
  rawFolders: [],
  status: 'idle',
  refresh: async () => {},
  addDocument: () => {},
  addFolder: () => {},
};

const Ctx = createContext<WorkspaceCatalog>(EMPTY);

function mapBoards(boards: BoardCatalogEntry[]): PickerBoard[] {
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    boardType: b.boardType,
  }));
}

function mapCards(cards: TeamCatalog['cards']): PickerCard[] {
  return cards.map((c) => ({
    id: c.id,
    title: c.title,
    boardName: c.boardName,
  }));
}

function mapDocs(docs: DocSummary[], fallback: TeamCatalog['documents']): PickerDocument[] {
  if (docs.length > 0) {
    return docs.map((d) => ({ id: d.id, title: d.title }));
  }
  return (fallback ?? []).map((d) => ({ id: d.id, title: d.title }));
}

function mapFolders(folders: FolderSummary[]): PickerFolder[] {
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    icon: f.icon ?? undefined,
  }));
}

function mapUsers(members: TeamMember[]): PickerUser[] {
  return members.map((m) => ({
    id: m.id,
    name: m.displayName || m.name || m.email,
    alias: m.alias ?? undefined,
    email: m.email || m.primaryEmail,
    avatarUrl: m.avatarUrl ?? undefined,
  }));
}

export function WorkspaceCatalogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { activeTeam } = useAuth();
  const local = useLocalWorkspace();
  const isLocal = local.mode === 'local';
  const teamId = !isLocal && activeTeam?.id ? activeTeam.id : null;

  const [status, setStatus] = useState<WorkspaceCatalog['status']>('idle');
  const [documents, setDocuments] = useState<PickerDocument[]>([]);
  const [boards, setBoards] = useState<PickerBoard[]>([]);
  const [cards, setCards] = useState<PickerCard[]>([]);
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [rawMembers, setRawMembers] = useState<TeamMember[]>([]);
  const [rawFolders, setRawFolders] = useState<FolderSummary[]>([]);

  const refresh = useCallback(async () => {
    if (!teamId) {
      setDocuments([]);
      setBoards([]);
      setCards([]);
      setFolders([]);
      setUsers([]);
      setRawMembers([]);
      setRawFolders([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const [catalog, members, docs, fs] = await Promise.all([
        getTeamCatalog(teamId).catch(() => null),
        listTeamMembers(teamId).catch(() => [] as TeamMember[]),
        listDocuments(teamId).catch(() => [] as DocSummary[]),
        listFolders(teamId).catch(() => [] as FolderSummary[]),
      ]);
      setDocuments(mapDocs(docs, catalog?.documents ?? []));
      setBoards(mapBoards(catalog?.boards ?? []));
      setCards(mapCards(catalog?.cards ?? []));
      setFolders(mapFolders(fs));
      setUsers(mapUsers(members));
      setRawMembers(members);
      setRawFolders(fs);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [teamId]);

  // Auto-fetch on team change.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<WorkspaceCatalog>(
    () => ({
      documents,
      boards,
      cards,
      folders,
      users,
      rawMembers,
      rawFolders,
      status,
      refresh,
      addDocument: (doc) =>
        setDocuments((prev) =>
          prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev],
        ),
      addFolder: (folder) =>
        setFolders((prev) =>
          prev.some((f) => f.id === folder.id) ? prev : [folder, ...prev],
        ),
    }),
    [documents, boards, cards, folders, users, rawMembers, rawFolders, status, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read the workspace catalogue. Safe in any tree — defaults to empty when
 *  the provider isn't mounted (e.g. unauthenticated or unit tests). */
export function useWorkspaceCatalog(): WorkspaceCatalog {
  return useContext(Ctx);
}
