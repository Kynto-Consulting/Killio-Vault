import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen, Card, Body } from '@/ui';
import { useTranslations } from '@/i18n';
import { BrickList, type AddableKind } from '@/ui/BrickRenderer';
import type { Brick } from '@/ui/BrickRenderer';
import { useDocuments } from '@/documents/DocumentsProvider';
import { DocumentHeader, type BreadcrumbSegment, shareDocumentText } from '@/documents/DocumentHeader';
import { DocumentSidebar } from '@/documents/DocumentSidebar';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { useAuth } from '@/core/auth/AuthContext';
import { useLocalWorkspace } from '@/local-workspace/LocalWorkspaceProvider';
import {
  appendDocumentBlock,
  getDocument,
  removeBrick,
  reorderBricks,
  updateBrickContent,
  updateDocument,
  type DocFull,
  type FolderSummary,
} from '@/core/api/documents.client';
import { useWorkspaceCatalog } from '@/workspace/WorkspaceCatalogContext';
import type { KillioFile } from '@/local-workspace/killio-file';

/**
 * Document detail screen. Routes one of three storages depending on the id:
 *
 *   1. UUID-looking id        → cloud document (uses /documents API)
 *   2. id starts with "local:" → local workspace document, .kd file on disk
 *   3. fallback                → cloud (kept for legacy links)
 *
 * Either backend hits the same DocumentHeader + BrickList pair, so the user
 * always sees the same UI regardless of where the doc lives. BrickList itself
 * flips an individual brick into its inline editor when tapped (web parity),
 * so there is no separate edit overlay component.
 */
// Progressive-render window. The voice diary doc grows to 700+ bricks/day;
// mounting all of them at once janks the screen. We render the first N and grow
// the window as the user scrolls near the bottom (onEndReached-style). All
// bricks stay in `doc.bricks`, so editing/realtime/reorder are unaffected.
const BRICK_PAGE_SIZE = 50;

