import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Calendar,
  Check,
  CircleDot,
  Hash,
  Link as LinkIcon,
  Plus,
  Square,
  Type as TypeIcon,
  X,
} from 'lucide-react-native';

import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * Mobile port of Killio-Frontend's `unified-bountiful-table.tsx` (5k+ LOC).
 * We don't try to mirror every cell type the web supports — the high-value
 * ones for read+edit on mobile are:
 *
 *   text, number, checkbox, url, date, select, multi_select, status
 *
 * The rest (people, document, board, card, popup_document, formula, rollup,
 * relation, created_*, last_edited_*) render as a read-only label that the
 * web app's full editor can mutate; mobile preserves the cell payload as-is
 * so a round-trip via API keeps unfamiliar fields intact.
 *
 * Layout: rows are vertical "cards" (the mobile board-row layout) so cells
 * stack well on narrow screens. Each cell tap opens the right inline editor
 * (text input, checkbox toggle, date picker stub, select chips). Patches go
 * out via `onPatchCell(rowId, colId, cell, rowMeta)` so the backend deltas
 * (`brick.cell_patched` over Pulse) hit the network exactly like the web.
 */

export interface BountifulColumn {
  id: string;
  name: string;
  type: string; // 'title' | 'text' | 'rich_text' | 'number' | 'checkbox' | 'url' | 'date' | 'select' | 'status' | 'multi_select' | 'email' | 'phone_number' | …
  options?: { id: string; name: string; color: string; isDefault?: boolean }[];
  statusGroups?: { name: string; color: string; optionIds: string[] }[];
  hidden?: boolean;
  width?: number;
  numberFormat?: {
    currency?: string;
    decimals?: number;
    display?: string;
  };
  dateFormat?: { format?: string; includeTime?: boolean };
  checkboxStyle?: { color?: string; gantt?: boolean; label?: string };
}

export interface BountifulCell {
  type: string;
  text?: string;
  name?: string;
  color?: string;
  items?: { name: string; color: string }[];
  checked?: boolean;
  start?: string;
  end?: string;
  url?: string;
  number?: number;
  value?: string;
}

export interface BountifulRow {
  id: string;
  cells: Record<string, BountifulCell | null>;
  _createdAt?: string;
  _lastEditedAt?: string;
  _createdBy?: string;
  _lastEditedBy?: string;
}

interface Props {
  brickId: string;
  title?: string;
  columns: BountifulColumn[];
  rows: BountifulRow[];
  readonly?: boolean;
  /** Cell patch — wire to the backend so other clients see the delta. */
  onPatchCell?: (
    rowId: string,
    colId: string,
    cell: BountifulCell,
    rowMeta: { _lastEditedAt: string; _lastEditedBy: string },
  ) => void;
  /** Whole content rewrite (column add/remove, row add, title edit). */
  onUpdate?: (next: {
    title?: string;
    columns: BountifulColumn[];
    rows: BountifulRow[];
  }) => void;
}

const COLOR_PRESETS = ['#22d3ee', '#a5b4fc', '#fcd34d', '#86efac', '#f9a8d4', '#fb923c'];

