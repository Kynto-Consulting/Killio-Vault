import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen, Card, Body } from '@/ui';
import { BrickList, type AddableKind } from '@/ui/BrickRenderer';
import type { Brick } from '@/ui/BrickRenderer';
import { useDocuments } from '@/documents/DocumentsProvider';
import { DocumentHeader, type BreadcrumbSegment, shareDocumentText } from '@/documents/DocumentHeader';
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
} from '@/core/api/documents.client';
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
export default function DocumentDetailScreen() {
  const router = useRouter();
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
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isLocal) {
        const file = await local.readKillioFile(localPath);
        setDoc(localFileToDoc(localPath, file));
      } else if (cloudId) {
        const d = await getDocument(cloudId);
        setDoc(d);
      }
    } catch {
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [isLocal, localPath, cloudId, local]);

  useEffect(() => {
    void load();
  }, [load]);

  const breadcrumb = useMemo<BreadcrumbSegment[]>(() => {
    const segs: BreadcrumbSegment[] = [];
    if (isLocal) {
      segs.push({
        key: 'local',
        label: local.active?.name ?? 'Local',
        icon: '💾',
        onPress: () => router.replace('/documents'),
      });
      const parts = localPath.split('/').slice(0, -1);
      let cursor = '';
      for (const p of parts) {
        cursor = cursor ? `${cursor}/${p}` : p;
        segs.push({
          key: `local:${cursor}`,
          label: p,
          onPress: () => router.replace('/documents'),
        });
      }
    } else {
      segs.push({
        key: 'ws',
        label: activeTeam?.name ?? 'Workspace',
        onPress: () => router.replace('/workspace'),
      });
      segs.push({
        key: 'docs',
        label: 'Documentos',
        onPress: () => router.replace('/documents'),
      });
    }
    segs.push({
      key: 'doc',
      label: doc?.title ?? params.title ?? 'Documento',
    });
    return segs;
  }, [isLocal, local.active?.name, localPath, activeTeam?.name, doc?.title, params.title, router]);

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

  return (
    <Screen padded={false}>
      <DocumentHeader
        title={doc?.title ?? String(params.title ?? '')}
        breadcrumb={breadcrumb}
        visibility={doc?.visibility}
        canEdit={canEdit}
        onBack={() => router.back()}
        onToggleEdit={() => setCanEdit((v) => !v)}
        onRename={rename}
        onShare={() =>
          shareDocumentText({
            title: doc?.title ?? 'Documento',
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
        statusLabel={statusLabelFor(saving)}
      />

      <ScrollView
        className="flex-1 mt-2"
        contentContainerClassName="px-4 pb-10 gap-3"
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <Card>
            <Body muted>Cargando…</Body>
          </Card>
        ) : !doc ? (
          <Card>
            <Body muted>No se pudo cargar el documento.</Body>
          </Card>
        ) : (
          <BrickList
            bricks={(doc.bricks ?? []).map((b) => ({
              id: b.id,
              kind: b.kind,
              content: b.content,
            }))}
            editable={canEdit}
            onUpdate={handleUpdate}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onReorder={handleReorder}
          />
        )}

        {isLocal ? (
          <View className="mt-2 rounded-xl border border-cyan/30 bg-cyan/5 px-3 py-2">
            <Body muted>📂 Documento local — vive en este dispositivo.</Body>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function localFileToDoc(path: string, file: KillioFile): DocFull {
  const payload = (file.payload && typeof file.payload === 'object'
    ? file.payload
    : {}) as Record<string, unknown>;
  const rawBricks = Array.isArray(payload.bricks) ? (payload.bricks as Array<any>) : [];
  return {
    id: `local:${path}`,
    title: typeof payload.title === 'string' ? payload.title : path.split('/').pop() ?? 'Documento',
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
    default:
      return { text: '' };
  }
}

function kindForBackend(kind: AddableKind): string {
  if (kind === 'heading') return 'text';
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

function statusLabelFor(s: 'idle' | 'saving' | 'saved' | 'offline'): string | undefined {
  if (s === 'saving') return 'Guardando…';
  if (s === 'saved') return 'Guardado';
  if (s === 'offline') return 'Sin conexión';
  return undefined;
}