export default function DocumentDetailScreen() {
  const router = useRouter();
  const tDocs = useTranslations('docs');
  const tDetail = useTranslations('docDetail');
  const tFallback = useTranslations('fallback');
  const docsApi = useDocuments();
  const { activeTeam } = useAuth();
  const local = useLocalWorkspace();
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  const rawId = String(params.id ?? '');
  const isLocal = rawId.startsWith('local:');
  const localPath = isLocal ? decodeURIComponent(rawId.slice('local:'.length)) : '';
  const cloudId = isLocal ? null : rawId;

  const [doc, setDoc] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  // Progressive-render window (see BRICK_PAGE_SIZE above). Reset whenever we
  // open a different document.
  const [visibleCount, setVisibleCount] = useState(BRICK_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(BRICK_PAGE_SIZE);
  }, [rawId]);
  // Tap-to-edit is always on — web parity: every brick enters its inline
  // editor on tap, there is no separate Edit/View mode.
  const canEdit = true;
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const [sidebarTab, setSidebarTab] = useState<'copilot' | 'comments' | 'activity' | null>(null);

  // Workspace-wide catalogue (docs / boards / cards / folders / users) for
  // every text brick's `@`-mention picker + this screen's folder-ancestry
  // breadcrumb. Sourced from the global WorkspaceCatalogProvider so we do
  // ZERO per-screen prefetch — the same data already loaded for the rest of
  // the app is reused here.
  const catalog = useWorkspaceCatalog();
  const pickerDocs = catalog.documents;
  const pickerBoards = catalog.boards;
  const pickerCards = catalog.cards;
  const pickerUsers = catalog.users;
  const pickerFolders = catalog.folders;
  // The breadcrumb walker uses parentFolderId — keep the raw shape.
  const allFolders = catalog.rawFolders;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isLocal) {
        const file = await local.readKillioFile(localPath);
        setDoc(localFileToDoc(localPath, file, tFallback('document')));
      } else if (cloudId) {
        const d = await getDocument(cloudId);
        setDoc(d);
      }
    } catch {
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [isLocal, localPath, cloudId, local, tFallback]);

  useEffect(() => {
    void load();
  }, [load]);

  // Real-time collaborative editing: subscribe to the document channel and
  // apply broadcasted brick mutations from other clients (web or another
  // Vault). Local mutations skip the wire — they are already applied
  // optimistically before we POST to the backend.
  useRealtimeChannel(!isLocal && cloudId ? `document:${cloudId}` : null, {
    events: {
      'brick.created': (payload) => {
        const p = payload as { id?: string; kind?: string; content?: any; position?: number };
        const newId = p?.id;
        if (!newId) return;
        setDoc((prev) => {
          if (!prev || prev.bricks.some((b) => b.id === newId)) return prev;
          const next = [...prev.bricks];
          const at = Math.max(0, Math.min(next.length, p.position ?? next.length));
          next.splice(at, 0, { id: newId, kind: p.kind ?? 'text', content: p.content ?? {} });
          return { ...prev, bricks: next };
        });
      },
      'brick.updated': (payload) => {
        const p = payload as { id?: string; brickId?: string; content?: any };
        const id = p?.id ?? p?.brickId;
        if (!id) return;
        setDoc((prev) =>
          prev
            ? { ...prev, bricks: prev.bricks.map((b) => (b.id === id ? { ...b, content: p.content ?? b.content } : b)) }
            : prev,
        );
      },
      'brick.deleted': (payload) => {
        const id = (payload as { id?: string; brickId?: string })?.id ?? (payload as any)?.brickId;
        if (!id) return;
        setDoc((prev) => (prev ? { ...prev, bricks: prev.bricks.filter((b) => b.id !== id) } : prev));
      },
      'brick.reordered': (payload) => {
        const ids = (payload as { brickIds?: string[] })?.brickIds;
        if (!Array.isArray(ids)) return;
        setDoc((prev) => {
          if (!prev) return prev;
          const byId = new Map(prev.bricks.map((b) => [b.id, b]));
          const sorted = ids.map((id) => byId.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
          // Append any locally-known bricks the broadcast didn't mention.
          for (const b of prev.bricks) if (b.id && !ids.includes(b.id)) sorted.push(b);
          return { ...prev, bricks: sorted };
        });
      },
      'document.updated': (payload) => {
        const nextTitle = (payload as { title?: string })?.title;
        if (typeof nextTitle === 'string') {
          setDoc((prev) => (prev ? { ...prev, title: nextTitle } : prev));
        }
      },
      // Bountiful + simple table cell patches arrive as targeted deltas so
      // other clients don't reload the whole brick to see one cell change.
      'brick.cell_patched': (payload) => {
        const p = payload as {
          id?: string;
          kind?: string;
          cellPatch?: {
            rowId?: string;
            colId?: string;
            cell?: any;
            rowMeta?: any;
            rowIndex?: number;
            colIndex?: number;
            value?: string;
          };
        };
        const id = p?.id;
        const patch = p?.cellPatch;
        if (!id || !patch) return;
        setDoc((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            bricks: prev.bricks.map((b) => {
              if (b.id !== id) return b;
              return { ...b, content: applyCellPatch(b.content, patch) };
            }),
          };
        });
      },
      'brick.column_patched': (payload) => {
        const p = payload as {
          id?: string;
          columnPatch?: { colId?: string; updates?: Record<string, any> };
        };
        const id = p?.id;
        const patch = p?.columnPatch;
        if (!id || !patch?.colId || !patch?.updates) return;
        setDoc((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            bricks: prev.bricks.map((b) => {
              if (b.id !== id) return b;
              return { ...b, content: applyColumnPatch(b.content, patch.colId!, patch.updates!) };
            }),
          };
        });
      },
    },
  });

  const breadcrumb = useMemo<BreadcrumbSegment[]>(() => {
    const segs: BreadcrumbSegment[] = [];
    if (isLocal) {
      segs.push({
        key: 'local',
        label: local.active?.name ?? tFallback('local'),
        icon: '💾',
        onPress: () => router.replace('/documents'),
      });
      const parts = localPath.split('/').slice(0, -1);
      let cursor = '';
      for (const p of parts) {
        cursor = cursor ? `${cursor}/${p}` : p;
        // Land back in /documents with the folderId param so the screen
        // restores the same folderStack the user was browsing. Captured by
        // value so each segment routes to its own ancestor, not the leaf.
        const target = cursor;
        segs.push({
          key: `local:${cursor}`,
          label: p,
          onPress: () =>
            router.push({
              pathname: '/documents',
              params: { folderId: `local:${target}` },
            }),
        });
      }
    } else {
      // Workspace root.
      segs.push({
        key: 'ws',
        label: activeTeam?.name ?? tFallback('workspace'),
        onPress: () => router.replace('/workspace'),
      });
      // /documents root.
      segs.push({
        key: 'docs',
        label: tFallback('breadcrumbDocs'),
        onPress: () => router.replace('/documents'),
      });
      // Folder ancestry — walk parentFolderId up from the doc's folder, then
      // reverse so the breadcrumb reads root → leaf. Missing folders (e.g.
      // catalog still loading or doc moved out from under us) just collapse
      // and the breadcrumb gracefully shrinks to Workspace / Documents / Doc.
      if (doc?.folderId && allFolders.length > 0) {
        const byId = new Map(allFolders.map((f) => [f.id, f]));
        const chain: FolderSummary[] = [];
        let cur: FolderSummary | undefined = byId.get(doc.folderId);
        const guard = new Set<string>(); // cycle guard
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id);
          chain.unshift(cur);
          cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
        }
        for (const f of chain) {
          const fid = f.id;
          segs.push({
            key: `folder:${fid}`,
            label: f.name,
            icon: f.icon ?? undefined,
            onPress: () =>
              router.push({ pathname: '/documents', params: { folderId: fid } }),
          });
        }
      }
    }
    segs.push({
      key: 'doc',
      label: doc?.title ?? params.title ?? tFallback('document'),
    });
    return segs;
  }, [
    isLocal,
    local.active?.name,
    localPath,
    activeTeam?.name,
    doc?.title,
    doc?.folderId,
    allFolders,
    params.title,
    router,
    tFallback,
  ]);

  const persistLocal = useCallback(
    async (nextDoc: DocFull) => {
      if (!isLocal) return;
      const file: KillioFile = {
        kind: 'kd',
        schemaVersion: '2026-v1',
        payload: {
          id: nextDoc.id,
          title: nextDoc.title,
          bricks: nextDoc.bricks.map((b, i) => ({
            id: b.id,
            kind: b.kind,
            position: i,
            content: b.content,
          })),
        },
      };
      await local.writeKillioFile(localPath, file);
    },
    [isLocal, local, localPath],
  );

  const handleUpdate = async (brickId: string, next: Brick) => {
    setSaving('saving');
    setDoc((prev) =>
      prev
        ? {
            ...prev,
            bricks: prev.bricks.map((b) =>
              b.id === brickId ? { ...b, content: next.content } : b,
            ),
          }
        : prev,
    );
    try {
      if (isLocal) {
        // Locally we re-write the whole .kd file — small, no API.
        const after = doc
          ? {
              ...doc,
              bricks: doc.bricks.map((b) =>
                b.id === brickId ? { ...b, content: next.content } : b,
              ),
            }
          : doc;
        if (after) await persistLocal(after);
      } else if (cloudId) {
        await updateBrickContent(cloudId, brickId, next.content);
      }
      setSaving('saved');
    } catch {
      setSaving('offline');
    }
  };

  const handleDelete = async (brickId: string) => {
    setDoc((prev) =>
      prev
        ? { ...prev, bricks: prev.bricks.filter((b) => b.id !== brickId) }
        : prev,
    );
    try {
      if (isLocal) {
        if (doc) {
          await persistLocal({
            ...doc,
            bricks: doc.bricks.filter((b) => b.id !== brickId),
          });
        }
      } else if (cloudId) {
        await removeBrick(cloudId, brickId);
      }
    } catch {
      void load();
    }
  };

  const handleReorder = async (orderedIds: string[]) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.bricks.map((b) => [b.id, b]));
      const sorted = orderedIds.map((id) => byId.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
      return { ...prev, bricks: sorted };
    });
    try {
      if (isLocal) {
        if (doc) {
          const byId = new Map(doc.bricks.map((b) => [b.id, b]));
          const sorted = orderedIds.map((id) => byId.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
          await persistLocal({ ...doc, bricks: sorted });
        }
      } else if (cloudId) {
        await reorderBricks(cloudId, orderedIds);
      }
    } catch {
      void load();
    }
  };

  const handleAdd = async (
    kind: AddableKind,
    afterBrickId?: string,
  ): Promise<string | void> => {
    const initial = defaultContentFor(kind);
    const backendKind = kindForBackend(kind);
    let newId: string | undefined;
    try {
      if (isLocal) {
        newId = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        setDoc((prev) => {
          if (!prev) return prev;
          const next = [...prev.bricks];
          const idx = afterBrickId
            ? next.findIndex((b) => b.id === afterBrickId)
            : next.length - 1;
          next.splice(idx + 1, 0, { id: newId!, kind: backendKind, content: initial });
          void persistLocal({ ...prev, bricks: next });
          return { ...prev, bricks: next };
        });
      } else if (cloudId) {
        const created = await appendDocumentBlock(cloudId, backendKind, initial);
        newId = created.id;
        setDoc((prev) => {
          if (!prev) return prev;
          const next = [...prev.bricks];
          const idx = afterBrickId
            ? next.findIndex((b) => b.id === afterBrickId)
            : next.length - 1;
          next.splice(idx + 1, 0, { id: created.id, kind: backendKind, content: initial });
          return { ...prev, bricks: next };
        });
        if (afterBrickId) {
          const orderedIds = (doc?.bricks ?? []).map((b) => b.id).filter(Boolean) as string[];
          const idx = orderedIds.indexOf(afterBrickId);
          if (idx >= 0) {
            orderedIds.splice(idx + 1, 0, created.id);
            try {
              await reorderBricks(cloudId, orderedIds);
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      newId = undefined;
    }
    return newId;
  };

  const rename = async (next: string) => {
    if (!doc) return;
    setDoc({ ...doc, title: next });
    try {
      if (isLocal) {
        await persistLocal({ ...doc, title: next });
      } else if (cloudId) {
        await updateDocument(cloudId, { title: next });
      }
    } catch {
      /* ignore */
    }
  };

  // The bricks actually mounted right now (first `visibleCount`, in doc order).
  const allBricks = doc?.bricks ?? [];
  const visibleBricks = useMemo(
    () => allBricks.slice(0, visibleCount),
    [allBricks, visibleCount],
  );
  const hasMoreBricks = visibleCount < allBricks.length;

  // Grow the window when the user scrolls within ~600px of the bottom. Cheap
  // onEndReached emulation for the ScrollView (BrickList isn't a FlatList).
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasMoreBricks) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const distanceToBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceToBottom < 600) {
        setVisibleCount((c) => Math.min(c + BRICK_PAGE_SIZE, allBricks.length));
      }
    },
    [hasMoreBricks, allBricks.length],
  );

  return (
    <Screen padded={false}>
      <DocumentHeader
        title={doc?.title ?? String(params.title ?? '')}
        breadcrumb={breadcrumb}
        visibility={doc?.visibility}
        onBack={() => router.back()}
        onRename={rename}
        onShare={() =>
          shareDocumentText({
            title: doc?.title ?? tFallback('document'),
            body: flattenText(doc?.bricks ?? []),
          })
        }
        onDelete={
          doc
            ? () => {
                docsApi.openDeleteDocument(
                  { id: doc.id, title: doc.title },
                  { onDeleted: () => router.back() },
                );
              }
            : undefined
        }
        statusLabel={statusLabelFor(saving, tDetail)}
        onOpenSidebar={isLocal ? undefined : (tab) => setSidebarTab(tab)}
      />

      <ScrollView
        className="flex-1 mt-2"
        contentContainerClassName="px-4 pb-10 gap-3"
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {loading ? (
          <Card>
            <Body muted>{tDocs('loading')}</Body>
          </Card>
        ) : !doc ? (
          <Card>
            <Body muted>{tDetail('loadError')}</Body>
          </Card>
        ) : (
          <BrickList
            bricks={visibleBricks.map((b) => ({
              id: b.id,
              kind: b.kind,
              content: b.content,
            }))}
            editable={canEdit}
            onUpdate={handleUpdate}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onReorder={handleReorder}
            documents={pickerDocs}
            boards={pickerBoards}
            cards={pickerCards}
            users={pickerUsers}
            folders={pickerFolders}
            activeBricks={(doc.bricks ?? [])
              .filter((b) => !!b.id)
              .map((b) => ({ id: b.id!, kind: b.kind }))}
            teamId={isLocal ? undefined : (activeTeam?.id ?? undefined)}
          />
        )}

        {isLocal ? (
          <View className="mt-2 rounded-xl border border-cyan/30 bg-cyan/5 px-3 py-2">
            <Body muted>{tDetail('localBadge')}</Body>
          </View>
        ) : null}
      </ScrollView>

      {/* Copilot / Chat / Activity drawer — cloud docs only (the linked-room
          and activity-log endpoints only exist on the cloud). */}
      {!isLocal && cloudId ? (
        <DocumentSidebar
          open={sidebarTab !== null}
          onClose={() => setSidebarTab(null)}
          documentId={cloudId}
          documentTitle={doc?.title ?? tFallback('document')}
          initialTab={sidebarTab ?? 'comments'}
        />
      ) : null}
    </Screen>
  );
}

