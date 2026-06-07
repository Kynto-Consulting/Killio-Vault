import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import Svg, { Line as SvgLine } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChartGantt,
  Eye,
  EyeOff,
  Filter as FilterIcon,
  Image as ImageIcon,
  Kanban as KanbanIcon,
  ListChecks,
  Palette,
  Play,
  Plus,
  Square,
  Tag as TagIcon,
  ArrowUpDown,
  Timer as TimerIcon,
  Trash2,
  Users,
  X,
} from 'lucide-react-native';

import { uploadFile } from '@/core/api/uploads.client';
import { UnifiedChecklistBrick } from '@/ui/bricks/unified-checklist-brick';
import { useI18n } from '@/i18n';
import { translateNativeTagName, DEFAULT_NATIVE_TAG_SUGGESTIONS } from '@/lib/native-tags';
import { resolveAvatarUrl, avatarInitial } from '@/lib/avatar';

import { Screen, Card, Body } from '@/ui';
import { CardSidebar, type CardSidebarTab } from '@/documents/CardSidebar';
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

type ViewMode = 'kanban' | 'gantt';
type GanttMode = 'hour' | 'day' | 'week' | 'month' | 'quarter';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Predefined tints used by the list color picker (mirrors the web swatches).
const LIST_COLOR_SWATCHES: Array<string | null> = [
  null,
  '#67e8f9',
  '#86efac',
  '#fcd34d',
  '#fb923c',
  '#f472b6',
  '#a78bfa',
  '#94a3b8',
];

type CardFilters = {
  assigneeIds: string[];
  tagIds: string[];
  dueSoon: boolean;
};

type CardSort = 'manual' | 'dueAt' | 'createdAt';

const DUE_SOON_MS = 3 * DAY_MS;

/**
 * Lightweight error boundary so a render-time throw inside the board body
 * shows a retry affordance instead of unmounting to a blank screen (which in
 * a release build looks like the navigation "did nothing"). `resetKey` lets a
 * parent force a remount of the children after the user taps Retry — we bump
 * it via a small wrapper state below.
 */
class BoardErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void; retryLabel: string; message: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // Surface in dev / device logs; release builds otherwise swallow this.
    console.error('[BoardDetailScreen] render error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <Screen>
          <View className="flex-1 items-center justify-center gap-3 px-6">
            <Body muted>{this.props.message}</Body>
            <Pressable
              onPress={() => {
                this.setState({ hasError: false });
                this.props.onRetry();
              }}
              className="rounded-md bg-cyan px-4 py-2"
            >
              <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-background">
                {this.props.retryLabel}
              </Text>
            </Pressable>
          </View>
        </Screen>
      );
    }
    return this.props.children;
  }
}

/**
 * Route entry for `/b/[id]`. Wraps the real screen body in an error boundary
 * so a hook/gesture/render throw degrades to a retry button rather than a
 * blank navigation.
 *
 * Mount path (first paint, before `board` loads):
 *   1. params parse → boardId = String(params.id ?? '')  (empty string if missing — never throws)
 *   2. useBoardsApi(activeTeam?.id ?? null) → memoised, never throws on construction
 *   3. board === null, loading === true  →  early-return ActivityIndicator
 *   4. useRealtimeChannel(... | null)  →  short-circuits in local mode / empty id
 *   5. load() runs in an effect; getBoard errors are caught → board stays null,
 *      loading flips false → main render runs with board=null (lists default to [])
 * Nothing dereferences board/lists/cards without a `?.`/`?? []` guard, so the
 * first paint is crash-safe.
 */
export default function BoardDetailScreen() {
  const t = useTranslations('board');
  const [boundaryKey, setBoundaryKey] = useState(0);
  return (
    <BoardErrorBoundary
      key={boundaryKey}
      onRetry={() => setBoundaryKey((k) => k + 1)}
      retryLabel={t('retry')}
      message={t('loadError')}
    >
      <BoardDetailScreenInner />
    </BoardErrorBoundary>
  );
}

/**
 * Full kanban + gantt board view, 1:1 mobile port of the web /b/[…] page.
 * The view toggle in the header switches between the kanban list-of-lists
 * (horizontal scroll, list chips selector, add card inline) and the gantt
 * chart (day / week / month timeline showing cards as bars between startAt
 * and dueAt). Real-time card/list updates arrive over the Pulse
 * `board:<id>` channel.
 */
