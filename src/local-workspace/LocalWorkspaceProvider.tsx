import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { decodeKillioFile, encodeKillioFile, type KillioFile } from './killio-file';

/**
 * Mobile-native answer to the web LocalWorkspaceProvider. The web version
 * leans on the File System Access API; we use expo-file-system to keep each
 * local workspace under `<documentDirectory>/local-workspaces/<id>/`. Files
 * use the same .kd / .kb / .km / .ks / .kf KAML format so a workspace can
 * round-trip between Vault and the Killio web app via Share / Import.
 *
 * Limits mirror the web "local mode": as much storage as the device grants,
 * no per-team plan gating, no cloud APIs.
 */
const REGISTRY_KEY = 'killio.localWorkspaces';
const ACTIVE_KEY = 'killio.activeLocalWorkspace';
const ROOT_DIR_NAME = 'local-workspaces';

export interface LocalWorkspaceMeta {
  id: string;
  name: string;
  createdAt: string;
  /** Absolute on-device URI for this workspace's root folder. */
  uri: string;
}

export interface LocalFileEntry {
  /** Path relative to the workspace root (e.g. "notes/today.kd"). */
  path: string;
  /** Bare filename without folders. */
  name: string;
  /** Containing folder path (empty string for root). */
  folder: string;
  kind: 'kd' | 'kb' | 'km' | 'ks' | 'kf' | 'other';
  lastModified: number;
  size: number;
}

export interface LocalFolderEntry {
  path: string;
  name: string;
  parent: string;
  icon?: string | null;
  color?: string | null;
}

interface LocalWorkspaceApi {
  /** True when the platform exposes a writable document directory. */
  supported: boolean;
  workspaces: LocalWorkspaceMeta[];
  activeId: string | null;
  active: LocalWorkspaceMeta | null;
  files: LocalFileEntry[];
  folders: LocalFolderEntry[];
  busy: boolean;

  createWorkspace(name: string): Promise<LocalWorkspaceMeta>;
  selectWorkspace(id: string): Promise<void>;
  removeWorkspace(id: string): Promise<void>;
  exit(): void;

  refresh(): Promise<void>;
  writeFile(relPath: string, contents: string): Promise<void>;
  readFile(relPath: string): Promise<string>;
  removeFile(relPath: string): Promise<void>;

  createFolder(parentPath: string, meta: { name: string; icon?: string; color?: string }): Promise<LocalFolderEntry>;
  removeFolder(folderPath: string): Promise<void>;
  updateFolder(folderPath: string, meta: { name?: string; icon?: string; color?: string }): Promise<void>;

  /** Helpers for the .kd-aware document UI. */
  readKillioFile(relPath: string): Promise<KillioFile>;
  writeKillioFile(relPath: string, file: KillioFile): Promise<void>;
}

const Ctx = createContext<LocalWorkspaceApi | null>(null);

const FALLBACK_API: LocalWorkspaceApi = {
  supported: false,
  workspaces: [],
  activeId: null,
  active: null,
  files: [],
  folders: [],
  busy: false,
  createWorkspace: async () => {
    throw new Error('Local workspaces not supported on this device.');
  },
  selectWorkspace: async () => {},
  removeWorkspace: async () => {},
  exit: () => {},
  refresh: async () => {},
  writeFile: async () => {
    throw new Error('No active local workspace');
  },
  readFile: async () => {
    throw new Error('No active local workspace');
  },
  removeFile: async () => {
    throw new Error('No active local workspace');
  },
  createFolder: async () => {
    throw new Error('No active local workspace');
  },
  removeFolder: async () => {},
  updateFolder: async () => {},
  readKillioFile: async () => ({ kind: 'kd', schemaVersion: '2026-v1', payload: {} }),
  writeKillioFile: async () => {},
};

