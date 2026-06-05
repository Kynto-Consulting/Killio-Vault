import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Eye, MoreVertical, Pencil } from 'lucide-react-native';

import { Screen, Card, Body } from '@/ui';
import { BrickList } from '@/ui/BrickRenderer';
import type { Brick } from '@/ui/BrickRenderer';
import { BrickEditor, type BrickKind } from '@/ui/BrickEditor';
import { useDocuments } from '@/documents/DocumentsProvider';
import {
  appendDocumentBlock,
  getDocument,
  removeBrick,
  reorderBricks,
  updateBrickContent,
  type DocFull,
} from '@/core/api/documents.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Single-document viewer + editor. Read-only by default; the pencil flips on
 * `BrickEditor` which adds the full toolkit (add / move / copy / paste /
 * delete / multi-select). Edits are persisted brick-by-brick so a partial
 * failure leaves the rest of the doc consistent.
 */
export default function DocumentDetailScreen() {
  const router = useRouter();
  const docs = useDocuments();
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  const docId = String(params.id);
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getDocument(docId);
      setDoc(d);
    } catch {
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdate = async (brickId: string, next: Brick) => {
    // Optimistic local update so the typing experience stays snappy
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
      await updateBrickContent(docId, brickId, next.content);
    } catch {
      // Silent — the next typed keystroke will retry. A toast layer would
      // surface this once we wire one up.
    }
  };

  const handleDelete = async (brickId: string) => {
    setDoc((prev) =>
      prev
        ? { ...prev, bricks: prev.bricks.filter((b) => b.id !== brickId) }
        : prev,
    );
    try {
      await removeBrick(docId, brickId);
    } catch {
      void load();
    }
  };

  const handleReorder = async (orderedIds: string[]) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.bricks.map((b) => [b.id, b]));
      const sorted = orderedIds
        .map((id) => byId.get(id))
        .filter((b): b is NonNullable<typeof b> => !!b);
      return { ...prev, bricks: sorted };
    });
    try {
      await reorderBricks(docId, orderedIds);
    } catch {
      void load();
    }
  };

  const handleAdd = async (
    kind: BrickKind,
    afterBrickId?: string,
  ): Promise<string | void> => {
    try {
      const initial = defaultContentFor(kind);
      const created = await appendDocumentBlock(docId, kindForBackend(kind), initial);
      // Insert locally next to the anchor; backend ordering is fixed via a
      // reorder call so the new brick lands in the right slot.
      setDoc((prev) => {
        if (!prev) return prev;
        const next = [...prev.bricks];
        const anchorIdx = afterBrickId
          ? next.findIndex((b) => b.id === afterBrickId)
          : next.length - 1;
        const insertAt = anchorIdx + 1;
        next.splice(insertAt, 0, {
          id: created.id,
          kind: kindForBackend(kind),
          content: initial,
        });
        return { ...prev, bricks: next };
      });
      if (afterBrickId) {
        // Persist the order so the brick stays right after its anchor.
        const orderedIds = (doc?.bricks ?? []).map((b) => b.id).filter(Boolean) as string[];
        const idx = orderedIds.indexOf(afterBrickId);
        if (idx >= 0) {
          orderedIds.splice(idx + 1, 0, created.id);
          try {
            await reorderBricks(docId, orderedIds);
          } catch {
            /* ignore — UI already shows it in the right place */
          }
        }
      }
      return created.id;
    } catch {
      return undefined;
    }
  };

  return (
    <Screen padded={false}>
      <View className="flex-row items-center justify-between px-4 pt-4">
        <Pressable
          hitSlop={10}
          onPress={() => router.back()}
          className="rounded-md p-1"
        >
          <ArrowLeft size={20} color={colors.foreground} />
        </Pressable>
        <View className="flex-1 px-3">
          <Text
            style={{ fontFamily: fonts.bold }}
            className="text-lg text-foreground"
            numberOfLines={1}
          >
            {doc?.title ?? params.title ?? 'Documento'}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => setCanEdit((v) => !v)}
            className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1.5"
          >
            {canEdit ? (
              <Eye size={13} color={colors.foreground} />
            ) : (
              <Pencil size={13} color={colors.foreground} />
            )}
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-xs text-foreground"
            >
              {canEdit ? 'Ver' : 'Editar'}
            </Text>
          </Pressable>
          {doc ? (
            <Pressable
              onPress={() =>
                docs.openEditDocument(
                  { id: doc.id, title: doc.title },
                  {
                    onSaved: (saved) =>
                      setDoc((prev) =>
                        prev ? { ...prev, title: saved.title } : prev,
                      ),
                  },
                )
              }
              className="rounded-md border border-border bg-card p-2"
            >
              <MoreVertical size={14} color={colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        className="flex-1 mt-3"
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
        ) : canEdit ? (
          <BrickEditor
            bricks={(doc.bricks ?? []).map((b) => ({
              id: b.id,
              kind: b.kind,
              content: b.content,
            }))}
            onUpdateBrick={handleUpdate}
            onAddBrick={handleAdd}
            onDeleteBrick={handleDelete}
            onReorderBricks={handleReorder}
          />
        ) : (
          <BrickList
            bricks={(doc.bricks ?? []).map((b) => ({
              id: b.id,
              kind: b.kind,
              content: b.content,
            }))}
            canEdit={false}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function defaultContentFor(kind: BrickKind): Record<string, any> {
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

function kindForBackend(kind: BrickKind): string {
  // Vault BrickRenderer treats 'heading' as a Text brick variant; the backend
  // stores it as 'text' with a leading "#"…"######". Other kinds map 1:1.
  if (kind === 'heading') return 'text';
  return kind;
}
