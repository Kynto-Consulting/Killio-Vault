import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChartGantt,
  Kanban as KanbanIcon,
  Plus,
  X,
} from 'lucide-react-native';

import { Screen, Card, Body } from '@/ui';
import {
  archiveCard,
  archiveList,
  createCard,
  createList,
  getBoard,
  updateCard,
  type BoardCard,
  type BoardDetail,
  type BoardList,
} from '@/core/api/boards.client';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

type ViewMode = 'kanban' | 'gantt';
type GanttMode = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;
const GANTT_COL_WIDTH = 80;

/**
 * Full kanban + gantt board view, 1:1 mobile port of the web /b/[…] page.
 * The view toggle in the header switches between the kanban list-of-lists
 * (horizontal scroll, list chips selector, add card inline) and the gantt
 * chart (day / week / month timeline showing cards as bars between startAt
 * and dueAt). Real-time card/list updates arrive over the Pulse
 * `board:<id>` channel.
 */
export default function BoardDetailScreen() {
  const router = useRouter();
  const t = useTranslations('board');
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const boardId = String(params.id ?? '');

  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('kanban');
  const [ganttMode, setGanttMode] = useState<GanttMode>('week');
  const [ganttOffset, setGanttOffset] = useState(0);
  const [selectedCard, setSelectedCard] = useState<{
    card: BoardCard;
    list: BoardList;
  } | null>(null);
  const [activeListIdx, setActiveListIdx] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');

  const load = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      setBoard(await getBoard(boardId));
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeChannel(boardId ? `board:${boardId}` : null, {
    events: {
      'card.moved': () => void load(),
      'card.created': () => void load(),
      'card.updated': () => void load(),
      'card.assignee_added': () => void load(),
      'card.assignee_removed': () => void load(),
      'list.updated': () => void load(),
      'list.created': () => void load(),
    },
  });

  const lists = board?.lists ?? [];
  const activeList = lists[activeListIdx] ?? null;
  const visibleCards = (activeList?.cards ?? []).filter((c) => !c.archivedAt);

  const addCardHere = async () => {
    if (!newCardTitle.trim() || !activeList) return;
    const title = newCardTitle.trim();
    setNewCardTitle('');
    setAdding(false);
    try {
      await createCard({ listId: activeList.id, title });
      await load();
    } catch {
      /* ignore */
    }
  };

  const moveCard = async (card: BoardCard, toListId: string) => {
    if (!card.listId || card.listId === toListId) return;
    try {
      await updateCard(card.id, { listId: toListId });
      await load();
    } catch {
      /* ignore */
    }
  };

  if (loading && !board) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.cyan} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {/* Header */}
      <View className="flex-row items-center gap-2 border-b border-border/40 px-3 py-3">
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <ArrowLeft size={18} color={colors.foreground} />
        </Pressable>
        <Text
          style={{ fontFamily: fonts.bold }}
          className="flex-1 text-base text-foreground"
          numberOfLines={1}
        >
          {board?.name ?? params.name ?? ''}
        </Text>
        <ViewToggle view={view} onChange={setView} t={t} />
      </View>

      {view === 'kanban' ? (
        <KanbanView
          lists={lists}
          activeListIdx={activeListIdx}
          setActiveListIdx={setActiveListIdx}
          visibleCards={visibleCards}
          onCardPress={(c) => activeList && setSelectedCard({ card: c, list: activeList })}
          adding={adding}
          newCardTitle={newCardTitle}
          setNewCardTitle={setNewCardTitle}
          startAdd={() => setAdding(true)}
          cancelAdd={() => {
            setAdding(false);
            setNewCardTitle('');
          }}
          submitAdd={addCardHere}
          onAddList={async () => {
            await createList(boardId, t('newList'));
            await load();
          }}
          t={t}
        />
      ) : (
        <GanttView
          lists={lists}
          mode={ganttMode}
          setMode={setGanttMode}
          offset={ganttOffset}
          setOffset={setGanttOffset}
          onCardPress={(card, list) => setSelectedCard({ card, list })}
          t={t}
        />
      )}

      <CardDetailModal
        item={selectedCard}
        lists={lists}
        onClose={() => setSelectedCard(null)}
        onMove={async (toListId) => {
          if (selectedCard) await moveCard(selectedCard.card, toListId);
          setSelectedCard(null);
        }}
        onArchive={async () => {
          if (selectedCard) {
            await archiveCard(selectedCard.card.id);
            await load();
            setSelectedCard(null);
          }
        }}
        onPatch={async (patch) => {
          if (!selectedCard) return;
          await updateCard(selectedCard.card.id, patch);
          await load();
        }}
        t={t}
      />
    </Screen>
  );
}