export function BountifulTable({
  brickId,
  title,
  columns,
  rows,
  readonly,
  onPatchCell,
  onUpdate,
}: Props) {
  const t = useTranslations('bountiful');
  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);

  const patchCell = (rowId: string, colId: string, cell: BountifulCell) => {
    if (readonly || !onPatchCell) return;
    const now = new Date().toISOString();
    onPatchCell(rowId, colId, cell, { _lastEditedAt: now, _lastEditedBy: 'me' });
  };

  const addRow = () => {
    if (readonly || !onUpdate) return;
    const id = `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onUpdate({
      title,
      columns,
      rows: [...rows, { id, cells: {} }],
    });
  };

  const addColumn = () => {
    if (readonly || !onUpdate) return;
    const id = `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onUpdate({
      title,
      columns: [...columns, { id, name: t('newColumn'), type: 'text' }],
      rows,
    });
  };

  return (
    <View className="my-1 gap-2 rounded-xl border border-border bg-card p-2">
      <View className="flex-row items-center justify-between px-1">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-xs uppercase tracking-widest text-muted-foreground"
        >
          {title ?? t('table')}
        </Text>
        {!readonly ? (
          <Pressable onPress={addRow} hitSlop={6} className="rounded-md border border-border bg-background px-2 py-1">
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
              + {t('row')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {rows.length === 0 ? (
        <Text className="px-2 py-3 text-xs text-muted-foreground italic">{t('empty')}</Text>
      ) : (
        rows.map((row, ri) => (
          <View
            key={row.id}
            className="gap-1 rounded-lg border border-border/40 bg-background p-2"
          >
            {visibleColumns.map((col, ci) => {
              const cell = row.cells?.[col.id] ?? null;
              return (
                <Cell
                  key={col.id}
                  column={col}
                  cell={cell}
                  readonly={!!readonly}
                  isEditing={editing?.rowId === row.id && editing?.colId === col.id}
                  onPress={() => setEditing({ rowId: row.id, colId: col.id })}
                  onClose={() => setEditing(null)}
                  onChange={(next) => patchCell(row.id, col.id, next)}
                />
              );
            })}
          </View>
        ))
      )}

      {!readonly ? (
        <Pressable
          onPress={addColumn}
          className="self-start flex-row items-center gap-1 rounded-md border border-dashed border-cyan/40 px-2 py-1"
        >
          <Plus size={10} color={colors.cyan} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
            {t('column')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Cell renderer ──────────────────────────────────────────────────────────

function Cell({
  column,
  cell,
  readonly,
  isEditing,
  onPress,
  onClose,
  onChange,
}: {
  column: BountifulColumn;
  cell: BountifulCell | null;
  readonly: boolean;
  isEditing: boolean;
  onPress(): void;
  onClose(): void;
  onChange(next: BountifulCell): void;
}) {
  const t = useTranslations('bountiful');
  const colType = column.type;

  // Read row: column name + value chip
  const valueNode = renderValue(column, cell, t);
  const Icon = iconFor(colType);

  return (
    <>
      <Pressable
        onPress={() => !readonly && onPress()}
        disabled={readonly}
        className="flex-row items-start gap-2 rounded-md px-2 py-1.5"
      >
        <View className="h-5 w-5 items-center justify-center">
          <Icon size={12} color={colors.mutedForeground} />
        </View>
        <Text
          style={{ fontFamily: fonts.medium }}
          className="w-28 text-[11px] text-muted-foreground"
          numberOfLines={1}
        >
          {column.name}
        </Text>
        <View style={{ flex: 1 }}>{valueNode}</View>
      </Pressable>

      {/* Editor modal — type-aware */}
      <Modal visible={isEditing} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable onPress={onClose} className="flex-1 items-center justify-end bg-background/80">
          <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text style={{ fontFamily: fonts.bold }} className="text-sm text-foreground">
                {column.name}
              </Text>
              <Pressable onPress={onClose} hitSlop={6}>
                <X size={14} color={colors.foreground} />
              </Pressable>
            </View>
            <CellEditor column={column} cell={cell} onChange={onChange} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function renderValue(
  col: BountifulColumn,
  cell: BountifulCell | null,
  t: ReturnType<typeof useTranslations>,
) {
  if (!cell) return <Text className="text-[11px] text-muted-foreground italic">{t('empty')}</Text>;
  const ct = canonicalType(col.type);
  if (ct === 'checkbox') {
    return cell.checked ? (
      <View className="flex-row items-center gap-1">
        <Check size={12} color={colors.success} />
        {col.checkboxStyle?.label ? (
          <Text className="text-xs text-foreground">{col.checkboxStyle.label}</Text>
        ) : null}
      </View>
    ) : (
      <Square size={12} color={colors.mutedForeground} />
    );
  }
  if (ct === 'select' || ct === 'status') {
    const opt = (col.options ?? []).find((o) => o.name === (cell.name ?? cell.value));
    const color = opt?.color ?? cell.color ?? colors.mutedForeground;
    const label = cell.name ?? cell.value ?? '';
    if (!label) return <Text className="text-[11px] text-muted-foreground italic">{t('empty')}</Text>;
    return (
      <View
        className="self-start rounded-full px-2 py-0.5"
        style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}55` }}
      >
        <Text style={{ fontFamily: fonts.semibold, color }} className="text-[10px]">
          {label}
        </Text>
      </View>
    );
  }
  if (ct === 'multi_select') {
    const items = cell.items ?? [];
    if (items.length === 0)
      return <Text className="text-[11px] text-muted-foreground italic">{t('empty')}</Text>;
    return (
      <View className="flex-row flex-wrap gap-1">
        {items.map((it, i) => (
          <View
            key={i}
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: `${it.color}22`, borderWidth: 1, borderColor: `${it.color}55` }}
          >
            <Text style={{ fontFamily: fonts.semibold, color: it.color }} className="text-[10px]">
              {it.name}
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (ct === 'number') {
    return (
      <Text style={{ fontFamily: fonts.mono }} className="text-xs text-foreground">
        {formatNumber(cell.number, col)}
      </Text>
    );
  }
  if (ct === 'url') {
    return (
      <Text className="text-xs text-cyan underline" numberOfLines={1}>
        {cell.url ?? ''}
      </Text>
    );
  }
  if (ct === 'date') {
    const d = cell.start ?? '';
    if (!d) return <Text className="text-[11px] text-muted-foreground italic">{t('empty')}</Text>;
    return (
      <Text style={{ fontFamily: fonts.mono }} className="text-xs text-foreground">
        {formatDate(d, col)}
      </Text>
    );
  }
  // text + everything else → plain text fallback
  return (
    <Text className="text-xs text-foreground" numberOfLines={3}>
      {cell.text ?? cell.value ?? ''}
    </Text>
  );
}

function CellEditor({
  column,
  cell,
  onChange,
}: {
  column: BountifulColumn;
  cell: BountifulCell | null;
  onChange(next: BountifulCell): void;
}) {
  const t = useTranslations('bountiful');
  const ct = canonicalType(column.type);
  const cur = cell ?? { type: ct };

  if (ct === 'checkbox') {
    return (
      <Pressable
        onPress={() => onChange({ ...cur, type: 'checkbox', checked: !cur.checked })}
        className="flex-row items-center gap-2 rounded-md border border-border bg-background p-3"
      >
        {cur.checked ? (
          <Check size={14} color={colors.success} />
        ) : (
          <Square size={14} color={colors.mutedForeground} />
        )}
        <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
          {column.checkboxStyle?.label ?? t('toggle')}
        </Text>
      </Pressable>
    );
  }

  if (ct === 'select' || ct === 'status') {
    return (
      <View className="flex-row flex-wrap gap-2">
        {(column.options ?? []).map((opt) => {
          const active = cur.name === opt.name;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onChange({ ...cur, type: 'select', name: opt.name, color: opt.color })}
              className={`rounded-full px-3 py-1 ${active ? 'border-2' : 'border'}`}
              style={{
                backgroundColor: `${opt.color}22`,
                borderColor: `${opt.color}${active ? 'cc' : '55'}`,
              }}
            >
              <Text style={{ fontFamily: fonts.semibold, color: opt.color }} className="text-xs">
                {opt.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (ct === 'multi_select') {
    const items = cur.items ?? [];
    return (
      <View className="flex-row flex-wrap gap-2">
        {(column.options ?? []).map((opt) => {
          const active = items.some((i) => i.name === opt.name);
          return (
            <Pressable
              key={opt.id}
              onPress={() => {
                const next = active
                  ? items.filter((i) => i.name !== opt.name)
                  : [...items, { name: opt.name, color: opt.color }];
                onChange({ ...cur, type: 'multi_select', items: next });
              }}
              className={`rounded-full px-3 py-1 ${active ? 'border-2' : 'border'}`}
              style={{
                backgroundColor: `${opt.color}22`,
                borderColor: `${opt.color}${active ? 'cc' : '55'}`,
              }}
            >
              <Text style={{ fontFamily: fonts.semibold, color: opt.color }} className="text-xs">
                {opt.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (ct === 'number') {
    return (
      <TextInput
        value={cur.number !== undefined ? String(cur.number) : ''}
        onChangeText={(v) => {
          const n = parseFloat(v.replace(',', '.'));
          onChange({ ...cur, type: 'number', number: isNaN(n) ? undefined : n });
        }}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.mutedForeground}
        style={{ fontFamily: fonts.mono }}
        className="h-12 rounded-md border border-border bg-background px-3 text-foreground"
      />
    );
  }

  if (ct === 'url') {
    return (
      <TextInput
        value={cur.url ?? ''}
        onChangeText={(v) => onChange({ ...cur, type: 'url', url: v })}
        placeholder="https://…"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{ fontFamily: fonts.mono }}
        className="h-12 rounded-md border border-border bg-background px-3 text-foreground"
      />
    );
  }

  if (ct === 'date') {
    return (
      <TextInput
        value={cur.start ?? ''}
        onChangeText={(v) => onChange({ ...cur, type: 'date', start: v })}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ fontFamily: fonts.mono }}
        className="h-12 rounded-md border border-border bg-background px-3 text-foreground"
      />
    );
  }

  // text + email + phone + everything else → free-form text
  return (
    <TextInput
      value={cur.text ?? cur.value ?? ''}
      onChangeText={(v) => onChange({ ...cur, type: 'text', text: v })}
      placeholder={column.name}
      placeholderTextColor={colors.mutedForeground}
      multiline
      style={{ fontFamily: fonts.regular, minHeight: 60 }}
      className="rounded-md border border-border bg-background p-2 text-sm text-foreground"
    />
  );
}

// ─── Helpers (canonical type, formatters, icons) ────────────────────────────

function canonicalType(colType: string): string {
  switch (colType) {
    case 'title':
    case 'rich_text':
    case 'email':
    case 'phone_number':
    case 'formula':
    case 'rollup':
      return 'text';
    case 'status':
      return 'status';
    case 'created_time':
    case 'last_edited_time':
      return 'date';
    case 'created_by':
    case 'last_edited_by':
    case 'people':
      return 'user';
    case 'relation':
      return 'document';
    default:
      return colType || 'text';
  }
}

function iconFor(colType: string) {
  switch (canonicalType(colType)) {
    case 'checkbox':
      return Square;
    case 'number':
      return Hash;
    case 'url':
      return LinkIcon;
    case 'date':
      return Calendar;
    case 'select':
    case 'status':
    case 'multi_select':
      return CircleDot;
    default:
      return TypeIcon;
  }
}

function formatNumber(n: number | undefined, col: BountifulColumn): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  const fmt = col.numberFormat || {};
  const dec =
    typeof fmt.decimals === 'number'
      ? { minimumFractionDigits: fmt.decimals, maximumFractionDigits: fmt.decimals }
      : undefined;
  if (fmt.currency === 'percent') return `${n.toLocaleString('es-PE', dec)}%`;
  const symMap: Record<string, string> = {
    pen: 'S/',
    usd: '$',
    eur: '€',
    gbp: '£',
    jpy: '¥',
    brl: 'R$',
  };
  const sym = fmt.currency ? symMap[fmt.currency] : undefined;
  const num = n.toLocaleString('es-PE', dec);
  return sym ? `${sym} ${num}` : num;
}

function formatDate(iso: string, col: BountifulColumn): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const includeTime = col.dateFormat?.includeTime ?? false;
    if (col.dateFormat?.format === 'iso') return d.toISOString();
    if (includeTime) return d.toLocaleString();
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

void COLOR_PRESETS;
