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
import { useRouter } from 'expo-router';
import { ChevronRight, LayoutDashboard, Orbit, Plus, X } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { useBoardsApi } from '@/core/api/boards.dual';
import { useLocalWorkspace } from '@/local-workspace/LocalWorkspaceProvider';
import type { BoardSummary } from '@/core/api/boards.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * List of kanban + mesh boards in the active workspace. Mirrors the web /b
 * index. In cloud mode the workspace is `activeTeam`; in local mode it's the
 * active local workspace and boards live on-device in `local-boards-store`.
 *
 * Both modes share the same screen — the dual router `useBoardsApi()`
 * decides where the calls go. Realtime subscriptions are cloud-only.
 */
export default function BoardsIndexScreen() {
  const router = useRouter();
  const t = useTranslations('boardsIndex');
  const tBoard = useTranslations('board');
  const { activeTeam } = useAuth();
  const localWs = useLocalWorkspace();
  const api = useBoardsApi(activeTeam?.id ?? null);
  const isLocal = api.mode === 'local';

  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    const wsId = api.workspaceId;
    if (!wsId) return;
    setLoading(true);
    try {
      setBoards(await api.listBoards(wsId));
    } catch {
      setBoards([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await api.createBoard({ name, boardType: 'kanban' });
      setNewName('');
      setCreating(false);
      // Open the new board immediately — matches the cloud "+ New" flow.
      router.push({
        pathname: '/b/[id]',
        params: { id: created.id, name: created.name },
      });
      void load();
    } catch {
      /* swallow — keep the modal open so user can retry */
    }
  }, [api, newName, router, load]);

  const kanban = boards.filter((b) => b.boardType !== 'mesh');
  const mesh = boards.filter((b) => b.boardType === 'mesh');
  const isEmpty = boards.length === 0;

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4 gap-2 flex-row items-start justify-between">
        <View style={{ flex: 1 }}>
          <H1>{t('title')}</H1>
          <Body muted>
            {isLocal
              ? `${localWs.active?.name ?? ''} · local`
              : t('subtitle')}
          </Body>
        </View>
        <Pressable
          onPress={() => setCreating(true)}
          className="flex-row items-center gap-1 rounded-md bg-cyan px-3 py-2 mt-2"
          accessibilityLabel={tBoard('createBoard')}
        >
          <Plus size={12} color={colors.background} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-background">
            {tBoard('createBoard')}
          </Text>
        </Pressable>
      </View>

      <FlatList
        className="mt-3"
        contentContainerClassName="px-5 pb-10 gap-2"
        data={[
          ...(kanban.length > 0 ? [{ kind: 'header' as const, label: t('kanban') }] : []),
          ...kanban.map((b) => ({ kind: 'board' as const, board: b })),
          ...(mesh.length > 0 ? [{ kind: 'header' as const, label: t('mesh') }] : []),
          ...mesh.map((b) => ({ kind: 'board' as const, board: b })),
        ]}
        keyExtractor={(item, i) =>
          item.kind === 'header' ? `h:${item.label}` : `b:${item.board.id}:${i}`
        }
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={
          isEmpty ? (
            <Card>
              <Body muted>{t('empty')}</Body>
              <Pressable
                onPress={() => setCreating(true)}
                className="mt-3 flex-row items-center justify-center gap-1 rounded-md bg-cyan px-3 py-2"
              >
                <Plus size={12} color={colors.background} />
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-xs text-background"
                >
                  {tBoard('firstBoardCTA')}
                </Text>
              </Pressable>
            </Card>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                {item.label}
              </Text>
            );
          }
          const Icon = item.board.boardType === 'mesh' ? Orbit : LayoutDashboard;
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/b/[id]',
                  params: { id: item.board.id, name: item.board.name },
                })
              }
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <View className="h-9 w-9 items-center justify-center rounded-md bg-cyan/10">
                <Icon size={14} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-sm text-foreground"
                  numberOfLines={1}
                >
                  {item.board.name}
                </Text>
                {item.board.description ? (
                  <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
                    {item.board.description}
                  </Text>
                ) : null}
              </View>
              <ChevronRight size={14} color={colors.mutedForeground} />
            </Pressable>
          );
        }}
      />

      {/* Create-board modal (used in both cloud and local mode). */}
      <Modal
        visible={creating}
        transparent
        animationType="slide"
        onRequestClose={() => setCreating(false)}
      >
        <View className="flex-1 bg-background/80">
          <Pressable onPress={() => setCreating(false)} style={{ flex: 1 }} />
          <View className="rounded-t-2xl border-t border-border bg-card p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-sm text-foreground"
              >
                {tBoard('createBoard')}
              </Text>
              <Pressable onPress={() => setCreating(false)} hitSlop={8}>
                <X size={16} color={colors.foreground} />
              </Pressable>
            </View>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder={tBoard('boardNamePlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              style={{ fontFamily: fonts.regular, color: colors.foreground }}
              className="rounded-md border border-border bg-background px-3 py-2"
              onSubmitEditing={() => void submitCreate()}
            />
            <View className="flex-row justify-end gap-2">
              <Pressable
                onPress={() => {
                  setCreating(false);
                  setNewName('');
                }}
                className="rounded-md border border-border bg-secondary px-3 py-2"
              >
                <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
                  {tBoard('cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void submitCreate()}
                className="rounded-md bg-cyan px-3 py-2"
              >
                <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-background">
                  {tBoard('createBoard')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