// ─── View toggle ─────────────────────────────────────────────────────────────

function ViewToggle({
  view,
  onChange,
  t,
}: {
  view: ViewMode;
  onChange(next: ViewMode): void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <View className="flex-row rounded-md border border-border bg-card p-0.5">
      <Pressable
        onPress={() => onChange('kanban')}
        className={`flex-row items-center gap-1 rounded-md px-2 py-1 ${view === 'kanban' ? 'bg-secondary' : ''}`}
      >
        <KanbanIcon size={11} color={view === 'kanban' ? colors.foreground : colors.mutedForeground} />
        <Text
          style={{ fontFamily: fonts.semibold }}
          className={`text-[10px] ${view === 'kanban' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {t('viewKanban')}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('gantt')}
        className={`flex-row items-center gap-1 rounded-md px-2 py-1 ${view === 'gantt' ? 'bg-secondary' : ''}`}
      >
        <ChartGantt size={11} color={view === 'gantt' ? colors.foreground : colors.mutedForeground} />
        <Text
          style={{ fontFamily: fonts.semibold }}
          className={`text-[10px] ${view === 'gantt' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {t('viewGantt')}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Kanban ──────────────────────────────────────────────────────────────────

function KanbanView({
  lists,
  activeListIdx,
  setActiveListIdx,
  visibleCards,
  onCardPress,
  adding,
  newCardTitle,
  setNewCardTitle,
  startAdd,
  cancelAdd,
  submitAdd,
  onAddList,
  t,
}: {
  lists: BoardList[];
  activeListIdx: number;
  setActiveListIdx(i: number): void;
  visibleCards: BoardCard[];
  onCardPress(c: BoardCard): void;
  adding: boolean;
  newCardTitle: string;
  setNewCardTitle(v: string): void;
  startAdd(): void;
  cancelAdd(): void;
  submitAdd(): Promise<void>;
  onAddList(): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  if (lists.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Body muted>{t('noLists')}</Body>
        <Pressable
          onPress={onAddList}
          className="flex-row items-center gap-2 rounded-md bg-primary px-4 py-2"
        >
          <Plus size={13} color={colors.primaryForeground ?? '#171717'} />
          <Text
            style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
            className="text-xs"
          >
            {t('addList')}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {/* List chips selector (horizontal scroll) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-3 py-2 gap-2"
        className="border-b border-border/40"
      >
        <Pressable
          onPress={() => setActiveListIdx(Math.max(0, activeListIdx - 1))}
          disabled={activeListIdx === 0}
          className="rounded-md p-1"
          style={{ opacity: activeListIdx === 0 ? 0.3 : 1 }}
        >
          <ChevronLeft size={13} color={colors.foreground} />
        </Pressable>
        {lists.map((list, i) => (
          <Pressable
            key={list.id}
            onPress={() => setActiveListIdx(i)}
            className={`rounded-full px-3 py-1 ${
              i === activeListIdx ? 'bg-cyan' : 'bg-secondary'
            }`}
          >
            <Text
              style={{ fontFamily: fonts.semibold }}
              className={`text-[11px] ${i === activeListIdx ? 'text-background' : 'text-foreground'}`}
            >
              {list.name}
              <Text style={{ opacity: 0.6 }}>
                {' '}{list.cards.filter((c) => !c.archivedAt).length}
              </Text>
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setActiveListIdx(Math.min(lists.length - 1, activeListIdx + 1))}
          disabled={activeListIdx === lists.length - 1}
          className="rounded-md p-1"
          style={{ opacity: activeListIdx === lists.length - 1 ? 0.3 : 1 }}
        >
          <ChevronRight size={13} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={onAddList}
          className="flex-row items-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-1"
        >
          <Plus size={10} color={colors.cyan} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
            {t('addList')}
          </Text>
        </Pressable>
      </ScrollView>

      <FlatList
        style={{ flex: 1 }}
        contentContainerClassName="px-3 py-3 gap-2"
        data={visibleCards}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={
          <Card>
            <Body muted>{t('noCards')}</Body>
          </Card>
        }
        renderItem={({ item }) => <KanbanCardRow card={item} onPress={() => onCardPress(item)} />}
        ListFooterComponent={
          adding ? (
            <View className="mt-2 gap-2 rounded-xl border border-cyan/40 bg-card p-3">
              <TextInput
                value={newCardTitle}
                onChangeText={setNewCardTitle}
                placeholder={t('newCardTitle')}
                placeholderTextColor={colors.mutedForeground}
                autoFocus
                style={{ fontFamily: fonts.regular, color: colors.foreground }}
                onSubmitEditing={() => void submitAdd()}
              />
              <View className="flex-row justify-end gap-2">
                <Pressable
                  onPress={cancelAdd}
                  className="rounded-md border border-border bg-secondary px-3 py-1"
                >
                  <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
                    {t('cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void submitAdd()}
                  className="rounded-md bg-cyan px-3 py-1"
                >
                  <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-background">
                    {t('add')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={startAdd}
              className="mt-2 flex-row items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/40 py-2"
            >
              <Plus size={12} color={colors.cyan} />
              <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-cyan">
                {t('addCard')}
              </Text>
            </Pressable>
          )
        }
      />
    </View>
  );
}

function KanbanCardRow({
  card,
  onPress,
}: {
  card: BoardCard;
  onPress(): void;
}) {
  const priority = card.priority ?? card.urgency;
  const priorityColor =
    priority === 'urgent'
      ? '#ef4444'
      : priority === 'high'
        ? '#fb923c'
        : priority === 'medium'
          ? '#facc15'
          : colors.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-start gap-2 rounded-xl border border-border bg-card p-3"
    >
      <View
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: priorityColor, marginTop: 6 }}
      />
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-sm text-foreground"
          numberOfLines={2}
        >
          {card.title}
        </Text>
        {card.tags && card.tags.length > 0 ? (
          <View className="mt-1 flex-row flex-wrap gap-1">
            {card.tags.slice(0, 3).map((tag) => (
              <View
                key={tag.id}
                className="rounded-full px-2 py-0.5"
                style={{
                  backgroundColor: `${tag.color ?? colors.mutedForeground}22`,
                  borderWidth: 1,
                  borderColor: `${tag.color ?? colors.mutedForeground}55`,
                }}
              >
                <Text
                  style={{ fontFamily: fonts.semibold, color: tag.color ?? colors.mutedForeground }}
                  className="text-[9px]"
                >
                  {tag.name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {card.dueAt ? (
          <View className="mt-1 flex-row items-center gap-1">
            <CalendarDays size={9} color={colors.mutedForeground} />
            <Text className="text-[10px] text-muted-foreground">
              {new Date(card.dueAt).toLocaleDateString()}
            </Text>
          </View>
        ) : null}
        {card.assignees && card.assignees.length > 0 ? (
          <View className="mt-1 flex-row items-center gap-1">
            {card.assignees.slice(0, 3).map((a) => (
              <View
                key={a.id}
                className="h-5 w-5 items-center justify-center rounded-full bg-cyan/20"
              >
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[8px] text-cyan"
                >
                  {(a.name ?? a.email ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Gantt ───────────────────────────────────────────────────────────────────

function GanttView({
  lists,
  mode,
  setMode,
  offset,
  setOffset,
  onCardPress,
  t,
}: {
  lists: BoardList[];
  mode: GanttMode;
  setMode(next: GanttMode): void;
  offset: number;
  setOffset(next: number): void;
  onCardPress(card: BoardCard, list: BoardList): void;
  t: ReturnType<typeof useTranslations>;
}) {
  const daysCount = mode === 'day' ? 1 : mode === 'week' ? 7 : 30;
  const offsetMultiplier = mode === 'day' ? 1 : mode === 'week' ? 7 : 30;

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date());
    return new Date(base.getTime() + offset * offsetMultiplier * DAY_MS);
  }, [offset, offsetMultiplier]);
  const weekEndExclusive = useMemo(
    () => new Date(weekStart.getTime() + daysCount * DAY_MS),
    [weekStart, daysCount],
  );
  const weekStartMs = weekStart.getTime();
  const weekDurationMs = weekEndExclusive.getTime() - weekStartMs;

  const days = useMemo(
    () =>
      Array.from({ length: daysCount }, (_, i) => new Date(weekStartMs + i * DAY_MS)),
    [weekStartMs, daysCount],
  );

  const visibleLists = lists.filter((l) => !l.archivedAt);

  return (
    <View style={{ flex: 1 }}>
      {/* Header bar */}
      <View className="flex-row items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
          {ganttLabel(weekStart, weekEndExclusive, mode)}
        </Text>
        <View className="flex-row items-center gap-1">
          {(['day', 'week', 'month'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                setMode(m);
                setOffset(0);
              }}
              className={`rounded-md px-2 py-1 ${mode === m ? 'bg-secondary' : ''}`}
            >
              <Text
                style={{ fontFamily: fonts.semibold }}
                className={`text-[10px] ${mode === m ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {t(`gantt.${m}` as any)}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setOffset(offset - 1)}
            className="rounded-md border border-border bg-background p-1"
          >
            <ChevronLeft size={11} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={() => setOffset(0)}
            className="rounded-md bg-cyan px-2 py-1"
          >
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-[10px] text-background"
            >
              {t('gantt.thisWeek')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setOffset(offset + 1)}
            className="rounded-md border border-border bg-background p-1"
          >
            <ChevronRight size={11} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal>
        <View>
          {/* Day headers */}
          <View
            style={{
              flexDirection: 'row',
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.muted,
            }}
          >
            <View
              style={{
                width: 140,
                paddingHorizontal: 8,
                paddingVertical: 6,
                borderRightWidth: 1,
                borderRightColor: colors.border,
              }}
            >
              <Text
                style={{ fontFamily: fonts.semibold, color: colors.mutedForeground }}
                className="text-[9px] uppercase tracking-widest"
              >
                {t('gantt.lists')}
              </Text>
            </View>
            {days.map((day, i) => (
              <View
                key={i}
                style={{
                  width: GANTT_COL_WIDTH,
                  paddingHorizontal: 6,
                  paddingVertical: 6,
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.foreground }}>
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text style={{ fontSize: 9, color: colors.mutedForeground }}>
                  {day.getDate()}/{day.getMonth() + 1}
                </Text>
              </View>
            ))}
          </View>

          {/* Rows */}
          <ScrollView style={{ maxHeight: 500 }}>
            {visibleLists.map((list) => {
              const cards = (list.cards ?? []).filter(
                (c) => !c.archivedAt && (c.startAt || c.dueAt),
              );
              return (
                <View
                  key={list.id}
                  style={{
                    flexDirection: 'row',
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 140,
                      paddingHorizontal: 8,
                      paddingVertical: 8,
                      borderRightWidth: 1,
                      borderRightColor: colors.border,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <Text
                      style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.foreground }}
                      numberOfLines={1}
                    >
                      {list.name}
                    </Text>
                    <Text
                      style={{ fontSize: 9, color: colors.mutedForeground }}
                    >
                      {t('gantt.cardsInList', { count: list.cards?.length ?? 0 })}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      flex: 1,
                      position: 'relative',
                      minHeight: 48,
                    }}
                  >
                    {/* Day grid lines */}
                    {days.map((_, i) => (
                      <View
                        key={i}
                        style={{
                          width: GANTT_COL_WIDTH,
                          borderRightWidth: 1,
                          borderRightColor: colors.border,
                        }}
                      />
                    ))}
                    {/* Card bars */}
                    {cards.map((card, ci) => {
                      const startMs = parseDate(card.startAt ?? card.dueAt);
                      const endMs = parseDate(card.dueAt ?? card.startAt);
                      if (!startMs || !endMs) return null;
                      const clampedStart = Math.max(startMs, weekStartMs);
                      const clampedEnd = Math.min(endMs + DAY_MS, weekStartMs + weekDurationMs);
                      if (clampedEnd <= weekStartMs || clampedStart >= weekStartMs + weekDurationMs)
                        return null;
                      const leftPct = ((clampedStart - weekStartMs) / weekDurationMs) * 100;
                      const widthPct = ((clampedEnd - clampedStart) / weekDurationMs) * 100;
                      const top = 6 + (ci % 3) * 18;
                      return (
                        <Pressable
                          key={card.id}
                          onPress={() => onCardPress(card, list)}
                          style={{
                            position: 'absolute',
                            left: `${leftPct}%`,
                            top,
                            width: `${widthPct}%`,
                            height: 14,
                            backgroundColor: colors.cyan + '55',
                            borderColor: colors.cyan,
                            borderWidth: 1,
                            borderRadius: 4,
                            paddingHorizontal: 4,
                            justifyContent: 'center',
                          }}
                        >
                          <Text
                            style={{ fontFamily: fonts.semibold, fontSize: 9, color: colors.foreground }}
                            numberOfLines={1}
                          >
                            {card.title}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Card detail modal ──────────────────────────────────────────────────────

function CardDetailModal({
  item,
  lists,
  onClose,
  onMove,
  onArchive,
  onPatch,
  t,
}: {
  item: { card: BoardCard; list: BoardList } | null;
  lists: BoardList[];
  onClose(): void;
  onMove(toListId: string): Promise<void>;
  onArchive(): Promise<void>;
  onPatch(patch: { title?: string; summary?: string; startAt?: string; dueAt?: string }): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);

  useEffect(() => {
    if (item) {
      setTitle(item.card.title);
      setSummary(item.card.summary ?? '');
      setStartAt(item.card.startAt ? item.card.startAt.slice(0, 10) : '');
      setDueAt(item.card.dueAt ? item.card.dueAt.slice(0, 10) : '');
      setMoveOpen(false);
    }
  }, [item]);

  if (!item) return null;

  const commit = async () => {
    const patch: any = {};
    if (title.trim() && title !== item.card.title) patch.title = title.trim();
    if (summary !== (item.card.summary ?? '')) patch.summary = summary;
    if (startAt !== (item.card.startAt?.slice(0, 10) ?? ''))
      patch.startAt = startAt ? new Date(startAt).toISOString() : null;
    if (dueAt !== (item.card.dueAt?.slice(0, 10) ?? ''))
      patch.dueAt = dueAt ? new Date(dueAt).toISOString() : null;
    if (Object.keys(patch).length > 0) await onPatch(patch);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background/80">
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        <View className="rounded-t-2xl border-t border-border bg-card p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              {item.list.name}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>
          <TextInput
            value={title}
            onChangeText={setTitle}
            onBlur={commit}
            style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.foreground, padding: 0 }}
          />
          <TextInput
            value={summary}
            onChangeText={setSummary}
            onBlur={commit}
            placeholder={t('cardSummaryPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={{ fontFamily: fonts.regular, color: colors.foreground, padding: 0, minHeight: 60 }}
          />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {t('startAt')}
              </Text>
              <TextInput
                value={startAt}
                onChangeText={setStartAt}
                onBlur={commit}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                style={{ fontFamily: fonts.mono, color: colors.foreground }}
                className="rounded-md border border-border bg-background px-2 py-1.5"
              />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {t('dueAt')}
              </Text>
              <TextInput
                value={dueAt}
                onChangeText={setDueAt}
                onBlur={commit}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                style={{ fontFamily: fonts.mono, color: colors.foreground }}
                className="rounded-md border border-border bg-background px-2 py-1.5"
              />
            </View>
          </View>
          <View className="flex-row gap-2 mt-2">
            <Pressable
              onPress={() => setMoveOpen((v) => !v)}
              className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-3 py-2"
            >
              <ArrowRight size={12} color={colors.foreground} />
              <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
                {t('move')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void onArchive()}
              className="flex-row items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
            >
              <Archive size={12} color={colors.destructive} />
              <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-destructive">
                {t('archive')}
              </Text>
            </Pressable>
          </View>
          {moveOpen ? (
            <View className="rounded-xl border border-border bg-background p-2 gap-1">
              {lists.map((list) => (
                <Pressable
                  key={list.id}
                  onPress={() => void onMove(list.id)}
                  disabled={list.id === item.list.id}
                  className={`rounded-md px-3 py-2 ${list.id === item.list.id ? 'bg-cyan/10' : ''}`}
                >
                  <Text
                    style={{ fontFamily: fonts.medium }}
                    className={`text-sm ${list.id === item.list.id ? 'text-cyan' : 'text-foreground'}`}
                  >
                    {list.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function ganttLabel(start: Date, endExclusive: Date, mode: GanttMode): string {
  if (mode === 'day') return start.toLocaleDateString();
  const lastDay = new Date(endExclusive.getTime() - DAY_MS);
  return `${start.toLocaleDateString()} — ${lastDay.toLocaleDateString()}`;
}
