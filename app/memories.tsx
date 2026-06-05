import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Brain, Plus, Trash2 } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import {
  createMemory,
  deleteMemory,
  listMemories,
  type UserMemory,
} from '@/core/api/memories.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Cloud-side user memories — the persistent "what does the assistant know
 * about me" surface backed by the new /vault/memories endpoints. Mirrors
 * the local-agent memory screen but reads/writes the shared cloud store so
 * memories are available from any device or the web app.
 */
export default function MemoriesScreen() {
  const t = useTranslations('memories');
  const { activeTeam } = useAuth();
  const [items, setItems] = useState<UserMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listMemories({ teamId: activeTeam?.id ?? null });
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    setItems((cur) => cur.filter((x) => x.id !== id));
    try {
      await deleteMemory(id);
    } catch {
      void load();
    }
  };

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4 gap-2">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <H1>{t('title')}</H1>
            <Body muted>{t('subtitle')}</Body>
          </View>
          <Pressable
            onPress={() => setCreateOpen(true)}
            className="h-9 flex-row items-center gap-1 rounded-md bg-primary px-3"
          >
            <Plus size={13} color={colors.primaryForeground ?? '#171717'} />
            <Text
              style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
              className="text-xs"
            >
              {t('add')}
            </Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        className="mt-3"
        contentContainerClassName="px-5 pb-10 gap-2"
        data={items}
        keyExtractor={(m) => m.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={
          <Card>
            <View className="items-center justify-center py-10 gap-2 opacity-60">
              <Brain size={28} color={colors.mutedForeground} />
              <Body muted>{t('empty')}</Body>
            </View>
          </Card>
        }
        renderItem={({ item }) => (
          <View className="rounded-xl border border-border bg-card p-3 gap-2">
            <View className="flex-row items-center justify-between">
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                {item.kind}
              </Text>
              <View className="flex-row items-center gap-2">
                {item.teamId ? (
                  <Text className="text-[10px] text-cyan">{t('scopeWorkspace')}</Text>
                ) : (
                  <Text className="text-[10px] text-muted-foreground">{t('scopeGlobal')}</Text>
                )}
                <Pressable
                  onPress={() => void remove(item.id)}
                  hitSlop={6}
                  className="rounded-md border border-border bg-background p-1"
                >
                  <Trash2 size={12} color={colors.destructive} />
                </Pressable>
              </View>
            </View>
            <Text style={{ fontFamily: fonts.regular }} className="text-sm text-foreground">
              {item.text}
            </Text>
            <Text className="text-[10px] text-muted-foreground">
              {new Date(item.createdAt).toLocaleString()}
            </Text>
          </View>
        )}
      />

      <CreateMemoryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          try {
            const created = await createMemory({
              text: input.text,
              kind: input.kind || undefined,
              teamId: input.scopeToWorkspace ? activeTeam?.id ?? null : null,
            });
            setItems((cur) => [created, ...cur]);
          } finally {
            setCreateOpen(false);
          }
        }}
      />
    </Screen>
  );
}

function CreateMemoryModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose(): void;
  onCreate(input: { text: string; kind: string; scopeToWorkspace: boolean }): Promise<void>;
}) {
  const t = useTranslations('memories');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('general');
  const [scope, setScope] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-background/80 p-6">
        <View className="w-full max-w-md rounded-2xl border border-border bg-card p-5 gap-3">
          <Text style={{ fontFamily: fonts.bold }} className="text-lg text-foreground">
            {t('newMemory')}
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('textPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={{ fontFamily: fonts.regular, minHeight: 80 }}
            className="rounded-md border border-border bg-background p-2 text-sm text-foreground"
            autoFocus
          />
          <TextInput
            value={kind}
            onChangeText={setKind}
            placeholder={t('kindPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            style={{ fontFamily: fonts.regular }}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          />
          <Pressable
            onPress={() => setScope((v) => !v)}
            className="flex-row items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
          >
            <View
              className={`h-4 w-4 rounded border ${
                scope ? 'border-cyan bg-cyan' : 'border-border bg-background'
              }`}
            />
            <Text className="text-sm text-foreground">{t('scopeToWorkspace')}</Text>
          </Pressable>
          <View className="flex-row justify-end gap-2 mt-1">
            <Pressable
              onPress={onClose}
              className="rounded-md border border-border bg-secondary px-4 py-2"
            >
              <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                {t('cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!text.trim()) return;
                setBusy(true);
                try {
                  await onCreate({ text: text.trim(), kind: kind.trim(), scopeToWorkspace: scope });
                  setText('');
                  setKind('general');
                  setScope(false);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy || !text.trim()}
              className={`rounded-md bg-primary px-4 py-2 ${busy || !text.trim() ? 'opacity-60' : ''}`}
            >
              <Text
                style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
                className="text-sm"
              >
                {busy ? '…' : t('save')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
