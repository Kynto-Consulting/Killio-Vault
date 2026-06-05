import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Pencil, Save } from 'lucide-react-native';

import { Screen, Card, Body } from '@/ui';
import { BrickList, type Brick } from '@/ui/BrickRenderer';
import {
  getDocument,
  updateBrickContent,
  type DocFull,
} from '@/core/api/documents.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Single-document viewer. Read-only by default; tapping the pencil enables
 * the experimental edit mode in BrickRenderer (text / quote / callout /
 * checklist supported). Edits are persisted brick-by-brick via PUT
 * /documents/:id/bricks/:brickId so a partial save still leaves the doc
 * consistent.
 */
export default function DocumentDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  const docId = String(params.id);
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [dirty, setDirty] = useState<Record<string, Brick>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getDocument(docId);
      setDoc(d);
      setDirty({});
    } catch {
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onBrickChange = (id: string, next: Brick) => {
    setDirty((prev) => ({ ...prev, [id]: next }));
  };

  const saveAll = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    try {
      for (const [brickId, brick] of Object.entries(dirty)) {
        try {
          await updateBrickContent(docId, brickId, brick.content);
        } catch {
          // continue with the rest; show a toast later if we add one
        }
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <View className="flex-row items-center justify-between px-5 pt-4">
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
        {canEdit ? (
          <Pressable
            disabled={saving || !Object.keys(dirty).length}
            onPress={saveAll}
            className={`flex-row items-center gap-1 rounded-md border border-border bg-primary px-3 py-1.5 ${saving || !Object.keys(dirty).length ? 'opacity-60' : ''}`}
          >
            <Save size={14} color={colors.primaryForeground ?? '#171717'} />
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-xs text-primary-foreground"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setCanEdit(true)}
            className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-3 py-1.5"
          >
            <Pencil size={14} color={colors.foreground} />
            <Text
              style={{ fontFamily: fonts.medium }}
              className="text-xs text-foreground"
            >
              Editar
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        className="flex-1 mt-3"
        contentContainerClassName="px-5 pb-10 gap-3"
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
            canEdit={canEdit}
            onChange={onBrickChange}
          />
        )}
      </ScrollView>
    </Screen>
  );
}