function localFileToDoc(
  path: string,
  file: KillioFile,
  fallbackTitle: string,
): DocFull {
  const payload = (file.payload && typeof file.payload === 'object'
    ? file.payload
    : {}) as Record<string, unknown>;
  const rawBricks = Array.isArray(payload.bricks) ? (payload.bricks as Array<any>) : [];
  return {
    id: `local:${path}`,
    title: typeof payload.title === 'string' ? payload.title : path.split('/').pop() ?? fallbackTitle,
    bricks: rawBricks.map((b, i) => ({
      id: String(b?.id ?? `b${i}`),
      kind: typeof b?.kind === 'string' ? b.kind : 'text',
      content: (b?.content && typeof b.content === 'object' ? b.content : {}) as Record<string, any>,
    })),
    visibility: 'private',
  };
}

function defaultContentFor(kind: AddableKind): Record<string, any> {
  switch (kind) {
    case 'heading':
      return { text: '', level: 2 };
    case 'quote':
      return { text: '' };
    case 'callout':
      return { text: '', icon: '💡' };
    case 'checklist':
      return { items: [{ id: 'i1', text: '', checked: false }] };
    case 'code':
      return { code: '', language: 'plaintext' };
    case 'divider':
      return {};
    case 'image':
      return { url: '', alt: '' };
    case 'bookmark':
      return { url: '', title: '' };
    case 'math':
      return { formula: '', display: true };
    case 'table':
      return { rows: [['', ''], ['', '']] };
    case 'bountiful_table':
    case 'database':
      return { columns: [], rows: [] };
    case 'mesh':
      return { title: 'Canvas' };
    case 'form':
      return {
        title: '',
        description: '',
        submitLabel: 'Enviar',
        successMessage: 'Enviado correctamente.',
        pages: [{ id: 'page-1', label: 'Paso 1' }],
        childrenByContainer: { 'page-1': [] },
      };
    case 'toggle':
      return { title: '', defaultOpen: false, children: [] };
    default:
      return { text: '' };
  }
}

