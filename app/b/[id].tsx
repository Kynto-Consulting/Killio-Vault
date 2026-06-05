import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
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
import type {
  ArchivedList,
  BoardCard,
  BoardDetail,
  BoardList,
  BoardTag,
} from '@/core/api/boards.client';
import { useBoardsApi } from '@/core/api/boards.dual';
import { listTeamMembers, type TeamMember } from '@/core/api/teams.client';
import { useAuth } from '@/core/auth/AuthContext';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

type CardPriority = 'low' | 'medium' | 'high' | 'urgent';
const PRIORITY_VALUES: CardPriority[] = ['low', 'medium', 'high', 'urgent'];
// Mirrors the dot colours used by KanbanCardRow.
const PRIORITY_COLORS: Record<CardPriority, string> = {
  low: '#94a3b8',
  medium: '#facc15',
  high: '#fb923c',
  urgent: '#ef4444',
};

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
  const { activeTeam } = useAuth();
  // Dual API: cloud vs local. The mode flips to 'local' whenever a local
  // workspace is active in LocalWorkspaceProvider — all calls below stay
  // mode-agnostic.
  const api = useBoardsApi(activeTeam?.id ?? null);
  const isLocal = api.mode === 'local';

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
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedLists, setArchivedLists] = useState<ArchivedList[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);

  const load = useCallback(async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      setBoard(await api.getBoard(boardId));
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [boardId, api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime is cloud-only — local boards live on-device and never emit Pulse
  // events. Pass a null channel name in local mode; the hook short-circuits.
  useRealtimeChannel(!isLocal && boardId ? `board:${boardId}` : null, {
    events: {
      'card.moved': () => void load(),
      'card.created': () => void load(),
      'card.updated': () => void load(),
      'card.assignee_added': () => void load(),
      'card.assignee_removed': () => void load(),
      'card.tag_added': () => void load(),
      'card.tag_removed': () => void load(),
      'list.updated': () => void load(),
      'list.created': () => void load(),
      'list.archived': () => void load(),
      'list.unarchived': () => void load(),
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
      await api.createCard({ listId: activeList.id, title });
      await load();
    } catch {
      /* ignore */
    }
  };

  /**
   * Optimistic in-place patch of a single card across the board state. Mutates
   * `board.lists[*].cards[*]` for the matching card id, and refreshes
   * `selectedCard` so the open detail sheet repaints without a network blink.
   * Used by the per-card pickers (assignee / tag / priority).
   */
  const patchCardLocal = useCallback(
    (cardId: string, mutate: (c: BoardCard) => BoardCard) => {
      setBoard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lists: prev.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => (c.id === cardId ? mutate(c) : c)),
          })),
        };
      });
      setSelectedCard((prev) =>
        prev && prev.card.id === cardId
          ? { card: mutate(prev.card), list: prev.list }
          : prev,
      );
    },
    [],
  );

  const openArchived = useCallback(async () => {
    setArchivedOpen(true);
    setArchivedLoading(true);
    try {
      const data = await api.listArchivedLists(boardId);
      setArchivedLists(data);
    } catch {
      setArchivedLists([]);
    } finally {
      setArchivedLoading(false);
    }
  }, [api, boardId]);

  const restoreList = useCallback(
    async (listId: string) => {
      try {
        await api.archiveList(boardId, listId, false);
        setArchivedLists((prev) => prev.filter((l) => l.id !== listId));
        await load();
      } catch {
        /* ignore */
      }
    },
    [api, boardId, load],
  );

  const moveCard = async (card: BoardCard, toListId: string) => {
    if (!card.listId || card.listId === toListId) return;
    // Optimistic UI: remove from source list, append to destination list bottom.
    const fromListId = card.listId;
    const snapshot = board;
    setBoard((prev) => {
      if (!prev) return prev;
      const updated: BoardDetail = {
        ...prev,
        lists: prev.lists.map((l) => {
          if (l.id === fromListId) {
            return { ...l, cards: l.cards.filter((c) => c.id !== card.id) };
          }
          if (l.id === toListId) {
            const patched: BoardCard = { ...card, listId: toListId };
            return { ...l, cards: [...l.cards, patched] };
          }
          return l;
        }),
      };
      return updated;
    });
    try {
      await api.updateCard(card.id, { listId: toListId });
      await load();
    } catch {
      // Restore previous state on error
      if (snapshot) setBoard(snapshot);
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
        <Pressable
          onPress={openArchived}
          hitSlop={8}
          accessibilityLabel={t('archivedLists')}
          className="rounded-md border border-border bg-card p-1.5"
        >
          <Archive size={13} color={colors.mutedForeground} />
        </Pressable>
        <ViewToggle view={view} onChange={setView} t={t} />
      </View>

      {view === 'kanban' ? (
        <KanbanView
          lists={lists}
          activeList={activeList}
          activeListIdx={activeListIdx}
          setActiveListIdx={setActiveListIdx}
          visibleCards={visibleCards}
          onCardPress={(c) => activeList && setSelectedCard({ card: c, list: activeList })}
          onCardMove={moveCard}
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
            await api.createList(boardId, t('newList'));
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
        boardId={boardId}
        teamId={activeTeam?.id ?? null}
        isLocal={isLocal}
        onClose={() => setSelectedCard(null)}
        onMove={async (toListId) => {
          if (selectedCard) await moveCard(selectedCard.card, toListId);
          setSelectedCard(null);
        }}
        onArchive={async () => {
          if (selectedCard) {
            await api.archiveCard(selectedCard.card.id);
            await load();
            setSelectedCard(null);
          }
        }}
        onPatch={async (patch) => {
          if (!selectedCard) return;
          await api.updateCard(selectedCard.card.id, patch);
          await load();
        }}
        addAssignee={(cardId, userId) => api.addCardAssignee(cardId, userId)}
        removeAssignee={(cardId, userId) => api.removeCardAssignee(cardId, userId)}
        listBoardTags={() => api.listBoardTags(boardId)}
        addTag={(cardId, tagId) => api.addCardTag(cardId, tagId)}
        removeTag={(cardId, tagId) => api.removeCardTag(cardId, tagId)}
        onLocalPatch={patchCardLocal}
        t={t}
      />

      <ArchivedListsModal
        open={archivedOpen}
        loading={archivedLoading}
        lists={archivedLists}
        onClose={() => setArchivedOpen(false)}
        onRestore={restoreList}
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

type ChipRect = { x: number; y: number; w: number; h: number };

function KanbanView({
  lists,
  activeList,
  activeListIdx,
  setActiveListIdx,
  visibleCards,
  onCardPress,
  onCardMove,
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
  activeList: BoardList | null;
  activeListIdx: number;
  setActiveListIdx(i: number): void;
  visibleCards: BoardCard[];
  onCardPress(c: BoardCard): void;
  onCardMove(card: BoardCard, toListId: string): Promise<void>;
  adding: boolean;
  newCardTitle: string;
  setNewCardTitle(v: string): void;
  startAdd(): void;
  cancelAdd(): void;
  submitAdd(): Promise<void>;
  onAddList(): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  // Drag state: which card is being dragged + its starting absolute pos & size.
  const [dragging, setDragging] = useState<{
    card: BoardCard;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);

  // Shared values for the floating clone position (window-absolute coords).
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragScale = useSharedValue(1);

  // Map of list.id -> absolute window rect, populated as chips render & onLayout fires.
  const chipRectsRef = useRef<Record<string, ChipRect>>({});
  // Horizontal scroll position for chips ScrollView (used for auto-scroll near edges).
  const chipsScrollRef = useRef<ScrollView | null>(null);
  const chipsScrollX = useRef(0);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startAutoScroll = useCallback((direction: 1 | -1) => {
    if (autoScrollTimer.current) return;
    autoScrollTimer.current = setInterval(() => {
      const next = Math.max(0, chipsScrollX.current + direction * 16);
      chipsScrollRef.current?.scrollTo({ x: next, animated: false });
    }, 16);
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  // Begin drag (called from card row via runOnJS once long-press fires).
  const beginDrag = useCallback(
    (card: BoardCard, startX: number, startY: number, width: number, height: number) => {
      dragX.value = startX;
      dragY.value = startY;
      dragScale.value = withTiming(1.05, { duration: 120 });
      setDragging({ card, startX, startY, width, height });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    [dragScale, dragX, dragY],
  );

  // Update floating clone position during pan + handle edge auto-scroll.
  const updateDrag = useCallback(
    (absX: number, absY: number, viewportWidth: number) => {
      dragX.value = absX;
      dragY.value = absY;
      // Edge auto-scroll: trigger inside leftmost / rightmost 48px of viewport.
      const edge = 48;
      if (absX < edge) {
        startAutoScroll(-1);
      } else if (absX > viewportWidth - edge) {
        startAutoScroll(1);
      } else {
        stopAutoScroll();
      }
    },
    [dragX, dragY, startAutoScroll, stopAutoScroll],
  );

  // Drop: hit-test against chip rects.
  const endDrag = useCallback(
    (pointerAbsX: number, pointerAbsY: number) => {
      stopAutoScroll();
      const current = dragging;
      if (!current) return;
      let targetListId: string | null = null;
      for (const [listId, rect] of Object.entries(chipRectsRef.current)) {
        if (
          pointerAbsX >= rect.x &&
          pointerAbsX <= rect.x + rect.w &&
          pointerAbsY >= rect.y &&
          pointerAbsY <= rect.y + rect.h
        ) {
          targetListId = listId;
          break;
        }
      }
      if (targetListId && targetListId !== current.card.listId) {
        dragScale.value = withTiming(1, { duration: 120 });
        setDragging(null);
        void onCardMove(current.card, targetListId);
      } else {
        // Animate clone back to origin then drop.
        dragX.value = withSpring(current.startX, { damping: 18, stiffness: 240 });
        dragY.value = withSpring(current.startY, { damping: 18, stiffness: 240 });
        dragScale.value = withTiming(1, { duration: 160 }, (finished) => {
          if (finished) runOnJS(setDragging)(null);
        });
      }
    },
    [dragX, dragY, dragScale, dragging, onCardMove, stopAutoScroll],
  );

  // Cancel without hit-test (gesture failure).
  const cancelDrag = useCallback(() => {
    stopAutoScroll();
    const current = dragging;
    if (!current) {
      setDragging(null);
      return;
    }
    dragX.value = withSpring(current.startX);
    dragY.value = withSpring(current.startY);
    dragScale.value = withTiming(1, { duration: 160 }, (finished) => {
      if (finished) runOnJS(setDragging)(null);
    });
  }, [dragScale, dragX, dragY, dragging, stopAutoScroll]);

  const registerChipRect = useCallback((listId: string, rect: ChipRect) => {
    chipRectsRef.current[listId] = rect;
  }, []);

  // Floating clone animated style.
  const cloneStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: dragX.value,
    top: dragY.value,
    transform: [{ scale: dragScale.value }],
  }));

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
      {/* List chips selector (horizontal scroll) — also acts as drop target row */}
      <ScrollView
        ref={chipsScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-3 py-2 gap-2"
        className="border-b border-border/40"
        scrollEventThrottle={16}
        onScroll={(e) => {
          chipsScrollX.current = e.nativeEvent.contentOffset.x;
        }}
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
          <ChipDropTarget
            key={list.id}
            listId={list.id}
            isActive={i === activeListIdx}
            isDropTarget={!!dragging}
            isSelfList={dragging?.card.listId === list.id}
            onLayoutRect={registerChipRect}
            onPress={() => setActiveListIdx(i)}
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
          </ChipDropTarget>
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
        scrollEnabled={!dragging}
        ListEmptyComponent={
          <Card>
            <Body muted>{t('noCards')}</Body>
          </Card>
        }
        renderItem={({ item }) => (
          <KanbanCardRow
            card={{ ...item, listId: item.listId ?? activeList?.id }}
            onPress={() => onCardPress(item)}
            isBeingDragged={dragging?.card.id === item.id}
            onDragStart={beginDrag}
            onDragUpdate={updateDrag}
            onDragEnd={endDrag}
            onDragCancel={cancelDrag}
          />
        )}
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

      {/* Floating clone overlay shown while dragging */}
      {dragging ? (
        <Animated.View
          pointerEvents="none"
          style={[
            cloneStyle,
            {
              width: dragging.width,
              minHeight: dragging.height,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.35,
              shadowRadius: 12,
              elevation: 12,
              zIndex: 1000,
            },
          ]}
        >
          <View className="rounded-xl border border-cyan/60 bg-card p-3">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-sm text-foreground"
              numberOfLines={2}
            >
              {dragging.card.title}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * List chip rendered as a Pressable that also reports its absolute window rect
 * to the parent so the drag layer can hit-test against it. Highlights with a
 * cyan dashed border whenever a drag is in progress (and the chip is a valid
 * drop target — i.e. not the source list itself).
 */
function ChipDropTarget({
  listId,
  isActive,
  isDropTarget,
  isSelfList,
  onLayoutRect,
  onPress,
  children,
}: {
  listId: string;
  isActive: boolean;
  isDropTarget: boolean;
  isSelfList: boolean;
  onLayoutRect(listId: string, rect: ChipRect): void;
  onPress(): void;
  children: React.ReactNode;
}) {
  const ref = useRef<View | null>(null);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // measureInWindow gives absolute window coords (what gesture.absoluteX/Y use).
    node.measureInWindow((x, y, w, h) => {
      if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
        onLayoutRect(listId, { x, y, w, h });
      }
    });
  }, [listId, onLayoutRect]);

  const handleLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      measure();
    },
    [measure],
  );

  // Re-measure when a drag begins (rects may have shifted via scroll).
  useEffect(() => {
    if (isDropTarget) measure();
  }, [isDropTarget, measure]);

  const borderHighlight = isDropTarget && !isSelfList;

  return (
    <Pressable
      ref={ref as never}
      onPress={onPress}
      onLayout={handleLayout}
      className={`rounded-full px-3 py-1 ${isActive ? 'bg-cyan' : 'bg-secondary'}`}
      style={
        borderHighlight
          ? { borderWidth: 1, borderColor: colors.cyan, borderStyle: 'dashed' }
          : undefined
      }
    >
      {children}
    </Pressable>
  );
}

function KanbanCardRow({
  card,
  onPress,
  isBeingDragged,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onDragCancel,
}: {
  card: BoardCard;
  onPress(): void;
  isBeingDragged: boolean;
  onDragStart(
    card: BoardCard,
    startX: number,
    startY: number,
    width: number,
    height: number,
  ): void;
  onDragUpdate(absX: number, absY: number, viewportWidth: number): void;
  onDragEnd(absX: number, absY: number): void;
  onDragCancel(): void;
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

  const cardRef = useRef<View | null>(null);
  // Snapshot of where the card sat at long-press start (window coords).
  const origin = useRef<{ x: number; y: number; w: number; h: number; vw: number } | null>(
    null,
  );
  // Worklet-side flag: pan only reacts after long-press has armed it.
  const dragActive = useSharedValue(0);

  const handleLongPressActivate = useCallback(() => {
    const node = cardRef.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return;
      const { Dimensions } = require('react-native') as typeof import('react-native');
      const vw = Dimensions.get('window').width;
      origin.current = { x, y, w, h, vw };
      onDragStart(card, x, y, w, h);
    });
  }, [card, onDragStart]);

  const handlePanUpdate = useCallback(
    (translationX: number, translationY: number) => {
      const o = origin.current;
      if (!o) return;
      onDragUpdate(o.x + translationX, o.y + translationY, o.vw);
    },
    [onDragUpdate],
  );

  const handlePanEnd = useCallback(
    (translationX: number, translationY: number) => {
      const o = origin.current;
      origin.current = null;
      if (!o) {
        onDragCancel();
        return;
      }
      // Use the centre of the floating clone for hit-testing against chip rects.
      const pointerX = o.x + translationX + o.w / 2;
      const pointerY = o.y + translationY + o.h / 2;
      onDragEnd(pointerX, pointerY);
    },
    [onDragCancel, onDragEnd],
  );

  const handlePanCancel = useCallback(() => {
    origin.current = null;
    onDragCancel();
  }, [onDragCancel]);

  // Composed gesture: long-press arms the drag, pan handles movement. Short
  // tap is delegated to the inner <Pressable> onPress so opening the detail
  // modal survives untouched.
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(250)
        .maxDistance(8)
        .onStart(() => {
          dragActive.value = 1;
          runOnJS(handleLongPressActivate)();
        }),
    [dragActive, handleLongPressActivate],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onTouchesMove((_e, state) => {
          // Only activate pan after the long-press has armed the drag,
          // otherwise let the touch propagate to the FlatList / Pressable.
          if (dragActive.value === 1) state.activate();
          else state.fail();
        })
        .onUpdate((e) => {
          if (dragActive.value !== 1) return;
          runOnJS(handlePanUpdate)(e.translationX, e.translationY);
        })
        .onEnd((e) => {
          if (dragActive.value !== 1) return;
          runOnJS(handlePanEnd)(e.translationX, e.translationY);
          dragActive.value = 0;
        })
        .onFinalize(() => {
          if (dragActive.value === 1) {
            runOnJS(handlePanCancel)();
            dragActive.value = 0;
          }
        }),
    [dragActive, handlePanCancel, handlePanEnd, handlePanUpdate],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(longPress, pan),
    [longPress, pan],
  );

  return (
    <GestureDetector gesture={composed}>
      <Pressable
        ref={cardRef as never}
        onPress={onPress}
        className="flex-row items-start gap-2 rounded-xl border border-border bg-card p-3"
        style={{ opacity: isBeingDragged ? 0.35 : 1 }}
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
    </GestureDetector>
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
  boardId,
  teamId,
  isLocal,
  onClose,
  onMove,
  onArchive,
  onPatch,
  addAssignee,
  removeAssignee,
  listBoardTags,
  addTag,
  removeTag,
  onLocalPatch,
  t,
}: {
  item: { card: BoardCard; list: BoardList } | null;
  lists: BoardList[];
  boardId: string;
  teamId: string | null;
  isLocal: boolean;
  onClose(): void;
  onMove(toListId: string): Promise<void>;
  onArchive(): Promise<void>;
  onPatch(patch: {
    title?: string;
    summary?: string;
    startAt?: string | null;
    dueAt?: string | null;
    priority?: string;
  }): Promise<void>;
  addAssignee(cardId: string, userId: string): Promise<void>;
  removeAssignee(cardId: string, userId: string): Promise<void>;
  listBoardTags(): Promise<BoardTag[]>;
  addTag(cardId: string, tagId: string): Promise<void>;
  removeTag(cardId: string, tagId: string): Promise<void>;
  onLocalPatch(cardId: string, mutate: (c: BoardCard) => BoardCard): void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [boardTags, setBoardTags] = useState<BoardTag[]>([]);

  useEffect(() => {
    if (item) {
      setTitle(item.card.title);
      setSummary(item.card.summary ?? '');
      setStartAt(item.card.startAt ? item.card.startAt.slice(0, 10) : '');
      setDueAt(item.card.dueAt ? item.card.dueAt.slice(0, 10) : '');
      setMoveOpen(false);
      setAssigneePickerOpen(false);
      setTagPickerOpen(false);
    }
  }, [item]);

  // Load team members + board tags lazily once the sheet is open (per-card).
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    if (isLocal) {
      // Local mode: no team — the only "assignee" is "Me" (stub id).
      setTeamMembers([{ id: 'me', name: t('me') }]);
    } else if (teamId) {
      listTeamMembers(teamId)
        .then((m) => {
          if (!cancelled) setTeamMembers(m);
        })
        .catch(() => {
          if (!cancelled) setTeamMembers([]);
        });
    }
    listBoardTags()
      .then((tags) => {
        if (!cancelled) setBoardTags(tags);
      })
      .catch(() => {
        if (!cancelled) setBoardTags([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.card.id, teamId, isLocal]);

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
          {/* ── Assignees ─────────────────────────────────────────── */}
          <View className="gap-1">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              {t('assigneesLabel')}
            </Text>
            <View className="flex-row flex-wrap items-center gap-1">
              {(item.card.assignees ?? []).length === 0 ? (
                <Text className="text-xs text-muted-foreground">
                  {t('noAssignees')}
                </Text>
              ) : (
                (item.card.assignees ?? []).map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={async () => {
                      const cardId = item.card.id;
                      // Optimistic
                      onLocalPatch(cardId, (c) => ({
                        ...c,
                        assignees: (c.assignees ?? []).filter((x) => x.id !== a.id),
                      }));
                      try {
                        await removeAssignee(cardId, a.id);
                      } catch {
                        /* Pulse refresh will reconcile */
                      }
                    }}
                    className="flex-row items-center gap-1 rounded-full bg-cyan/20 px-2 py-0.5"
                  >
                    <Text
                      style={{ fontFamily: fonts.semibold }}
                      className="text-[10px] text-cyan"
                    >
                      {a.name ?? a.email ?? a.id}
                    </Text>
                    <X size={8} color={colors.cyan} />
                  </Pressable>
                ))
              )}
              <Pressable
                onPress={() => setAssigneePickerOpen((v) => !v)}
                className="rounded-full border border-dashed border-border bg-background px-2 py-0.5"
              >
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[10px] text-cyan"
                >
                  {t('addAssignee')}
                </Text>
              </Pressable>
            </View>
            {assigneePickerOpen ? (
              <View className="mt-1 rounded-xl border border-border bg-background p-2 gap-1">
                {teamMembers.length === 0 ? (
                  <Text className="px-2 py-1 text-xs text-muted-foreground">
                    {t('noAssignees')}
                  </Text>
                ) : (
                  teamMembers.map((m) => {
                    const already = (item.card.assignees ?? []).some(
                      (a) => a.id === m.id,
                    );
                    return (
                      <Pressable
                        key={m.id}
                        disabled={already}
                        onPress={async () => {
                          const cardId = item.card.id;
                          onLocalPatch(cardId, (c) => ({
                            ...c,
                            assignees: [
                              ...(c.assignees ?? []),
                              {
                                id: m.id,
                                name: m.displayName ?? m.name,
                                email: m.email,
                                avatarUrl: m.avatarUrl ?? undefined,
                              },
                            ],
                          }));
                          setAssigneePickerOpen(false);
                          try {
                            await addAssignee(cardId, m.id);
                          } catch {
                            /* Pulse refresh will reconcile */
                          }
                        }}
                        className={`rounded-md px-3 py-2 ${already ? 'bg-cyan/10' : ''}`}
                      >
                        <Text
                          style={{ fontFamily: fonts.medium }}
                          className={`text-sm ${already ? 'text-cyan' : 'text-foreground'}`}
                        >
                          {m.displayName ?? m.name ?? m.email ?? m.id}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            ) : null}
          </View>

          {/* ── Tags ──────────────────────────────────────────────── */}
          <View className="gap-1">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              {t('tagsLabel')}
            </Text>
            <View className="flex-row flex-wrap items-center gap-1">
              {(item.card.tags ?? []).length === 0 ? (
                <Text className="text-xs text-muted-foreground">{t('noTags')}</Text>
              ) : (
                (item.card.tags ?? []).map((tag) => (
                  <Pressable
                    key={tag.id}
                    onPress={async () => {
                      const cardId = item.card.id;
                      onLocalPatch(cardId, (c) => ({
                        ...c,
                        tags: (c.tags ?? []).filter((x) => x.id !== tag.id),
                      }));
                      try {
                        await removeTag(cardId, tag.id);
                      } catch {
                        /* Pulse refresh will reconcile */
                      }
                    }}
                    className="flex-row items-center gap-1 rounded-full px-2 py-0.5"
                    style={{
                      backgroundColor: `${tag.color ?? colors.mutedForeground}22`,
                      borderWidth: 1,
                      borderColor: `${tag.color ?? colors.mutedForeground}55`,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.semibold,
                        color: tag.color ?? colors.mutedForeground,
                      }}
                      className="text-[10px]"
                    >
                      {tag.name}
                    </Text>
                    <X size={8} color={tag.color ?? colors.mutedForeground} />
                  </Pressable>
                ))
              )}
              <Pressable
                onPress={() => setTagPickerOpen((v) => !v)}
                className="rounded-full border border-dashed border-border bg-background px-2 py-0.5"
              >
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[10px] text-cyan"
                >
                  {t('addTag')}
                </Text>
              </Pressable>
            </View>
            {tagPickerOpen ? (
              <View className="mt-1 rounded-xl border border-border bg-background p-2 gap-1">
                {boardTags.length === 0 ? (
                  <Text className="px-2 py-1 text-xs text-muted-foreground">
                    {t('noTags')}
                  </Text>
                ) : (
                  boardTags.map((tag) => {
                    const already = (item.card.tags ?? []).some(
                      (t2) => t2.id === tag.id,
                    );
                    return (
                      <Pressable
                        key={tag.id}
                        disabled={already}
                        onPress={async () => {
                          const cardId = item.card.id;
                          onLocalPatch(cardId, (c) => ({
                            ...c,
                            tags: [
                              ...(c.tags ?? []),
                              {
                                id: tag.id,
                                name: tag.name,
                                color: tag.color,
                                tagKind: tag.tagKind,
                              },
                            ],
                          }));
                          setTagPickerOpen(false);
                          try {
                            await addTag(cardId, tag.id);
                          } catch {
                            /* Pulse refresh will reconcile */
                          }
                        }}
                        className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${
                          already ? 'opacity-50' : ''
                        }`}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: tag.color ?? colors.mutedForeground,
                          }}
                        />
                        <Text
                          style={{ fontFamily: fonts.medium }}
                          className="text-sm text-foreground"
                        >
                          {tag.name}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            ) : null}
          </View>

          {/* ── Priority ──────────────────────────────────────────── */}
          <View className="gap-1">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              {t('priorityLabel')}
            </Text>
            <View className="flex-row gap-1">
              {PRIORITY_VALUES.map((p) => {
                const current = (item.card.priority ?? item.card.urgency) as
                  | CardPriority
                  | undefined;
                const active = current === p;
                const colorHex = PRIORITY_COLORS[p];
                return (
                  <Pressable
                    key={p}
                    onPress={async () => {
                      const cardId = item.card.id;
                      onLocalPatch(cardId, (c) => ({ ...c, priority: p }));
                      try {
                        await onPatch({ priority: p });
                      } catch {
                        /* Pulse refresh will reconcile */
                      }
                    }}
                    className="flex-1 flex-row items-center justify-center gap-1 rounded-md border px-2 py-1.5"
                    style={{
                      backgroundColor: active ? colorHex : 'transparent',
                      borderColor: active ? colorHex : colors.border,
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: active ? '#0a0a0a' : colorHex,
                      }}
                    />
                    <Text
                      style={{ fontFamily: fonts.semibold }}
                      className={`text-[10px] ${active ? 'text-background' : 'text-foreground'}`}
                    >
                      {p === 'low'
                        ? t('priorityLow')
                        : p === 'medium'
                          ? t('priorityMed')
                          : p === 'high'
                            ? t('priorityHigh')
                            : t('priorityUrgent')}
                    </Text>
                  </Pressable>
                );
              })}
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

// ─── Archived lists drawer ───────────────────────────────────────────────────

/**
 * Slide-up modal listing every list that has been archived on this board.
 * Each row has a Restore button that calls `archiveList(boardId, listId, false)`
 * — the board reloads after, and the realtime `list.unarchived` event nudges
 * other clients.
 */
function ArchivedListsModal({
  open,
  loading,
  lists,
  onClose,
  onRestore,
  t,
}: {
  open: boolean;
  loading: boolean;
  lists: ArchivedList[];
  onClose(): void;
  onRestore(listId: string): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!open) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background/80">
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        <View className="rounded-t-2xl border-t border-border bg-card p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-sm text-foreground"
            >
              {t('archivedLists')}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>
          {loading ? (
            <View className="items-center py-6">
              <ActivityIndicator color={colors.cyan} />
            </View>
          ) : lists.length === 0 ? (
            <Text className="py-6 text-center text-xs text-muted-foreground">
              {t('noArchivedLists')}
            </Text>
          ) : (
            <View className="gap-1">
              {lists.map((l) => (
                <View
                  key={l.id}
                  className="flex-row items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                >
                  <Text
                    style={{ fontFamily: fonts.medium }}
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {l.name}
                  </Text>
                  <Pressable
                    onPress={() => void onRestore(l.id)}
                    className="rounded-md bg-cyan px-3 py-1"
                  >
                    <Text
                      style={{ fontFamily: fonts.semibold }}
                      className="text-[10px] text-background"
                    >
                      {t('restore')}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
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
