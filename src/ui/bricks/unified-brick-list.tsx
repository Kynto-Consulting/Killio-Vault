import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import {
  BarChart2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Table as TableIcon,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react-native';

import { BrickRenderer, type Brick as RendererBrick } from '../BrickRenderer';
import { ReferencePicker } from '../ReferencePicker';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import type {
  MentionType,
  PickerActiveBrick,
  PickerBoard,
  PickerDocument,
  PickerFolder,
  PickerUser,
  ReferencePickerSelection,
} from '@/types/picker';
import type { WorkspaceMemberLike } from './unified-bountiful-table';

/**
 * React Native port of the web `unified-brick-list.tsx`
 * (Killio-Frontend/src/components/bricks/unified-brick-list.tsx).
 *
 * The brick API and prop shape match the web file 1:1 — same component name
 * (`UnifiedBrickList`), same callback names, same content keys — so siblings
 * importing this list (form brick, accordion, tabs, columns, popup-document,
 * card descriptions) keep compiling without changes.
 *
 * Web → Native swap notes:
 *   • `@dnd-kit/*` → replaced with up/down chevron arrow buttons next to each
 *     brick. Multi-select / cross-container DnD props are accepted but become
 *     no-ops on mobile (they remain in the prop surface so siblings importing
 *     the list don't break). // TODO: long-press DnD via
 *     react-native-gesture-handler + react-native-reanimated — phase 2.
 *   • `lucide-react` → `lucide-react-native`.
 *   • `framer-motion` / `DragOverlay` → dropped (no animation while dragging).
 *   • `Portal` → `Modal` (RN's native portal equivalent).
 *   • `ReferencePicker` (Killio-Frontend "@-picker" popover) → the Vault
 *     full-screen RN `ReferencePicker` modal.
 *   • Slash command list & per-command preview → grouped command list inside
 *     the "+" modal (categories: media, ai, layout, basic, advanced). The
 *     web's right-pane preview is omitted on mobile (// Mobile: too cramped).
 *   • shadcn `@/components/ui/button` → small inline `<Pressable>` pills.
 *   • `useTranslations("document-detail")` / `useTranslations("board-detail")`
 *     namespaces don't exist on Vault yet — we fall back to `brickEditor` for
 *     the labels we need (Texto / Tabla / Gráfico / …).
 *   • `window.*` / `document.*` / `localStorage` → dropped or guarded by
 *     `Platform.OS` checks. The CSS-keyframe selection pulse is replaced by a
 *     static cyan border for selected rows.
 *
 * The actual brick rendering is delegated to the shared `BrickRenderer`
 * dispatcher (`../BrickRenderer.tsx`), which already knows how to render every
 * supported kind including the recursive composites (accordion / tabs /
 * columns). The list itself owns add/remove/reorder + the insert menu.
 */

type AddableKind =
  | 'text'
  | 'table'
  | 'graph'
  | 'checklist'
  | 'accordion'
  | 'tabs'
  | 'columns'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'code'
  | 'bookmark'
  | 'math'
  | 'database'
  | 'form';

type CrossContainerDropOptions = {
  intent?: 'move' | 'merge-text';
  sourceContainerToken?: string;
  targetContainerToken?: string;
};

interface UnifiedBrickListProps {
  bricks: any[];
  activeBricks?: any[];
  canEdit: boolean;
  onUpdateBrick: (id: string, content: any) => void;
  onDeleteBrick: (id: string) => void;
  onReorderBricks: (ids: string[]) => void;
  onAddBrick: (
    kind: string,
    afterBrickId?: string,
    parentProps?: any,
    initialContent?: any,
  ) => void;
  documents?: any[];
  boards?: any[];
  folders?: any[];
  users?: WorkspaceMemberLike[];
  addableKinds?: AddableKind[];
  /** Web-only paste/upload hooks. Kept in the prop surface for source parity. */
  onPasteImageInTextBrick?: (payload: {
    brickId: string;
    file: any;
    cursorOffset: number;
    markdown: string;
  }) => Promise<string | void> | string | void;
  onUploadMediaFiles?: (payload: { brickId: string; files: any[] }) => Promise<void> | void;
  /** Mobile: ignored — list always owns its own reorder. */
  hasExternalDndContext?: boolean;
  /** Mobile: no-op — DnD is not wired. */
  onCrossContainerDrop?: (
    activeId: string,
    overId: string,
    options?: CrossContainerDropOptions,
  ) => void;
  dropContainerToken?: string;
  emptyPlaceholder?: string;
  onAiAction?: (action: string, contextText: string) => void;
  onPatchCell?: (brickId: string, patch: Record<string, any>) => void;
  onPatchColumn?: (brickId: string, patch: Record<string, any>) => void;
  isCompact?: boolean;
  /** Mobile: no overlay during drag. */
  showDragOverlay?: boolean;
  /** Multi-select: long-press a brick to toggle selection. Bulk ops not yet
   *  wired on mobile but the selection set is honoured for visual styling. */
  selectedBrickIds?: Set<string>;
  onBrickSelectToggle?: (id: string) => void;
}

interface AddCommand {
  kind: AddableKind;
  labelKey: string;
  icon: LucideIcon;
  category: 'basic' | 'media' | 'layout' | 'advanced';
}

const ADD_COMMANDS: AddCommand[] = [
  { kind: 'text', labelKey: 'kind.text', icon: Type, category: 'basic' },
  { kind: 'checklist', labelKey: 'kind.checklist', icon: CheckSquare, category: 'basic' },
  { kind: 'code', labelKey: 'kind.code', icon: FileText, category: 'basic' },
  { kind: 'image', labelKey: 'kind.image', icon: ImageIcon, category: 'media' },
  { kind: 'video', labelKey: 'kind.image', icon: ImageIcon, category: 'media' },
  { kind: 'audio', labelKey: 'kind.image', icon: ImageIcon, category: 'media' },
  { kind: 'file', labelKey: 'kind.image', icon: FileText, category: 'media' },
  { kind: 'bookmark', labelKey: 'kind.bookmark', icon: FileText, category: 'media' },
  { kind: 'accordion', labelKey: 'kind.accordion', icon: ChevronDown, category: 'layout' },
  { kind: 'tabs', labelKey: 'kind.tabs', icon: LayoutGrid, category: 'layout' },
  { kind: 'columns', labelKey: 'kind.columns', icon: LayoutGrid, category: 'layout' },
  { kind: 'table', labelKey: 'kind.table', icon: TableIcon, category: 'advanced' },
  { kind: 'database', labelKey: 'kind.database', icon: LayoutGrid, category: 'advanced' },
  { kind: 'graph', labelKey: 'kind.mesh', icon: BarChart2, category: 'advanced' },
  { kind: 'form', labelKey: 'kind.form', icon: FileText, category: 'advanced' },
  { kind: 'math', labelKey: 'kind.math', icon: Type, category: 'advanced' },
];

const CATEGORY_ORDER: AddCommand['category'][] = ['basic', 'media', 'layout', 'advanced'];

function categoryLabel(cat: AddCommand['category'], locale: 'es' | 'en' = 'es'): string {
  const ES: Record<string, string> = {
    basic: 'Básicos',
    media: 'Media',
    layout: 'Estructura',
    advanced: 'Avanzados',
  };
  const EN: Record<string, string> = {
    basic: 'Basic',
    media: 'Media',
    layout: 'Layout',
    advanced: 'Advanced',
  };
  return (locale === 'en' ? EN : ES)[cat];
}

/** Normalise a brick coming from either DocumentBrick or BoardBrick into the
 *  flat `{ id, kind, content }` shape the renderer expects — same logic as the
 *  web `renderBrick` mapping. */
function normaliseBrick(brick: any): RendererBrick {
  if (!brick) return { kind: 'text', content: {} };
  return {
    id: brick.id,
    kind: brick.kind,
    position: brick.position,
    content: {
      text: brick.markdown || brick.content?.text || '',
      rows: brick.rows || brick.content?.rows || [],
      items: brick.tasks || brick.items || brick.content?.items || [],
      title: brick.title || brick.content?.title || '',
      body: brick.body || brick.content?.body || '',
      isExpanded:
        brick.isExpanded !== undefined ? brick.isExpanded : brick.content?.isExpanded,
      ...(brick.content || {}),
      // Top-level BoardBrick fields take precedence over content.*
      ...brick,
    },
  };
}

export const UnifiedBrickList: React.FC<UnifiedBrickListProps> = ({
  bricks,
  activeBricks,
  canEdit,
  onUpdateBrick,
  onDeleteBrick,
  onReorderBricks,
  onAddBrick,
  documents = [],
  boards = [],
  folders = [],
  users = [],
  addableKinds,
  // Web-only props — accepted for source parity, unused on mobile.
  onPasteImageInTextBrick: _onPasteImageInTextBrick,
  onUploadMediaFiles: _onUploadMediaFiles,
  hasExternalDndContext: _hasExternalDndContext = false,
  onCrossContainerDrop: _onCrossContainerDrop,
  dropContainerToken: _dropContainerToken,
  emptyPlaceholder,
  onAiAction: _onAiAction,
  onPatchCell: _onPatchCell,
  onPatchColumn: _onPatchColumn,
  isCompact = false,
  showDragOverlay: _showDragOverlay = true,
  selectedBrickIds,
  onBrickSelectToggle,
}) => {
  const t = useTranslations('brickEditor');

  // Mobile: enabledKinds matches the web default if the caller doesn't restrict.
  const enabledKinds: AddableKind[] =
    addableKinds && addableKinds.length > 0
      ? addableKinds
      : (['text', 'table', 'graph', 'checklist', 'accordion', 'form'] as AddableKind[]);

  const [plusMenuFor, setPlusMenuFor] = useState<string | null>(null);
  // Plus menu opened at the end of the list (no afterBrickId).
  const [plusMenuAtEnd, setPlusMenuAtEnd] = useState(false);
  const [pickerState, setPickerState] = useState<{
    filter: MentionType[];
    triggerBrickId: string;
  } | null>(null);

  // Mobile: web sorts by `position`. Keep parity.
  const sortedBricks = useMemo(
    () => [...bricks].sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0)),
    [bricks],
  );

  const ids = useMemo(() => sortedBricks.map((b) => b.id).filter(Boolean), [sortedBricks]);

  const moveBrick = (id: string, dir: 'up' | 'down') => {
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorderBricks(next);
  };

  const insertAfter = (kind: AddableKind, afterId?: string) => {
    setPlusMenuFor(null);
    setPlusMenuAtEnd(false);
    onAddBrick(kind, afterId);
  };

  const handlePickerSelect = (sel: ReferencePickerSelection) => {
    if (!pickerState) return;
    const target = bricks.find((b) => b?.id === pickerState.triggerBrickId);
    if (target && target.kind === 'text') {
      const currentText = target.content?.text || target.markdown || '';
      const newText = currentText ? `${currentText} ${sel.token}` : sel.token;
      onUpdateBrick(target.id, { ...target.content, text: newText, markdown: newText });
    } else {
      onAddBrick('text', pickerState.triggerBrickId, undefined, {
        text: sel.token,
        markdown: sel.token,
      });
    }
    setPickerState(null);
  };

  const visibleCommands = ADD_COMMANDS.filter((c) => enabledKinds.includes(c.kind));

  return (
    <View className="w-full" style={{ gap: 8 }}>
      {sortedBricks.length === 0 && canEdit && emptyPlaceholder ? (
        <Pressable
          onPress={() => onAddBrick('text')}
          className="min-h-[40px] w-full items-start justify-center rounded-lg"
        >
          <Text className="text-[15px] text-muted-foreground/60">{emptyPlaceholder}</Text>
        </Pressable>
      ) : null}

      {sortedBricks.map((brick, idx) => {
        const id = brick?.id ?? String(idx);
        const isSelected = !!selectedBrickIds?.has(id);
        const isFirst = idx === 0;
        const isLast = idx === sortedBricks.length - 1;
        const normalised = normaliseBrick(brick);

        return (
          <View
            key={id}
            className={`rounded-lg ${
              isSelected
                ? 'border-2 border-cyan/60 bg-cyan/[0.05]'
                : 'border border-transparent'
            }`}
            style={{ padding: isCompact ? 2 : 4 }}
          >
            <Pressable
              // Mobile: long-press toggles multi-select (web uses Ctrl/Cmd-click).
              onLongPress={() => {
                if (!canEdit || !onBrickSelectToggle) return;
                onBrickSelectToggle(id);
              }}
              delayLongPress={350}
            >
              <BrickRenderer
                brick={normalised}
                canEdit={canEdit}
                onChange={
                  canEdit
                    ? (next) => onUpdateBrick(id, next.content)
                    : undefined
                }
              />
            </Pressable>

            {canEdit ? (
              <View
                className="mt-1 flex-row items-center gap-1"
                style={{ justifyContent: 'flex-end' }}
              >
                <Pressable
                  onPress={() => moveBrick(id, 'up')}
                  disabled={isFirst}
                  hitSlop={6}
                  className={`rounded-md p-1 ${isFirst ? 'opacity-30' : 'opacity-70'}`}
                >
                  <ChevronUp size={14} color={colors.foreground} />
                </Pressable>
                <Pressable
                  onPress={() => moveBrick(id, 'down')}
                  disabled={isLast}
                  hitSlop={6}
                  className={`rounded-md p-1 ${isLast ? 'opacity-30' : 'opacity-70'}`}
                >
                  <ChevronDown size={14} color={colors.foreground} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setPlusMenuAtEnd(false);
                    setPlusMenuFor(id);
                  }}
                  hitSlop={6}
                  className="rounded-md p-1 opacity-70"
                >
                  <Plus size={14} color={colors.cyan} />
                </Pressable>
                <Pressable
                  onPress={() => onDeleteBrick(id)}
                  hitSlop={6}
                  className="rounded-md p-1 opacity-70"
                >
                  <Trash2 size={14} color={colors.destructive} />
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {canEdit && !emptyPlaceholder ? (
        <View className="mt-2 flex-row flex-wrap items-center justify-center gap-2 border-t border-border pt-4">
          {visibleCommands.slice(0, 6).map((c) => {
            const Icon = c.icon;
            return (
              <Pressable
                key={c.kind}
                onPress={() => insertAfter(c.kind, undefined)}
                className="flex-row items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5"
              >
                <Icon size={13} color={colors.cyan} />
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[11px] uppercase text-foreground"
                >
                  {t(c.labelKey)}
                </Text>
              </Pressable>
            );
          })}
          {visibleCommands.length > 6 ? (
            <Pressable
              onPress={() => {
                setPlusMenuAtEnd(true);
                setPlusMenuFor(null);
              }}
              className="flex-row items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5"
            >
              <Plus size={13} color={colors.cyan} />
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-[11px] uppercase text-foreground"
              >
                {t('addBlock')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <AddBrickModal
        visible={plusMenuFor !== null || plusMenuAtEnd}
        commands={visibleCommands}
        onClose={() => {
          setPlusMenuFor(null);
          setPlusMenuAtEnd(false);
        }}
        onPick={(kind) => insertAfter(kind, plusMenuFor ?? undefined)}
        t={t}
      />

      {pickerState ? (
        <ReferencePicker
          visible
          onClose={() => setPickerState(null)}
          onPick={handlePickerSelect}
          allowed={pickerState.filter}
          documents={documents as PickerDocument[]}
          boards={boards as PickerBoard[]}
          users={users as PickerUser[]}
          folders={folders as PickerFolder[]}
          activeBricks={(activeBricks || bricks) as PickerActiveBrick[]}
        />
      ) : null}
    </View>
  );
};

function AddBrickModal({
  visible,
  commands,
  onClose,
  onPick,
  t,
}: {
  visible: boolean;
  commands: AddCommand[];
  onClose: () => void;
  onPick: (kind: AddableKind) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // Group commands by category, preserving the input order.
  const byCategory = useMemo(() => {
    const groups: Record<string, AddCommand[]> = {};
    for (const c of commands) {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category].push(c);
    }
    return groups;
  }, [commands]);

  // Mobile: language detection isn't wired here; default to ES (Vault's primary).
  const locale: 'es' | 'en' =
    Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.language
      ? (navigator.language.startsWith('en') ? 'en' : 'es')
      : 'es';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 items-center justify-center bg-background/80 p-4"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-xl border border-border bg-card p-3"
        >
          <View className="mb-2 flex-row items-center justify-between">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-sm text-foreground"
            >
              {t('addBlock')}
            </Text>
            <Pressable onPress={onClose} hitSlop={6}>
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {CATEGORY_ORDER.map((cat) => {
              const list = byCategory[cat];
              if (!list || list.length === 0) return null;
              return (
                <View key={cat} style={{ marginBottom: 8 }}>
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {categoryLabel(cat, locale)}
                  </Text>
                  {list.map((c) => {
                    const Icon = c.icon;
                    return (
                      <Pressable
                        key={c.kind}
                        onPress={() => onPick(c.kind)}
                        className="flex-row items-center gap-3 rounded-md px-2 py-2 active:bg-secondary"
                      >
                        <View
                          className="h-9 w-9 items-center justify-center rounded-md border border-border bg-background"
                        >
                          <Icon size={14} color={colors.foreground} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ fontFamily: fonts.medium }}
                            className="text-sm text-foreground"
                          >
                            {t(c.labelKey)}
                          </Text>
                        </View>
                        <ChevronRight size={12} color={colors.mutedForeground} />
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Re-export prop types for siblings importing from this module.
export type { UnifiedBrickListProps, AddableKind, CrossContainerDropOptions };