function kindForBackend(kind: AddableKind): string {
  if (kind === 'heading') return 'text';
  if (kind === 'toggle') return 'accordion';
  return kind;
}

function flattenText(bricks: Array<{ kind: string; content: Record<string, any> }>): string {
  return bricks
    .map((b) => {
      const t = b.content?.text ?? b.content?.value ?? '';
      return typeof t === 'string' ? t : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Apply a `brick.cell_patched` delta to a table brick's content in place.
 * Handles both the bountiful (rowId/colId/cell+rowMeta) and the legacy
 * simple (rowIndex/colIndex/value) shapes the backend emits.
 */
function applyCellPatch(
  content: Record<string, any>,
  patch: {
    rowId?: string;
    colId?: string;
    cell?: any;
    rowMeta?: any;
    rowIndex?: number;
    colIndex?: number;
    value?: string;
  },
): Record<string, any> {
  const next: Record<string, any> = { ...content };
  // Bountiful table: cells: { [rowId]: { [colId]: cell } }, rows: [{ id, meta }, …]
  if (patch.rowId && patch.colId && patch.cell) {
    const cells = { ...(next.cells ?? {}) };
    cells[patch.rowId] = { ...(cells[patch.rowId] ?? {}), [patch.colId]: patch.cell };
    next.cells = cells;
    if (patch.rowMeta && Array.isArray(next.rows)) {
      next.rows = next.rows.map((r: any) =>
        r?.id === patch.rowId ? { ...r, ...patch.rowMeta } : r,
      );
    }
    return next;
  }
  // Simple table: rows[rowIndex][colIndex] = value
  if (
    typeof patch.rowIndex === 'number' &&
    typeof patch.colIndex === 'number' &&
    Array.isArray(next.rows)
  ) {
    const rows = next.rows.map((row: any, i: number) => {
      if (i !== patch.rowIndex) return row;
      const arr = Array.isArray(row) ? [...row] : [];
      arr[patch.colIndex!] = patch.value ?? '';
      return arr;
    });
    next.rows = rows;
    return next;
  }
  return next;
}

/** Apply a `brick.column_patched` delta to a bountiful table's columns. */
function applyColumnPatch(
  content: Record<string, any>,
  colId: string,
  updates: Record<string, any>,
): Record<string, any> {
  const next: Record<string, any> = { ...content };
  if (!Array.isArray(next.columns)) return next;
  next.columns = next.columns.map((c: any) =>
    c?.id === colId ? { ...c, ...updates } : c,
  );
  return next;
}

function statusLabelFor(
  s: 'idle' | 'saving' | 'saved' | 'offline',
  t: ReturnType<typeof useTranslations>,
): string | undefined {
  if (s === 'saving') return t('savingShort');
  if (s === 'saved') return t('savedShort');
  if (s === 'offline') return t('offlineShort');
  return undefined;
}
