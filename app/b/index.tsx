import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, LayoutDashboard, Orbit, Plus } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { listTeamBoards, type BoardSummary } from '@/core/api/boards.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * List of kanban + mesh boards in the active team. Mirrors the web /b index
 * — tap a board to open its detail view, where kanban/gantt switching lives.
 */
export default function BoardsIndexScreen() {
  const router = useRouter();
  const t = useTranslations('boardsIndex');
  const { activeTeam } = useAuth();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      setBoards(await listTeamBoards(activeTeam.id));
    } catch {
      setBoards([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const kanban = boards.filter((b) => b.boardType !== 'mesh');
  const mesh = boards.filter((b) => b.boardType === 'mesh');

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4 gap-2">
        <H1>{t('title')}</H1>
        <Body muted>{t('subtitle')}</Body>
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
          <Card>
            <Body muted>{t('empty')}</Body>
          </Card>
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
    </Screen>
  );
}