function BoardDetailScreenInner() {
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

  // Filters + sort. Persist in component state only — cheap to recompute each
  // render and avoids stale persistence bugs across boards.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<CardFilters>({
    assigneeIds: [],
    tagIds: [],
    dueSoon: false,
  });
  const [sort, setSort] = useState<CardSort>('manual');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // Gantt-only: which lists are visible (defaults to all when null).
  const [ganttListFilter, setGanttListFilter] = useState<Set<string> | null>(null);

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

  // Apply filters + sort to the active list's cards.
  const visibleCards = useMemo(() => {
    let cards = (activeList?.cards ?? []).filter((c) => !c.archivedAt);
    if (filters.assigneeIds.length > 0) {
      cards = cards.filter((c) =>
        (c.assignees ?? []).some((a) => filters.assigneeIds.includes(a.id)),
      );
    }
    if (filters.tagIds.length > 0) {
      cards = cards.filter((c) =>
        (c.tags ?? []).some((tag) => filters.tagIds.includes(tag.id)),
      );
    }
    if (filters.dueSoon) {
      const cutoff = Date.now() + DUE_SOON_MS;
      cards = cards.filter((c) => {
        if (!c.dueAt) return false;
        const t = Date.parse(c.dueAt);
        return Number.isFinite(t) && t <= cutoff;
      });
    }
    if (sort !== 'manual') {
      const sorted = [...cards];
      sorted.sort((a, b) => {
        if (sort === 'dueAt') {
          const ta = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
          const tb = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
          return ta - tb;
        }
        // createdAt fallback uses position descending (newest first) since
        // BoardCard has no createdAt.
        return (b.position ?? 0) - (a.position ?? 0);
      });
      cards = sorted;
    }
    return cards;
  }, [activeList?.cards, filters, sort]);

  const filtersActive =
    filters.assigneeIds.length +
      filters.tagIds.length +
      (filters.dueSoon ? 1 : 0) >
    0;

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
   * Used by the per-card pickers (assignee / tag / dates).
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

  // Web parity: persist list re-order after a long-press drag finishes.
  // Mobile: also patches local board state for an immediate visual update.
  const reorderListsLocal = useCallback(
    async (orderedListIds: string[]) => {
      setBoard((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.lists.map((l) => [l.id, l] as const));
        const next: BoardList[] = [];
        for (const id of orderedListIds) {
          const l = byId.get(id);
          if (l) next.push(l);
        }
        // Append any list not present in orderedListIds (defensive).
        for (const l of prev.lists) {
          if (!orderedListIds.includes(l.id)) next.push(l);
        }
        return { ...prev, lists: next };
      });
      try {
        await api.reorderLists(boardId, orderedListIds);
      } catch {
        // Mobile: silently swallow — Pulse refresh (or next load) reconciles.
      }
    },
    [api, boardId],
  );

  const setListColorLocal = useCallback(
    async (listId: string, color: string | null) => {
      setBoard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lists: prev.lists.map((l) => (l.id === listId ? { ...l, color } : l)),
        };
      });
      try {
        await api.setListColor(boardId, listId, color);
      } catch {
        /* ignore */
      }
    },
    [api, boardId],
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
          onPress={() => setFiltersOpen(true)}
          hitSlop={8}
          accessibilityLabel={t('filters')}
          className="rounded-md border border-border bg-card p-1.5"
          style={
            filtersActive
              ? { borderColor: colors.cyan, backgroundColor: `${colors.cyan}22` }
              : undefined
          }
        >
          <FilterIcon size={13} color={filtersActive ? colors.cyan : colors.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => setSortMenuOpen((v) => !v)}
          hitSlop={8}
          accessibilityLabel={t('sort')}
          className="rounded-md border border-border bg-card p-1.5"
          style={
            sort !== 'manual'
              ? { borderColor: colors.cyan, backgroundColor: `${colors.cyan}22` }
              : undefined
          }
        >
          <ArrowUpDown size={13} color={sort !== 'manual' ? colors.cyan : colors.mutedForeground} />
        </Pressable>
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

      {sortMenuOpen ? (
        <View className="border-b border-border/40 bg-card px-3 py-2 flex-row gap-1">
          {(['manual', 'dueAt', 'createdAt'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                setSort(s);
                setSortMenuOpen(false);
              }}
              className={`rounded-md px-2 py-1 ${sort === s ? 'bg-cyan' : 'bg-secondary'}`}
            >
              <Text
                style={{ fontFamily: fonts.semibold }}
                className={`text-[10px] ${sort === s ? 'text-background' : 'text-foreground'}`}
              >
                {t(`sortBy.${s}` as any)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

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
          onReorderLists={reorderListsLocal}
          onSetListColor={setListColorLocal}
          t={t}
        />
      ) : (
        <GanttView
          lists={lists}
          listFilter={ganttListFilter}
          setListFilter={setGanttListFilter}
          mode={ganttMode}
          setMode={setGanttMode}
          offset={ganttOffset}
          setOffset={setGanttOffset}
          onCardPress={(card, list) => setSelectedCard({ card, list })}
          onPatchCard={(cardId, patch) => api.updateCard(cardId, patch)}
          onLocalPatch={patchCardLocal}
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
        addTag={(cardId, tagId, meta) => api.addCardTag(cardId, tagId, meta)}
        removeTag={(cardId, tagId) => api.removeCardTag(cardId, tagId)}
        createTag={(name, color) =>
          api.createTag({ boardId, name, color, tagKind: 'custom' })
        }
        startTimer={(cardId) => api.startCardTimer(cardId)}
        stopTimer={(cardId) => api.stopCardTimer(cardId)}
        onLocalPatch={patchCardLocal}
        t={t}
      />

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        setFilters={setFilters}
        teamId={activeTeam?.id ?? null}
        isLocal={isLocal}
        listBoardTags={() => api.listBoardTags(boardId)}
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

// Stable extractor for KanbanCardRow rows — referenced by FlatList. Defined
// outside the component so identity doesn't churn each render.
const renderKanbanKeyExtractor = (c: BoardCard) => c.id;

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
  onReorderLists,
  onSetListColor,
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
  onReorderLists(orderedListIds: string[]): Promise<void>;
  onSetListColor(listId: string, color: string | null): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  // Color-picker visibility per list (tap header → show swatch row).
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
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
        contentContainerClassName="px-3 py-2 gap-2 items-center"
        className="border-b border-border/40"
        // Mobile: a horizontal ScrollView placed as a flex child of a column
        // stretches to fill the column's height by default — that's what made
        // the list-title header swallow ~70% of the screen and squash the
        // cards FlatList. flexGrow:0 + flexShrink:0 pins it to its intrinsic
        // (single-row chip) height so the FlatList below keeps the rest.
        style={{ flexGrow: 0, flexShrink: 0 }}
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
            color={list.color ?? null}
            onLayoutRect={registerChipRect}
            onPress={() => setActiveListIdx(i)}
            // Mobile: long-press the chip to open the color picker. The
            // (rarely used) reorder-via-drag is exposed via the small left/
            // right swap buttons next to the picker.
            onLongPress={() => setColorPickerFor(list.id)}
          >
            {list.color ? (
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: list.color,
                }}
              />
            ) : null}
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

      {colorPickerFor ? (
        <View className="flex-row items-center gap-2 border-b border-border/40 bg-card px-3 py-2">
          <Palette size={12} color={colors.mutedForeground} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-muted-foreground">
            {t('listColor')}
          </Text>
          {LIST_COLOR_SWATCHES.map((swatch, i) => (
            <Pressable
              key={i}
              onPress={() => {
                void onSetListColor(colorPickerFor, swatch);
                setColorPickerFor(null);
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: swatch ?? 'transparent',
                borderWidth: 1,
                borderColor: swatch ? swatch : colors.border,
              }}
              accessibilityLabel={swatch ?? t('clear')}
            >
              {!swatch ? (
                <X size={10} color={colors.mutedForeground} style={{ margin: 'auto' }} />
              ) : null}
            </Pressable>
          ))}
          {/* Quick list reorder: swap left/right of the active list. Full
              drag-to-reorder is left as a future enhancement; the swap pair
              covers the 80% case. */}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              const idx = lists.findIndex((l) => l.id === colorPickerFor);
              if (idx <= 0) return;
              const ids = lists.map((l) => l.id);
              [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
              void onReorderLists(ids);
            }}
            hitSlop={6}
            accessibilityLabel={t('moveListLeft')}
          >
            <ChevronLeft size={14} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={() => {
              const idx = lists.findIndex((l) => l.id === colorPickerFor);
              if (idx < 0 || idx >= lists.length - 1) return;
              const ids = lists.map((l) => l.id);
              [ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]];
              void onReorderLists(ids);
            }}
            hitSlop={6}
            accessibilityLabel={t('moveListRight')}
          >
            <ChevronRight size={14} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={() => setColorPickerFor(null)} hitSlop={6}>
            <X size={12} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      <FlatList
        style={{ flex: 1 }}
        contentContainerClassName="px-3 py-3 gap-2"
        data={visibleCards}
        keyExtractor={renderKanbanKeyExtractor}
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
  color,
  onLayoutRect,
  onPress,
  onLongPress,
  children,
}: {
  listId: string;
  isActive: boolean;
  isDropTarget: boolean;
  isSelfList: boolean;
  color?: string | null;
  onLayoutRect(listId: string, rect: ChipRect): void;
  onPress(): void;
  onLongPress?(): void;
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
      onLongPress={onLongPress}
      onLayout={handleLayout}
      className={`flex-row items-center gap-1 rounded-full px-3 py-1 ${isActive ? 'bg-cyan' : 'bg-secondary'}`}
      style={[
        // List tint: faint left border when set + slight bg blend.
        color
          ? {
              borderLeftWidth: 3,
              borderLeftColor: color,
              backgroundColor: isActive ? colors.cyan : `${color}22`,
            }
          : undefined,
        borderHighlight
          ? { borderWidth: 1, borderColor: colors.cyan, borderStyle: 'dashed' }
          : undefined,
      ]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Assignee avatar with web-parity URL resolution. Renders the profile picture
 * when available (relative `/uploads/…` paths are prefixed with the API base —
 * see {@link resolveAvatarUrl}); otherwise falls back to the name/email initial
 * on a cyan circle. `size` is the diameter in px.
 */
function AssigneeAvatar({
  assignee,
  size = 20,
}: {
  assignee: { id: string; name?: string; email?: string; avatarUrl?: string };
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const uri = resolveAvatarUrl(assignee.avatarUrl);
  const radius = size / 2;
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: `${colors.cyan}33` }}
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: radius }}
      className="items-center justify-center rounded-full bg-cyan/20"
    >
      <Text
        style={{ fontFamily: fonts.semibold, fontSize: Math.max(8, Math.round(size * 0.4)) }}
        className="text-cyan"
      >
        {avatarInitial(assignee.name, assignee.email)}
      </Text>
    </View>
  );
}