export function LocalWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const supported = !!FileSystem.documentDirectory;
  const [workspaces, setWorkspaces] = useState<LocalWorkspaceMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalFileEntry[]>([]);
  const [folders, setFolders] = useState<LocalFolderEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  );

  // Hydrate registry on mount.
  useEffect(() => {
    (async () => {
      const raw = await SecureStore.getItemAsync(REGISTRY_KEY).catch(() => null);
      const list = raw ? safeParseList(raw) : [];
      setWorkspaces(list);
      const last = await SecureStore.getItemAsync(ACTIVE_KEY).catch(() => null);
      if (last && list.some((w) => w.id === last)) {
        setActiveId(last);
      }
    })();
  }, []);

  // Re-list files whenever the active workspace changes.
  useEffect(() => {
    if (!active) {
      setFiles([]);
      setFolders([]);
      return;
    }
    void refreshFiles(active);
  }, [active?.id]);

  const persistRegistry = useCallback(async (list: LocalWorkspaceMeta[]) => {
    await SecureStore.setItemAsync(REGISTRY_KEY, JSON.stringify(list));
  }, []);

  const refreshFiles = useCallback(async (ws: LocalWorkspaceMeta) => {
    try {
      const [fs, folderEntries] = await Promise.all([
        listAllFiles(ws.uri, ''),
        listAllFolders(ws.uri, ''),
      ]);
      setFiles(fs);
      setFolders(folderEntries);
    } catch {
      setFiles([]);
      setFolders([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (active) await refreshFiles(active);
  }, [active, refreshFiles]);

  const createWorkspace = useCallback(
    async (name: string): Promise<LocalWorkspaceMeta> => {
      if (!supported) throw new Error('FileSystem not available');
      setBusy(true);
      try {
        const id = `lw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const root = `${FileSystem.documentDirectory}${ROOT_DIR_NAME}/${id}/`;
        await FileSystem.makeDirectoryAsync(root, { intermediates: true });
        const meta: LocalWorkspaceMeta = {
          id,
          name: name.trim() || 'Local workspace',
          createdAt: new Date().toISOString(),
          uri: root,
        };
        const list = [...workspaces, meta];
        setWorkspaces(list);
        await persistRegistry(list);
        await SecureStore.setItemAsync(ACTIVE_KEY, meta.id);
        setActiveId(meta.id);
        return meta;
      } finally {
        setBusy(false);
      }
    },
    [supported, workspaces, persistRegistry],
  );

  const selectWorkspace = useCallback(
    async (id: string): Promise<void> => {
      if (!workspaces.some((w) => w.id === id)) return;
      await SecureStore.setItemAsync(ACTIVE_KEY, id);
      setActiveId(id);
    },
    [workspaces],
  );

  const removeWorkspace = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true);
      try {
        const ws = workspaces.find((w) => w.id === id);
        if (ws) {
          await FileSystem.deleteAsync(ws.uri, { idempotent: true });
        }
        const list = workspaces.filter((w) => w.id !== id);
        setWorkspaces(list);
        await persistRegistry(list);
        if (activeId === id) {
          await SecureStore.deleteItemAsync(ACTIVE_KEY);
          setActiveId(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [workspaces, activeId, persistRegistry],
  );

  const exit = useCallback(() => {
    setActiveId(null);
    void SecureStore.deleteItemAsync(ACTIVE_KEY);
  }, []);

  const writeFile = useCallback(
    async (relPath: string, contents: string): Promise<void> => {
      if (!active) throw new Error('No active local workspace');
      const target = joinUri(active.uri, relPath);
      const parent = dirnameUri(target);
      if (parent !== active.uri) {
        await FileSystem.makeDirectoryAsync(parent, { intermediates: true });
      }
      await FileSystem.writeAsStringAsync(target, contents, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await refreshFiles(active);
    },
    [active, refreshFiles],
  );

  const readFile = useCallback(
    async (relPath: string): Promise<string> => {
      if (!active) throw new Error('No active local workspace');
      return FileSystem.readAsStringAsync(joinUri(active.uri, relPath), {
        encoding: FileSystem.EncodingType.UTF8,
      });
    },
    [active],
  );

  const removeFile = useCallback(
    async (relPath: string): Promise<void> => {
      if (!active) return;
      await FileSystem.deleteAsync(joinUri(active.uri, relPath), { idempotent: true });
      await refreshFiles(active);
    },
    [active, refreshFiles],
  );

  const createFolder = useCallback(
    async (
      parentPath: string,
      meta: { name: string; icon?: string; color?: string },
    ): Promise<LocalFolderEntry> => {
      if (!active) throw new Error('No active local workspace');
      const slug = slugify(meta.name);
      const folderPath = joinPath(parentPath, slug);
      const target = joinUri(active.uri, folderPath);
      await FileSystem.makeDirectoryAsync(target, { intermediates: true });
      const markerPath = joinPath(folderPath, '.kf');
      await writeFile(
        markerPath,
        encodeKillioFile({
          kind: 'kf',
          schemaVersion: '2026-v1',
          payload: { name: meta.name, icon: meta.icon ?? '📁', color: meta.color ?? '#64748b' },
        }),
      );
      return {
        path: folderPath,
        name: meta.name,
        parent: parentPath,
        icon: meta.icon ?? null,
        color: meta.color ?? null,
      };
    },
    [active, writeFile],
  );

  const updateFolder = useCallback(
    async (
      folderPath: string,
      meta: { name?: string; icon?: string; color?: string },
    ): Promise<void> => {
      if (!active) return;
      const markerPath = joinPath(folderPath, '.kf');
      let existing: any = { name: folderPath.split('/').pop() ?? 'Folder', icon: '📁', color: '#64748b' };
      try {
        const raw = await readFile(markerPath);
        existing = (decodeKillioFile(raw).payload as Record<string, unknown>) ?? existing;
      } catch {
        /* ignore missing marker */
      }
      const next = { ...existing, ...meta };
      await writeFile(
        markerPath,
        encodeKillioFile({ kind: 'kf', schemaVersion: '2026-v1', payload: next }),
      );
    },
    [active, readFile, writeFile],
  );

  const removeFolder = useCallback(
    async (folderPath: string): Promise<void> => {
      if (!active) return;
      await FileSystem.deleteAsync(joinUri(active.uri, folderPath), { idempotent: true });
      await refreshFiles(active);
    },
    [active, refreshFiles],
  );

  const readKillioFile = useCallback(
    async (relPath: string): Promise<KillioFile> => {
      const raw = await readFile(relPath);
      return decodeKillioFile(raw);
    },
    [readFile],
  );

  const writeKillioFile = useCallback(
    async (relPath: string, file: KillioFile): Promise<void> => {
      await writeFile(relPath, encodeKillioFile(file));
    },
    [writeFile],
  );

  const value = useMemo<LocalWorkspaceApi>(
    () => ({
      supported,
      workspaces,
      activeId,
      active,
      files,
      folders,
      busy,
      createWorkspace,
      selectWorkspace,
      removeWorkspace,
      exit,
      refresh,
      writeFile,
      readFile,
      removeFile,
      createFolder,
      removeFolder,
      updateFolder,
      readKillioFile,
      writeKillioFile,
    }),
    [
      supported,
      workspaces,
      activeId,
      active,
      files,
      folders,
      busy,
      createWorkspace,
      selectWorkspace,
      removeWorkspace,
      exit,
      refresh,
      writeFile,
      readFile,
      removeFile,
      createFolder,
      removeFolder,
      updateFolder,
      readKillioFile,
      writeKillioFile,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocalWorkspace(): LocalWorkspaceApi {
  return useContext(Ctx) ?? FALLBACK_API;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseList(raw: string): LocalWorkspaceMeta[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMeta) : [];
  } catch {
    return [];
  }
}

function isMeta(v: unknown): v is LocalWorkspaceMeta {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.uri === 'string';
}

function joinUri(root: string, rel: string): string {
  if (!rel || rel === '.') return root;
  const normalized = rel.replace(/^\/+/, '');
  return root.endsWith('/') ? root + normalized : `${root}/${normalized}`;
}

function dirnameUri(uri: string): string {
  const idx = uri.replace(/\/$/, '').lastIndexOf('/');
  return idx < 0 ? uri : uri.slice(0, idx + 1);
}

function joinPath(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a.replace(/\/$/, '')}/${b.replace(/^\/+/, '')}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `folder-${Date.now()}`
  );
}

async function listAllFiles(root: string, rel: string): Promise<LocalFileEntry[]> {
  const dir = joinUri(root, rel);
  let entries: string[] = [];
  try {
    entries = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
  const out: LocalFileEntry[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue; // skip dotfiles like .kf markers
    const childPath = joinPath(rel, name);
    const childUri = joinUri(root, childPath);
    let info: FileSystem.FileInfo;
    try {
      info = await FileSystem.getInfoAsync(childUri);
    } catch {
      continue;
    }
    if (!info.exists) continue;
    if (info.isDirectory) {
      const nested = await listAllFiles(root, childPath);
      out.push(...nested);
    } else {
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const kind: LocalFileEntry['kind'] =
        ext === 'kd' || ext === 'kb' || ext === 'km' || ext === 'ks' || ext === 'kf'
          ? (ext as LocalFileEntry['kind'])
          : 'other';
      out.push({
        path: childPath,
        name,
        folder: rel,
        kind,
        lastModified: (info as { modificationTime?: number }).modificationTime ?? 0,
        size: (info as { size?: number }).size ?? 0,
      });
    }
  }
  return out;
}

async function listAllFolders(root: string, rel: string): Promise<LocalFolderEntry[]> {
  const dir = joinUri(root, rel);
  let entries: string[] = [];
  try {
    entries = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return [];
  }
  const out: LocalFolderEntry[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const childPath = joinPath(rel, name);
    const childUri = joinUri(root, childPath);
    let info: FileSystem.FileInfo;
    try {
      info = await FileSystem.getInfoAsync(childUri);
    } catch {
      continue;
    }
    if (!info.exists || !info.isDirectory) continue;
    // Try to read .kf marker for display meta
    let icon: string | null = null;
    let color: string | null = null;
    let displayName = name;
    try {
      const marker = await FileSystem.readAsStringAsync(joinUri(root, joinPath(childPath, '.kf')), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const meta = decodeKillioFile(marker).payload as Record<string, unknown>;
      if (typeof meta?.name === 'string') displayName = meta.name;
      if (typeof meta?.icon === 'string') icon = meta.icon;
      if (typeof meta?.color === 'string') color = meta.color;
    } catch {
      /* no marker — keep defaults */
    }
    out.push({ path: childPath, name: displayName, parent: rel, icon, color });
    const nested = await listAllFolders(root, childPath);
    out.push(...nested);
  }
  return out;
}
