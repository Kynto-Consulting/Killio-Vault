import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronDown,
  Clipboard,
  ClipboardPaste,
  Code,
  Copy,
  FileText,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Plus,
  Quote,
  Trash2,
  Type,
  X,
} from 'lucide-react-native';

import { BrickRenderer, type Brick } from './BrickRenderer';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * Vault's mobile-native answer to the web UnifiedBrickList. We don't try to
 * port @dnd-kit (web-only) or contenteditable; instead the editor exposes the
 * same end-user actions through tap / long-press / a bottom action bar:
 *
 *   - Tap a brick      → focus inline editing (delegated to BrickRenderer)
 *   - Long-press       → enter multi-select mode with that brick selected
 *   - Tap in select    → toggle the brick's selection
 *   - "+" between rows → insert kind picker (text/heading/quote/callout/
 *                        checklist/code/divider/…)
 *   - Action bar       → up / down / copy / paste / delete / clear
 *
 * Text bricks stay on the experimental inline editor in BrickRenderer
 * (canEdit + onChange); we never round-trip through markdown.
 */
export type BrickKind =
  | 'text'
  | 'heading'
  | 'quote'
  | 'callout'
  | 'checklist'
  | 'code'
  | 'divider';

export interface BrickEditorProps {
  bricks: Brick[];
  /** Persist a single brick's content change (called per keystroke debounce). */
  onUpdateBrick: (brickId: string, next: Brick) => void;
  /** Persist a new brick added after `afterBrickId` (or at the end if undef). */
  onAddBrick: (kind: BrickKind, afterBrickId?: string) => Promise<string | void> | string | void;
  /** Delete the brick by id. */
  onDeleteBrick: (brickId: string) => void;
  /** Reorder: full ordered list of brick ids after the change. */
  onReorderBricks: (orderedIds: string[]) => void;
}

interface KindOption {
  kind: BrickKind;
  label: string;
  icon: typeof Type;
}

const KIND_OPTIONS: KindOption[] = [
  { kind: 'text', label: 'Texto', icon: Type },
  { kind: 'heading', label: 'Encabezado', icon: Heading1 },
  { kind: 'quote', label: 'Cita', icon: Quote },
  { kind: 'callout', label: 'Callout', icon: Hash },
  { kind: 'checklist', label: 'Checklist', icon: CheckSquare },
  { kind: 'code', label: 'Código', icon: Code },
  { kind: 'divider', label: 'Divisor', icon: Minus },
];