/**
 * Memoised so unrelated card updates don't re-render every row in the list —
 * a noticeable win on boards with 30+ cards in a single list. Identity of
 * onPress / onDrag* is provided by the parent via useCallback.
 */
const KanbanCardRow = memo(function KanbanCardRow({
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
  const { locale } = useI18n();
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
        accessibilityLabel={card.title}
        className="overflow-hidden rounded-xl border border-border bg-card"
        style={{ opacity: isBeingDragged ? 0.35 : 1 }}
      >
        {/* Cover image thumbnail (web parity). Stretches across the top edge. */}
        {card.coverUrl ? (
          <Image
            source={{ uri: card.coverUrl }}
            style={{ width: '100%', height: 80 }}
            resizeMode="cover"
          />
        ) : null}
        <View className="flex-row items-start gap-2 p-3">
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
                    {translateNativeTagName(tag.name, locale)}
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
                <AssigneeAvatar key={a.id} assignee={a} size={20} />
              ))}
            </View>
          ) : null}
        </View>
        </View>
      </Pressable>
    </GestureDetector>
  );
});

// ─── Gantt ───────────────────────────────────────────────────────────────────

function GanttView({
  lists,
  listFilter,
  setListFilter,
  mode,
  setMode,
  offset,
  setOffset,
  onCardPress,
  onPatchCard,
  onLocalPatch,
  t,
}: {
  lists: BoardList[];
  listFilter: Set<string> | null;
  setListFilter(next: Set<string> | null): void;
  mode: GanttMode;
  setMode(next: GanttMode): void;
  offset: number;
  setOffset(next: number): void;
  onCardPress(card: BoardCard, list: BoardList): void;
  onPatchCard(cardId: string, patch: { startAt?: string | null; dueAt?: string | null }): Promise<unknown>;
  onLocalPatch(cardId: string, mutate: (c: BoardCard) => BoardCard): void;
  t: ReturnType<typeof useTranslations>;
}) {
  // Time-scale config. "hour" = 24 cells in a day; "day" = 1 cell;
  // "week" = 7; "month" = 30; "quarter" = 90.
  const cellCount = mode === 'hour' ? 24 : mode === 'day' ? 1 : mode === 'week' ? 7 : mode === 'month' ? 30 : 90;
  const cellMs = mode === 'hour' ? HOUR_MS : DAY_MS;
  const offsetMultiplier = mode === 'hour' ? 1 : mode === 'day' ? 1 : mode === 'week' ? 7 : mode === 'month' ? 30 : 90;

  const weekStart = useMemo(() => {
    const base = mode === 'week' || mode === 'month' || mode === 'quarter'
      ? startOfWeek(new Date())
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    return new Date(base.getTime() + offset * offsetMultiplier * DAY_MS);
  }, [offset, offsetMultiplier, mode]);
  const weekEndExclusive = useMemo(
    () => new Date(weekStart.getTime() + cellCount * cellMs),
    [weekStart, cellCount, cellMs],
  );
  const weekStartMs = weekStart.getTime();
  const weekDurationMs = weekEndExclusive.getTime() - weekStartMs;

  const days = useMemo(
    () => Array.from({ length: cellCount }, (_, i) => new Date(weekStartMs + i * cellMs)),
    [weekStartMs, cellCount, cellMs],
  );

  const allLists = lists.filter((l) => !l.archivedAt);
  const visibleLists = listFilter
    ? allLists.filter((l) => listFilter.has(l.id))
    : allLists;

  // Today vertical line position (% across the bars viewport), or null when
  // outside range. Rendered as an SVG overlay on top of the rows.
  const todayPct = useMemo(() => {
    const now = Date.now();
    if (now < weekStartMs || now > weekStartMs + weekDurationMs) return null;
    return ((now - weekStartMs) / weekDurationMs) * 100;
  }, [weekStartMs, weekDurationMs]);

  // Inline date editor — long-press a bar to open. Tap still opens the card detail.
  const [editingCard, setEditingCard] = useState<{ card: BoardCard; list: BoardList } | null>(null);

  // Column width tuned for readability per mode.
  const colWidth = mode === 'hour' ? 36 : mode === 'day' ? 220 : mode === 'week' ? 80 : mode === 'month' ? 50 : 28;

  return (
    <View style={{ flex: 1 }}>
      {/* Header bar */}
      <View className="flex-row items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
          {ganttLabel(weekStart, weekEndExclusive, mode)}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>
          {(['hour', 'day', 'week', 'month', 'quarter'] as const).map((m) => (
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
        </ScrollView>
      </View>

      {/* List filter chips — web parity. Tap a list to toggle it on/off; "All"
          resets the filter. Hidden when only one list is on the board. */}
      {allLists.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-3 py-2 gap-2"
          className="border-b border-border/40"
        >
          <Pressable
            onPress={() => setListFilter(null)}
            className={`rounded-full px-3 py-1 ${listFilter === null ? 'bg-cyan' : 'bg-secondary'}`}
          >
            <Text
              style={{ fontFamily: fonts.semibold }}
              className={`text-[10px] ${listFilter === null ? 'text-background' : 'text-foreground'}`}
            >
              {t('gantt.allLists')}
            </Text>
          </Pressable>
          {allLists.map((list) => {
            const on = listFilter ? listFilter.has(list.id) : false;
            return (
              <Pressable
                key={list.id}
                onPress={() => {
                  const next = new Set(listFilter ?? []);
                  if (next.has(list.id)) next.delete(list.id);
                  else next.add(list.id);
                  setListFilter(next.size === 0 ? null : next);
                }}
                className={`flex-row items-center gap-1 rounded-full px-3 py-1 ${on ? 'bg-cyan' : 'bg-secondary'}`}
                style={list.color ? { borderLeftWidth: 2, borderLeftColor: list.color } : undefined}
              >
                {on ? <Eye size={9} color={colors.background} /> : <EyeOff size={9} color={colors.mutedForeground} />}
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className={`text-[10px] ${on ? 'text-background' : 'text-foreground'}`}
                >
                  {list.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

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
                  width: colWidth,
                  paddingHorizontal: 6,
                  paddingVertical: 6,
                  borderRightWidth: 1,
                  borderRightColor: colors.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.foreground }}>
                  {mode === 'hour'
                    ? `${day.getHours()}h`
                    : day.toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text style={{ fontSize: 9, color: colors.mutedForeground }}>
                  {mode === 'hour'
                    ? ''
                    : `${day.getDate()}/${day.getMonth() + 1}`}
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
                      // total width matches sum of grid cells so % positioning works correctly
                      width: colWidth * cellCount,
                      position: 'relative',
                      minHeight: 48,
                    }}
                  >
                    {/* Day grid lines */}
                    {days.map((_, i) => (
                      <View
                        key={i}
                        style={{
                          width: colWidth,
                          borderRightWidth: 1,
                          borderRightColor: colors.border,
                        }}
                      />
                    ))}
                    {/* Today vertical line (only when today is visible). */}
                    {todayPct !== null ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${todayPct}%`,
                          width: 1.5,
                          backgroundColor: '#fb923c',
                          opacity: 0.85,
                        }}
                      />
                    ) : null}
                    {/* Dependency arrows: when a card declares `parentCardId`
                        and both live in the same visible row, draw a thin
                        SVG line from the parent's bar end to this bar's start.
                        Mobile: rendered as a flat line, not curved — keeps
                        the SVG cheap. Cross-row dependencies are skipped. */}
                    {(() => {
                      const barById = new Map<string, { left: number; width: number; top: number }>();
                      cards.forEach((c, ci) => {
                        const s = parseDate(c.startAt ?? c.dueAt);
                        const e = parseDate(c.dueAt ?? c.startAt);
                        if (!s || !e) return;
                        const cs = Math.max(s, weekStartMs);
                        const ce = Math.min(e + DAY_MS, weekStartMs + weekDurationMs);
                        if (ce <= weekStartMs || cs >= weekStartMs + weekDurationMs) return;
                        barById.set(c.id, {
                          left: ((cs - weekStartMs) / weekDurationMs) * 100,
                          width: ((ce - cs) / weekDurationMs) * 100,
                          top: 6 + (ci % 3) * 18,
                        });
                      });
                      const arrows: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
                      cards.forEach((c) => {
                        if (!c.parentCardId) return;
                        const a = barById.get(c.parentCardId);
                        const b = barById.get(c.id);
                        if (!a || !b) return;
                        arrows.push({
                          x1: a.left + a.width,
                          y1: a.top + 7,
                          x2: b.left,
                          y2: b.top + 7,
                          key: `${c.parentCardId}->${c.id}`,
                        });
                      });
                      if (arrows.length === 0) return null;
                      return (
                        <Svg
                          pointerEvents="none"
                          width="100%"
                          height="100%"
                          style={{ position: 'absolute', inset: 0 } as any}
                        >
                          {arrows.map((a) => (
                            <SvgLine
                              key={a.key}
                              x1={`${a.x1}%`}
                              y1={a.y1}
                              x2={`${a.x2}%`}
                              y2={a.y2}
                              stroke={colors.cyan}
                              strokeWidth={1}
                              strokeOpacity={0.7}
                            />
                          ))}
                        </Svg>
                      );
                    })()}
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
                      // Web parity: clamp to a 3.5% floor so single-day bars stay
                      // visible/tappable at week/month/quarter scales.
                      const widthPct = Math.max(
                        3.5,
                        ((clampedEnd - clampedStart) / weekDurationMs) * 100,
                      );
                      const top = 6 + (ci % 3) * 18;
                      // Web parity: overdue cards (dueAt in the past) render red.
                      const isOverdue = endMs < Date.now();
                      const barColor = isOverdue ? '#ef4444' : list.color ?? colors.cyan;
                      return (
                        <Pressable
                          key={card.id}
                          onPress={() => onCardPress(card, list)}
                          onLongPress={() => setEditingCard({ card, list })}
                          accessibilityLabel={card.title}
                          style={{
                            position: 'absolute',
                            left: `${leftPct}%`,
                            top,
                            width: `${widthPct}%`,
                            height: 14,
                            backgroundColor: `${barColor}55`,
                            borderColor: barColor,
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

      {/* Inline date editor — long-press a bar to open. Lightweight modal: two
          ISO date inputs + save. Mobile: a native picker would be nicer, but
          the manual YYYY-MM-DD field matches the CardDetailModal flow and
          requires zero extra deps. */}
      {editingCard ? (
        <GanttDateEditor
          item={editingCard}
          onClose={() => setEditingCard(null)}
          onSave={async (startAt, dueAt) => {
            const id = editingCard.card.id;
            onLocalPatch(id, (c) => ({ ...c, startAt, dueAt }));
            setEditingCard(null);
            try {
              await onPatchCard(id, { startAt, dueAt });
            } catch {
              /* swallow — pulse refresh reconciles */
            }
          }}
          t={t}
        />
      ) : null}
    </View>
  );
}

function GanttDateEditor({
  item,
  onClose,
  onSave,
  t,
}: {
  item: { card: BoardCard; list: BoardList };
  onClose(): void;
  onSave(startAt: string | null, dueAt: string | null): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [s, setS] = useState(item.card.startAt ? item.card.startAt.slice(0, 10) : '');
  const [d, setD] = useState(item.card.dueAt ? item.card.dueAt.slice(0, 10) : '');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-background/80 px-6">
        <View className="w-full rounded-2xl border border-border bg-card p-4 gap-3">
          <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
            {item.card.title}
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {t('startAt')}
              </Text>
              <CardDateField value={s} onChange={setS} t={t} />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {t('dueAt')}
              </Text>
              <CardDateField value={d} onChange={setD} t={t} />
            </View>
          </View>
          <View className="flex-row justify-end gap-2">
            <Pressable
              onPress={onClose}
              className="rounded-md border border-border bg-secondary px-3 py-1"
            >
              <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
                {t('cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void onSave(
                  s ? new Date(s).toISOString() : null,
                  d ? new Date(d).toISOString() : null,
                )
              }
              className="rounded-md bg-cyan px-3 py-1"
            >
              <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-background">
                {t('add')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Shared date field ──────────────────────────────────────────────────────

/**
 * Single reusable date field used by BOTH the card detail dates editor and the
 * Gantt inline date editor (start_at + due_at), so the two setters look and
 * behave identically. Value is the `YYYY-MM-DD` slice; a Clear button wipes it.
 *
 * No extra native date-picker dependency is pulled in — the field accepts a
 * typed ISO date and normalises on blur, matching the lightweight approach the
 * web uses for its date inputs while keeping a consistent control everywhere.
 */
function CardDateField({
  value,
  onChange,
  onCommit,
  t,
}: {
  value: string;
  onChange(next: string): void;
  onCommit?(): void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <TextInput
        value={value}
        onChangeText={onChange}
        onBlur={onCommit}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        style={{ fontFamily: fonts.mono, color: colors.foreground, flex: 1 }}
        className="rounded-md border border-border bg-background px-2 py-1.5"
      />
      {value ? (
        <Pressable
          onPress={() => {
            onChange('');
            onCommit?.();
          }}
          hitSlop={6}
          accessibilityLabel={t('clear')}
          className="rounded-md p-1"
        >
          <X size={12} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
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
  createTag,
  startTimer,
  stopTimer,
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
    coverUrl?: string | null;
  }): Promise<void>;
  addAssignee(cardId: string, userId: string): Promise<void>;
  removeAssignee(cardId: string, userId: string): Promise<void>;
  listBoardTags(): Promise<BoardTag[]>;
  addTag(cardId: string, tagId: string, meta?: { name?: string; color?: string; tagKind?: string }): Promise<void>;
  removeTag(cardId: string, tagId: string): Promise<void>;
  createTag(name: string, color?: string): Promise<BoardTag>;
  startTimer(cardId: string): Promise<void>;
  stopTimer(cardId: string): Promise<void>;
  onLocalPatch(cardId: string, mutate: (c: BoardCard) => BoardCard): void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  // Mobile: the Detail tab used to stack EVERY property editor (assignees,
  // tags, dates, cover, move, archive) inline, all expanded at once,
  // which was overwhelming. Web shows a compact card whose properties are
  // BUTTONS that each open a focused popover. We mirror that: `propertySheet`
  // tracks which single property editor is open as a focused bottom-sheet
  // Modal (null = none). The Detail body itself only shows the inline title, a
  // row of property buttons, compact value chips, and the description/checklist.
  const [propertySheet, setPropertySheet] = useState<
    'assignees' | 'tags' | 'dates' | 'cover' | 'move' | null
  >(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [boardTags, setBoardTags] = useState<BoardTag[]>([]);
  // Tag picker (web "create tag while adding" UX): the search box doubles as a
  // create field — typing a name with no exact match surfaces a "Create …" row.
  const [tagSearch, setTagSearch] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const { locale } = useI18n();
  // Mobile: which tab the card sidebar shows — 'detail' is the existing form,
  // 'copilot' / 'comments' / 'activity' swap in the 3 reusable panels.
  const [sidebarTab, setSidebarTab] = useState<CardSidebarTab>('detail');

  useEffect(() => {
    if (item) {
      setTitle(item.card.title);
      setSummary(item.card.summary ?? '');
      setStartAt(item.card.startAt ? item.card.startAt.slice(0, 10) : '');
      setDueAt(item.card.dueAt ? item.card.dueAt.slice(0, 10) : '');
      setPropertySheet(null);
      setTagSearch('');
      // Mobile: each newly-opened card starts on the Detail tab. Carrying
      // the previous selection forward would surprise users opening a fresh
      // card and seeing it stuck on someone else's chat.
      setSidebarTab('detail');
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

  // ── Compact value summaries shown as chips in the Detail body ──────────
  const cardAssignees = item.card.assignees ?? [];
  const cardTags = item.card.tags ?? [];
  const dueLabel = item.card.dueAt
    ? new Date(item.card.dueAt).toLocaleDateString()
    : null;

  // Mobile: each property is now a BUTTON that opens a focused bottom-sheet
  // (mirrors the web's button→popover pattern). This is the compact button
  // row that lives under the title.
  const propertyButtons: Array<{
    key: NonNullable<typeof propertySheet>;
    icon: typeof Users;
    label: string;
  }> = [
    { key: 'assignees', icon: Users, label: t('assigneesLabel') },
    { key: 'tags', icon: TagIcon, label: t('tagsLabel') },
    { key: 'dates', icon: CalendarDays, label: t('dates') },
    { key: 'cover', icon: ImageIcon, label: t('cover') },
    { key: 'move', icon: ArrowRight, label: t('move') },
  ];

  // Mobile: the Detail tab is now COMPACT. Title (inline) + a row of property
  // buttons + value chips at the top; the description + checklist form the
  // scrollable body (that's the card's actual content). Every property editor
  // lives behind its button in `propertySheet` (rendered as a Modal below).
  const detailBody = (
    <ScrollView
      contentContainerClassName="p-4 gap-3"
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={{ fontFamily: fonts.semibold }}
        className="text-[10px] uppercase tracking-widest text-muted-foreground"
      >
        {item.list.name}
      </Text>

      {/* Inline-editable title */}
      <TextInput
        value={title}
        onChangeText={setTitle}
        onBlur={commit}
        style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.foreground, padding: 0 }}
      />

      {/* Property buttons row (button → focused bottom-sheet) + Archive */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 items-center"
        style={{ flexGrow: 0 }}
      >
        {propertyButtons.map(({ key, icon: Icon, label }) => (
          <Pressable
            key={key}
            onPress={() => setPropertySheet(key)}
            className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1.5"
          >
            <Icon size={12} color={colors.foreground} />
            <Text style={{ fontFamily: fonts.semibold }} className="text-[11px] text-foreground">
              {label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => void onArchive()}
          className="flex-row items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5"
        >
          <Archive size={12} color={colors.destructive} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-[11px] text-destructive">
            {t('archive')}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Compact value chips — tap any to open its editor. Mirrors web's
          inline metadata strip (assignee avatars, tag pills, due date) where
          each value doubles as the property trigger. */}
      <View className="flex-row flex-wrap items-center gap-1.5">
        {/* Due date */}
        {dueLabel ? (
          <Pressable
            onPress={() => setPropertySheet('dates')}
            className="flex-row items-center gap-1 rounded-full border border-border bg-background px-2 py-1"
          >
            <CalendarDays size={10} color={colors.mutedForeground} />
            <Text className="text-[10px] text-foreground">{dueLabel}</Text>
          </Pressable>
        ) : null}

        {/* Assignee avatars */}
        {cardAssignees.length > 0 ? (
          <Pressable
            onPress={() => setPropertySheet('assignees')}
            className="flex-row items-center gap-1 rounded-full border border-border bg-background px-1.5 py-1"
          >
            {cardAssignees.slice(0, 3).map((a) => (
              <AssigneeAvatar key={a.id} assignee={a} size={20} />
            ))}
            {cardAssignees.length > 3 ? (
              <Text className="text-[10px] text-muted-foreground">+{cardAssignees.length - 3}</Text>
            ) : null}
          </Pressable>
        ) : null}

        {/* Tag pills */}
        {cardTags.slice(0, 3).map((tag) => (
          <Pressable
            key={tag.id}
            onPress={() => setPropertySheet('tags')}
            className="rounded-full px-2 py-1"
            style={{
              backgroundColor: `${tag.color ?? colors.mutedForeground}22`,
              borderWidth: 1,
              borderColor: `${tag.color ?? colors.mutedForeground}55`,
            }}
          >
            <Text
              style={{ fontFamily: fonts.semibold, color: tag.color ?? colors.mutedForeground }}
              className="text-[10px]"
            >
              {translateNativeTagName(tag.name, locale)}
            </Text>
          </Pressable>
        ))}
        {cardTags.length > 3 ? (
          <Pressable onPress={() => setPropertySheet('tags')} className="px-1 py-1">
            <Text className="text-[10px] text-muted-foreground">+{cardTags.length - 3}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Cover preview (only when set) — tap opens the cover sheet. */}
      {item.card.coverUrl ? (
        <Pressable onPress={() => setPropertySheet('cover')} className="overflow-hidden rounded-lg">
          <Image
            source={{ uri: item.card.coverUrl }}
            style={{ width: '100%', height: 120 }}
            resizeMode="cover"
          />
        </Pressable>
      ) : null}

      {/* ── Card content body: description + timer + checklist ────────────
          These stay inline because they ARE the card's content, not just
          editable metadata. */}
      <View className="gap-1">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          {t('description')}
        </Text>
        <TextInput
          value={summary}
          onChangeText={setSummary}
          onBlur={commit}
          placeholder={t('cardSummaryPlaceholder')}
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={{ fontFamily: fonts.regular, color: colors.foreground, padding: 0, minHeight: 60 }}
        />
      </View>

      {/* ── Card timer + watch toggle ─────────────────────────── */}
      <View className="flex-row items-center gap-2">
        <CardTimerButton
          cardId={item.card.id}
          startTimer={startTimer}
          stopTimer={stopTimer}
          t={t}
        />
        <CardWatchToggle cardId={item.card.id} t={t} />
      </View>

      {/* ── Inline checklist (web sub-brick port) ─────────────── */}
      <CardChecklistInline cardId={item.card.id} t={t} />
    </ScrollView>
  );

  // ── Focused property editor bodies, keyed by `propertySheet`. Each renders
  //    inside the shared CardPropertySheet bottom-sheet (web popover parity). ─
  const renderPropertyEditor = () => {
    switch (propertySheet) {
      case 'assignees':
        return (
          <View className="gap-2">
            <View className="flex-row flex-wrap items-center gap-1">
              {cardAssignees.length === 0 ? (
                <Text className="text-xs text-muted-foreground">{t('noAssignees')}</Text>
              ) : (
                cardAssignees.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={async () => {
                      const cardId = item.card.id;
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
                    <AssigneeAvatar assignee={a} size={16} />
                    <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
                      {a.name ?? a.email ?? a.id}
                    </Text>
                    <X size={8} color={colors.cyan} />
                  </Pressable>
                ))
              )}
            </View>
            <View className="rounded-xl border border-border bg-background p-2 gap-1">
              {teamMembers.length === 0 ? (
                <Text className="px-2 py-1 text-xs text-muted-foreground">{t('noAssignees')}</Text>
              ) : (
                teamMembers.map((m) => {
                  const already = cardAssignees.some((a) => a.id === m.id);
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
                        try {
                          await addAssignee(cardId, m.id);
                        } catch {
                          /* Pulse refresh will reconcile */
                        }
                      }}
                      className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${already ? 'bg-cyan/10' : ''}`}
                    >
                      <AssigneeAvatar
                        assignee={{
                          id: m.id,
                          name: m.displayName ?? m.name,
                          email: m.email,
                          avatarUrl: m.avatarUrl ?? undefined,
                        }}
                        size={22}
                      />
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
          </View>
        );
      case 'tags':
        return (
          <View className="gap-2">
            <View className="flex-row flex-wrap items-center gap-1">
              {cardTags.length === 0 ? (
                <Text className="text-xs text-muted-foreground">{t('noTags')}</Text>
              ) : (
                cardTags.map((tag) => (
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
                      style={{ fontFamily: fonts.semibold, color: tag.color ?? colors.mutedForeground }}
                      className="text-[10px]"
                    >
                      {translateNativeTagName(tag.name, locale)}
                    </Text>
                    <X size={8} color={tag.color ?? colors.mutedForeground} />
                  </Pressable>
                ))
              )}
            </View>

            {/* Search-or-create field. Web parity: typing a name with no exact
                match surfaces a "Create …" row that mints the tag + assigns it.
                (Killio-Frontend card-detail-modal handleCreateTag/handleAddTag.) */}
            <TextInput
              value={tagSearch}
              onChangeText={setTagSearch}
              placeholder={t('tagNamePlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              style={{ fontFamily: fonts.regular, color: colors.foreground }}
              className="rounded-md border border-border bg-background px-3 py-2"
            />

            <View className="rounded-xl border border-border bg-background p-2 gap-1">
              {(() => {
                const q = tagSearch.trim().toLowerCase();
                const filtered = boardTags.filter((tag) => {
                  if (!q) return true;
                  const raw = String(tag.name ?? '').toLowerCase();
                  const localized = translateNativeTagName(tag.name, locale).toLowerCase();
                  return raw.includes(q) || localized.includes(q);
                });
                // Native suggestions not already on the board (web parity).
                const nativeSuggestions = DEFAULT_NATIVE_TAG_SUGGESTIONS.filter((s) => {
                  const exists = boardTags.some(
                    (tag) => String(tag.name ?? '').toLowerCase() === s.key.toLowerCase(),
                  );
                  if (exists) return false;
                  if (!q) return true;
                  const label = translateNativeTagName(s.key, locale).toLowerCase();
                  return s.key.toLowerCase().includes(q) || label.includes(q);
                });
                const exactExists = boardTags.some(
                  (tag) =>
                    String(tag.name ?? '').toLowerCase() === q ||
                    translateNativeTagName(tag.name, locale).toLowerCase() === q,
                );

                const assignTag = async (tag: BoardTag) => {
                  const cardId = item.card.id;
                  onLocalPatch(cardId, (c) => ({
                    ...c,
                    tags: [
                      ...(c.tags ?? []),
                      { id: tag.id, name: tag.name, color: tag.color, tagKind: tag.tagKind },
                    ],
                  }));
                  setTagSearch('');
                  try {
                    await addTag(cardId, tag.id, {
                      name: tag.name,
                      color: tag.color,
                      tagKind: tag.tagKind,
                    });
                  } catch {
                    /* Pulse refresh will reconcile */
                  }
                };

                const handleCreate = async (name: string, color?: string) => {
                  const trimmed = name.trim();
                  if (!trimmed || creatingTag) return;
                  setCreatingTag(true);
                  try {
                    const created = await createTag(trimmed, color);
                    setBoardTags((prev) =>
                      prev.some((p) => p.id === created.id) ? prev : [...prev, created],
                    );
                    await assignTag(created);
                  } catch {
                    /* swallow — user can retry */
                  } finally {
                    setCreatingTag(false);
                  }
                };

                return (
                  <>
                    {filtered.length === 0 && nativeSuggestions.length === 0 && !tagSearch.trim() ? (
                      <Text className="px-2 py-1 text-xs text-muted-foreground">{t('noTags')}</Text>
                    ) : null}
                    {filtered.map((tag) => {
                      const already = cardTags.some((t2) => t2.id === tag.id);
                      return (
                        <Pressable
                          key={tag.id}
                          disabled={already}
                          onPress={() => void assignTag(tag)}
                          className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${already ? 'opacity-50' : ''}`}
                        >
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: tag.color ?? colors.mutedForeground,
                            }}
                          />
                          <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                            {translateNativeTagName(tag.name, locale)}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {/* Native tag quick-create suggestions (creates on tap). */}
                    {nativeSuggestions.map((s) => (
                      <Pressable
                        key={s.key}
                        onPress={() => void handleCreate(s.key, s.color)}
                        className="flex-row items-center gap-2 rounded-md px-3 py-2"
                      >
                        <View
                          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }}
                        />
                        <Text style={{ fontFamily: fonts.medium }} className="text-sm text-muted-foreground">
                          {translateNativeTagName(s.key, locale)}
                        </Text>
                      </Pressable>
                    ))}
                    {/* "Create new" row when the typed name has no exact match. */}
                    {tagSearch.trim() && !exactExists ? (
                      <Pressable
                        onPress={() => void handleCreate(tagSearch)}
                        disabled={creatingTag}
                        className="flex-row items-center gap-2 rounded-md border border-dashed border-cyan/50 bg-cyan/10 px-3 py-2"
                      >
                        <Plus size={12} color={colors.cyan} />
                        <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-cyan">
                          {t('createTag', { name: tagSearch.trim() })}
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                );
              })()}
            </View>
          </View>
        );
      case 'dates':
        return (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {t('startAt')}
              </Text>
              <CardDateField
                value={startAt}
                onChange={(next) => {
                  setStartAt(next);
                }}
                onCommit={commit}
                t={t}
              />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {t('dueAt')}
              </Text>
              <CardDateField
                value={dueAt}
                onChange={(next) => {
                  setDueAt(next);
                }}
                onCommit={commit}
                t={t}
              />
            </View>
          </View>
        );
      case 'cover':
        return (
          <CardCoverSlot
            cardId={item.card.id}
            coverUrl={item.card.coverUrl ?? null}
            isLocal={isLocal}
            onChange={async (next) => {
              onLocalPatch(item.card.id, (c) => ({ ...c, coverUrl: next }));
              try {
                await onPatch({ coverUrl: next });
              } catch {
                /* ignore */
              }
            }}
            t={t}
          />
        );
      case 'move':
        return (
          <View className="rounded-xl border border-border bg-background p-2 gap-1">
            {lists.map((list) => (
              <Pressable
                key={list.id}
                onPress={() => {
                  setPropertySheet(null);
                  void onMove(list.id);
                }}
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
        );
      default:
        return null;
    }
  };

  const propertySheetTitle = propertySheet
    ? propertySheet === 'assignees'
      ? t('assigneesLabel')
      : propertySheet === 'tags'
        ? t('tagsLabel')
        : propertySheet === 'dates'
          ? t('dates')
          : propertySheet === 'cover'
            ? t('cover')
            : t('move')
    : '';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background/80">
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        {/* Mobile: card detail sheet — 88% height bottom-sheet hosting the
            4-tab Detail / Copilot / Comments / Activity layout. */}
        <View
          style={{ height: '88%' }}
          className="rounded-t-2xl border-t border-border bg-card"
        >
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          <View className="flex-row items-center justify-between border-b border-border/40 px-3 pb-2">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="flex-1 text-sm text-foreground"
              numberOfLines={1}
            >
              {item.card.title || item.list.name}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} className="rounded-md p-1">
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>
          <CardSidebar
            cardId={item.card.id}
            activeTab={sidebarTab}
            onChangeTab={setSidebarTab}
            detailContent={detailBody}
          />
        </View>
      </View>

      {/* Mobile: focused property editor as a nested bottom-sheet. Opening one
          property at a time keeps the Detail tab compact (web button→popover
          parity) instead of stacking every editor inline. */}
      <Modal
        visible={propertySheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPropertySheet(null)}
      >
        <View className="flex-1 bg-background/80">
          <Pressable onPress={() => setPropertySheet(null)} style={{ flex: 1 }} />
          <View className="rounded-t-2xl border-t border-border bg-card">
            <View className="items-center pt-2 pb-1">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>
            <View className="flex-row items-center justify-between border-b border-border/40 px-4 pb-2">
              <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
                {propertySheetTitle}
              </Text>
              <Pressable
                onPress={() => setPropertySheet(null)}
                hitSlop={8}
                className="rounded-md px-2 py-1"
              >
                <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-cyan">
                  {t('done')}
                </Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerClassName="p-4 gap-2"
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 420 }}
            >
              {renderPropertyEditor()}
            </ScrollView>
          </View>
        </View>
      </Modal>
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

// ─── Card cover slot ────────────────────────────────────────────────────────

/**
 * Cover image picker: tap to choose, tap "X" to clear. Cloud mode uploads to
 * the backend (POST /uploads) then stores the returned URL; local mode keeps
 * the picked URI verbatim — it's served straight from disk.
 *
 * Mobile: expo-image-picker requests permission lazily, so the first tap on
 * a cold install pops the OS prompt.
 */
function CardCoverSlot({
  cardId,
  coverUrl,
  isLocal,
  onChange,
  t,
}: {
  cardId: string;
  coverUrl: string | null;
  isLocal: boolean;
  onChange(next: string | null): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const pick = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const asset = res.assets[0];
      if (isLocal) {
        // Mobile: local boards point at the file URI directly — the .boards.json
        // schemaVersion already serialises strings, so no extra plumbing.
        await onChange(asset.uri);
        return;
      }
      const uploaded = await uploadFile({
        uri: asset.uri,
        name: asset.fileName ?? `cover-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
        ownerScopeType: 'card',
        ownerScopeId: cardId,
        usage: 'card-cover',
      });
      if (typeof uploaded.url === 'string') {
        await onChange(uploaded.url);
      }
    } catch {
      /* swallow — the user can retry from the same slot */
    }
  }, [cardId, isLocal, onChange]);

  return (
    <View className="gap-1">
      <Text
        style={{ fontFamily: fonts.semibold }}
        className="text-[10px] uppercase tracking-widest text-muted-foreground"
      >
        {t('cover')}
      </Text>
      {coverUrl ? (
        <View className="relative overflow-hidden rounded-md border border-border">
          <Image
            source={{ uri: coverUrl }}
            style={{ width: '100%', height: 120 }}
            resizeMode="cover"
          />
          <Pressable
            onPress={() => void onChange(null)}
            accessibilityLabel={t('clearCover')}
            className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5"
          >
            <Trash2 size={11} color={colors.destructive} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => void pick()}
          accessibilityLabel={t('addCover')}
          className="flex-row items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background py-3"
        >
          <ImageIcon size={13} color={colors.cyan} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-cyan">
            {t('addCover')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Card timer ─────────────────────────────────────────────────────────────

/**
 * Start / stop time tracking on a card. Backend gap (2026-06): the
 * /cards/:id/timer/start|stop routes don't exist yet on cards.controller —
 * the dual router in cloud mode will throw, the UI swallows. Local mode is a
 * no-op so the buttons still render and look right.
 */
function CardTimerButton({
  cardId,
  startTimer,
  stopTimer,
  t,
}: {
  cardId: string;
  startTimer(cardId: string): Promise<void>;
  stopTimer(cardId: string): Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [running, setRunning] = useState(false);
  const toggle = useCallback(async () => {
    setRunning((v) => !v);
    try {
      if (running) await stopTimer(cardId);
      else await startTimer(cardId);
    } catch {
      // Revert optimistic state.
      setRunning((v) => !v);
    }
  }, [cardId, running, startTimer, stopTimer]);
  return (
    <Pressable
      onPress={() => void toggle()}
      accessibilityLabel={running ? t('stopTimer') : t('startTimer')}
      className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-3 py-2"
      style={running ? { borderColor: '#fb923c', backgroundColor: '#fb923c22' } : undefined}
    >
      {running ? (
        <Square size={11} color="#fb923c" />
      ) : (
        <Play size={11} color={colors.foreground} />
      )}
      <Text
        style={{ fontFamily: fonts.semibold }}
        className={`text-xs ${running ? 'text-foreground' : 'text-foreground'}`}
      >
        {running ? t('stopTimer') : t('startTimer')}
      </Text>
    </Pressable>
  );
}

// ─── Card watch toggle ──────────────────────────────────────────────────────

/**
 * Watch / unwatch a card. The web exposes this as a subscription toggle for
 * notifications; mobile keeps it as local state for now (no backend wiring —
 * the Pulse `card.subscribe` event isn't surfaced through Vault yet).
 */
function CardWatchToggle({
  cardId: _cardId,
  t,
}: {
  cardId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [watching, setWatching] = useState(false);
  return (
    <Pressable
      onPress={() => setWatching((v) => !v)}
      accessibilityLabel={watching ? t('unwatch') : t('watch')}
      className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-3 py-2"
      style={watching ? { borderColor: colors.cyan, backgroundColor: `${colors.cyan}22` } : undefined}
    >
      {watching ? (
        <Eye size={11} color={colors.cyan} />
      ) : (
        <EyeOff size={11} color={colors.foreground} />
      )}
      <Text
        style={{ fontFamily: fonts.semibold }}
        className={`text-xs ${watching ? 'text-cyan' : 'text-foreground'}`}
      >
        {watching ? t('unwatch') : t('watch')}
      </Text>
    </Pressable>
  );
}

// ─── Card checklist (inline brick) ──────────────────────────────────────────

/**
 * Renders the UnifiedChecklistBrick inline in the card detail. State is kept
 * locally — wiring to the card brick endpoint (`POST /cards/:id/bricks`) is
 * a follow-up; this exists so users can sketch a checklist immediately and
 * we can persist via the brick endpoint once the BrickList wiring lands.
 * // TODO: Persist via POST /cards/:cardId/bricks — backend route exists.
 */
function CardChecklistInline({
  cardId: _cardId,
  t,
}: {
  cardId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [items, setItems] = useState<{ id: string; label: string; checked: boolean }[]>([]);
  if (items.length === 0) {
    return (
      <Pressable
        onPress={() =>
          setItems([
            { id: `chk_${Date.now()}`, label: '', checked: false },
          ])
        }
        accessibilityLabel={t('addChecklist')}
        className="flex-row items-center gap-1 rounded-md border border-dashed border-border bg-background px-3 py-2"
      >
        <ListChecks size={11} color={colors.cyan} />
        <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-cyan">
          {t('addChecklist')}
        </Text>
      </Pressable>
    );
  }
  return (
    <View className="rounded-md border border-border bg-background p-2">
      <UnifiedChecklistBrick id="card-inline" items={items} onUpdate={setItems} />
    </View>
  );
}

// ─── Filters sheet ──────────────────────────────────────────────────────────

/**
 * Bottom-sheet for filtering cards by tag / assignee / due-soon. Web parity
 * for the top FilterButton on the kanban toolbar.
 *
 * Mobile: tag list comes from `listBoardTags()` (cloud or local). Assignee
 * filter is omitted in local mode because there's no team list to enumerate.
 */
function FiltersSheet({
  open,
  onClose,
  filters,
  setFilters,
  teamId,
  isLocal,
  listBoardTags,
  t,
}: {
  open: boolean;
  onClose(): void;
  filters: CardFilters;
  setFilters(next: CardFilters): void;
  teamId: string | null;
  isLocal: boolean;
  listBoardTags(): Promise<BoardTag[]>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [tags, setTags] = useState<BoardTag[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const { locale } = useI18n();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBoardTags()
      .then((next) => {
        if (!cancelled) setTags(next);
      })
      .catch(() => undefined);
    if (!isLocal && teamId) {
      listTeamMembers(teamId)
        .then((m) => {
          if (!cancelled) setMembers(m);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [open, isLocal, teamId, listBoardTags]);

  if (!open) return null;
  const toggleTag = (id: string) => {
    const next = filters.tagIds.includes(id)
      ? filters.tagIds.filter((x) => x !== id)
      : [...filters.tagIds, id];
    setFilters({ ...filters, tagIds: next });
  };
  const toggleAssignee = (id: string) => {
    const next = filters.assigneeIds.includes(id)
      ? filters.assigneeIds.filter((x) => x !== id)
      : [...filters.assigneeIds, id];
    setFilters({ ...filters, assigneeIds: next });
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background/80">
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        <View className="rounded-t-2xl border-t border-border bg-card p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
              {t('filters')}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 480 }} contentContainerClassName="gap-3">
            {tags.length > 0 ? (
              <View className="gap-1">
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  {t('tagsLabel')}
                </Text>
                <View className="flex-row flex-wrap gap-1">
                  {tags.map((tag) => {
                    const on = filters.tagIds.includes(tag.id);
                    return (
                      <Pressable
                        key={tag.id}
                        onPress={() => toggleTag(tag.id)}
                        className="flex-row items-center gap-1 rounded-full px-2 py-1"
                        style={{
                          backgroundColor: on
                            ? tag.color ?? colors.cyan
                            : `${tag.color ?? colors.mutedForeground}22`,
                          borderWidth: 1,
                          borderColor: tag.color ?? colors.mutedForeground,
                        }}
                      >
                        <Text
                          style={{ fontFamily: fonts.semibold }}
                          className={`text-[10px] ${on ? 'text-background' : 'text-foreground'}`}
                        >
                          {translateNativeTagName(tag.name, locale)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {!isLocal && members.length > 0 ? (
              <View className="gap-1">
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  {t('assigneesLabel')}
                </Text>
                <View className="flex-row flex-wrap gap-1">
                  {members.map((m) => {
                    const on = filters.assigneeIds.includes(m.id);
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => toggleAssignee(m.id)}
                        className={`rounded-full px-3 py-1 ${on ? 'bg-cyan' : 'bg-secondary'}`}
                      >
                        <Text
                          style={{ fontFamily: fonts.semibold }}
                          className={`text-[10px] ${on ? 'text-background' : 'text-foreground'}`}
                        >
                          {m.displayName ?? m.name ?? m.email ?? m.id}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <Pressable
              onPress={() =>
                setFilters({ ...filters, dueSoon: !filters.dueSoon })
              }
              className="flex-row items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
              style={
                filters.dueSoon
                  ? { borderColor: colors.cyan, backgroundColor: `${colors.cyan}22` }
                  : undefined
              }
            >
              <TimerIcon size={11} color={filters.dueSoon ? colors.cyan : colors.foreground} />
              <Text
                style={{ fontFamily: fonts.semibold }}
                className={`text-xs ${filters.dueSoon ? 'text-cyan' : 'text-foreground'}`}
              >
                {t('dueSoon')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                setFilters({ assigneeIds: [], tagIds: [], dueSoon: false })
              }
              className="rounded-md border border-border bg-secondary px-3 py-2"
            >
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-center text-xs text-foreground"
              >
                {t('clearFilters')}
              </Text>
            </Pressable>
          </ScrollView>
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
  if (mode === 'day' || mode === 'hour') return start.toLocaleDateString();
  // Use full-day granularity for the end label since the gantt range is
  // exclusive of the last unit boundary.
  const lastDay = new Date(endExclusive.getTime() - DAY_MS);
  return `${start.toLocaleDateString()} — ${lastDay.toLocaleDateString()}`;
}