export function BrickEditor({
  bricks,
  onUpdateBrick,
  onAddBrick,
  onDeleteBrick,
  onReorderBricks,
}: BrickEditorProps) {
  const sorted = useMemo(
    () => [...bricks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [bricks],
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<Brick[]>([]);
  const [addMenuFor, setAddMenuFor] = useState<string | 'end' | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const selectMode = selection.size > 0;

  const toggleSelect = (id: string) =>
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelection(new Set());

  const selectedSorted = sorted.filter((b) => b.id && selection.has(b.id));

  const move = (dir: 'up' | 'down') => {
    if (!selectMode) return;
    const ids = sorted.map((b) => b.id!).filter(Boolean);
    const selIds = selectedSorted.map((b) => b.id!);
    if (selIds.length === 0) return;
    const reordered = reorderIds(ids, selIds, dir);
    if (reordered) onReorderBricks(reordered);
  };

  const copy = () => {
    if (!selectMode) return;
    setClipboard(selectedSorted.map((b) => ({ ...b, content: { ...b.content } })));
  };

  const paste = async () => {
    if (clipboard.length === 0) return;
    const anchor =
      selectedSorted.length > 0 ? selectedSorted[selectedSorted.length - 1].id : undefined;
    let after = anchor ?? sorted[sorted.length - 1]?.id;
    for (const b of clipboard) {
      const newId = await onAddBrick((b.kind as BrickKind) ?? 'text', after);
      if (typeof newId === 'string') {
        after = newId;
        // Persist the copied content right after creation
        onUpdateBrick(newId, { ...b, id: newId });
      }
    }
  };

  const remove = () => {
    if (!selectMode) return;
    for (const id of selection) onDeleteBrick(id);
    clearSelection();
  };

  return (
    <View className="gap-2">
      {/* Top selection toolbar */}
      {selectMode ? (
        <View className="flex-row items-center justify-between rounded-xl border border-cyan/40 bg-cyan/10 px-3 py-2">
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-xs text-cyan"
          >
            {selection.size} seleccionado{selection.size === 1 ? '' : 's'}
          </Text>
          <Pressable onPress={clearSelection} hitSlop={8}>
            <X size={14} color={colors.cyan} />
          </Pressable>
        </View>
      ) : null}

      {/* Bricks + inline + slots */}
      {sorted.length === 0 ? (
        <Pressable
          onPress={() => setAddMenuFor('end')}
          className="items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-4 py-8"
        >
          <View className="mb-2 h-8 w-8 items-center justify-center rounded-full bg-cyan/10">
            <Plus size={14} color={colors.cyan} />
          </View>
          <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
            Añadir bloque
          </Text>
        </Pressable>
      ) : null}

      {sorted.map((b) => {
        const selected = b.id ? selection.has(b.id) : false;
        return (
          <View key={b.id ?? String(b.position)}>
            <Pressable
              onLongPress={() => b.id && toggleSelect(b.id)}
              onPress={() => {
                if (selectMode && b.id) {
                  toggleSelect(b.id);
                  return;
                }
                if (b.id) setFocused(b.id);
              }}
              className={`rounded-lg border ${
                selected
                  ? 'border-cyan bg-cyan/5'
                  : focused === b.id
                    ? 'border-foreground/30 bg-background'
                    : 'border-transparent'
              } px-1 py-1`}
            >
              <BrickRenderer
                brick={b}
                canEdit={!selectMode}
                onChange={(next) => b.id && onUpdateBrick(b.id, next)}
              />
            </Pressable>

            {/* "+" between rows */}
            {!selectMode && b.id ? (
              <Pressable
                onPress={() => setAddMenuFor(b.id!)}
                className="my-0.5 flex-row items-center gap-1 self-center rounded-full bg-secondary/60 px-2 py-0.5 opacity-60"
              >
                <Plus size={10} color={colors.mutedForeground} />
                <Text className="text-[10px] text-muted-foreground">añadir</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {/* Trailing "+ add at end" */}
      {!selectMode && sorted.length > 0 ? (
        <Pressable
          onPress={() => setAddMenuFor('end')}
          className="mt-2 flex-row items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-card/40 py-2"
        >
          <Plus size={12} color={colors.mutedForeground} />
          <Text style={{ fontFamily: fonts.medium }} className="text-xs text-muted-foreground">
            Añadir al final
          </Text>
        </Pressable>
      ) : null}

      {/* Bottom action bar */}
      {selectMode ? (
        <View className="mt-2 flex-row items-center justify-around rounded-xl border border-border bg-card px-2 py-2">
          <ActionBtn icon={ArrowUp} label="Subir" onPress={() => move('up')} />
          <ActionBtn icon={ArrowDown} label="Bajar" onPress={() => move('down')} />
          <ActionBtn icon={Copy} label="Copiar" onPress={copy} />
          <ActionBtn
            icon={ClipboardPaste}
            label="Pegar"
            onPress={paste}
            disabled={clipboard.length === 0}
            badge={clipboard.length || undefined}
          />
          <ActionBtn
            icon={Trash2}
            label="Eliminar"
            onPress={remove}
            tone="danger"
          />
        </View>
      ) : null}

      {/* Add-kind picker modal */}
      <Modal
        visible={addMenuFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAddMenuFor(null)}
      >
        <Pressable
          onPress={() => setAddMenuFor(null)}
          className="flex-1 items-center justify-end bg-background/80"
        >
          <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-2">
            <Text
              style={{ fontFamily: fonts.bold }}
              className="text-base text-foreground"
            >
              Añadir bloque
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2 py-1"
            >
              {KIND_OPTIONS.map(({ kind, label, icon: Icon }) => (
                <Pressable
                  key={kind}
                  onPress={async () => {
                    const after = addMenuFor === 'end' ? undefined : (addMenuFor as string);
                    setAddMenuFor(null);
                    await onAddBrick(kind, after);
                  }}
                  className="h-20 w-20 items-center justify-center gap-1 rounded-xl border border-border bg-background"
                >
                  <Icon size={18} color={colors.foreground} />
                  <Text style={{ fontFamily: fonts.medium }} className="text-[10px] text-foreground">
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onPress,
  disabled,
  tone,
  badge,
}: {
  icon: typeof Type;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'danger';
  badge?: number;
}) {
  const color = tone === 'danger' ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center gap-1 px-2 py-1 ${disabled ? 'opacity-40' : ''}`}
    >
      <View className="flex-row items-center gap-1">
        <Icon size={16} color={color} />
        {badge ? (
          <View className="h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan">
            <Text style={{ fontFamily: fonts.bold }} className="text-[8px] text-background">
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        style={{ fontFamily: fonts.medium, color }}
        className="text-[10px]"
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Returns a new id list where the contiguous group of `selectedIds` is moved
 * one position toward `dir`. Non-contiguous selections move as a block by
 * pulling them out, then splicing them back in at the new index. Returns
 * `null` when the move would be a no-op (already at the boundary).
 */
export function reorderIds(
  ids: string[],
  selectedIds: string[],
  dir: 'up' | 'down',
): string[] | null {
  if (selectedIds.length === 0) return null;
  const selSet = new Set(selectedIds);
  const rest = ids.filter((id) => !selSet.has(id));
  const indices = ids
    .map((id, i) => (selSet.has(id) ? i : -1))
    .filter((i) => i >= 0);
  const firstIdx = indices[0];
  const lastIdx = indices[indices.length - 1];
  if (dir === 'up' && firstIdx === 0) return null;
  if (dir === 'down' && lastIdx === ids.length - 1) return null;
  const restIndexBefore = rest.findIndex(
    (id) => ids.indexOf(id) > (dir === 'up' ? firstIdx : lastIdx),
  );
  // Compute insertion point in `rest` so the block lands one slot toward dir.
  let insertAt =
    dir === 'up'
      ? rest.findIndex((id) => ids.indexOf(id) > firstIdx - 1)
      : (restIndexBefore < 0 ? rest.length : restIndexBefore);
  if (dir === 'up') insertAt = Math.max(0, insertAt - 1);
  const block = ids.filter((id) => selSet.has(id));
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}
