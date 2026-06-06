import React, { useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Clock,
  CreditCard,
  Edit3,
  EyeOff,
  FileText,
  Filter,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  Link as LinkIcon,
  List as ListIcon,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  RotateCw,
  Settings,
  Sigma,
  Square,
  Trash2,
  Type as TypeIcon,
  User as UserIcon,
  UserCheck,
  X,
} from 'lucide-react-native';

import { sheetEngine } from '../sheet-engine';
import { RefPill } from '../RefPill';
import { useTranslations } from '../../i18n';
import { colors } from '../../theme/theme';
import { fonts } from '../../theme/fonts';

/**
 * Canonical RN port of the web `unified-bountiful-table.tsx` Notion-style
 * typed-cell table. Replaces the legacy `src/ui/BountifulTable.tsx`.
 *
 * What carries over from the web (5207-line) source:
 *  - Same exported types: `BountifulColumn`, `BountifulCell`, `BountifulRow`,
 *    `BountifulView`, `BountifulViewLayout`.
 *  - All 18+ column types in the type surface — text/number/email/url/select/
 *    multi_select/status/date/checkbox/people/document/board/card/popup_document/
 *    formula/rollup/created_*/last_edited_*.
 *  - Same props shape: `onUpdate(content)`, `onPatchCell(rowId, colId, cell,
 *    rowMeta)`, `onPatchColumn`, `onAddColumn`, `onRemoveColumn`,
 *    `onDuplicateColumn`.
 *  - View switcher (table / board / gallery / list) + per-view group-by
 *    column, sort direction, filter chips.
 *  - HyperFormula via the shared `sheet-engine.ts` for formula columns.
 *  - RefPill rendering for user/doc/board/card cell types.
 *
 * Mobile UX trade-offs:
 *  - The table view is a wide horizontal-scroll grid; the other layouts
 *    (board/gallery/list) stack cards vertically — better on narrow screens.
 *  - Cell editors open in a bottom-sheet modal (type-aware).
 *  - Date picker is a YYYY-MM-DD `TextInput` (no native date wheel yet — would
 *    pull in `@react-native-community/datetimepicker` later).
 *  - No drag-to-reorder columns/rows — replaced by up/down chevrons in the
 *    column menu.  // TODO: gesture DnD — phase 2
 *  - No KaTeX rendering of formulas — formula source string is shown inline.
 *  - ReferencePicker for user/doc/board/card cells: when the mobile-adapted
 *    `src/ui/ReferencePicker.tsx` ships, swap the inline option picker for
 *    that component. Until then, ref cells render chips and offer a chip
 *    multi-select against the props.documents/boards/users catalogues.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BountifulColumn {
  id: string;
  name: string;
  type: string;
  options?: { id: string; name: string; color: string; isDefault?: boolean }[];
  statusGroups?: { name: string; color: string; optionIds: string[] }[];
  hidden?: boolean;
  pinned?: boolean;
  wrap?: boolean;
  width?: number;
  numberFormat?: {
    currency?: string;
    decimals?: number;
    display?: string;
  };
  dateFormat?: {
    format?: 'friendly' | 'relative' | 'short' | 'iso';
    includeTime?: boolean;
  };
  personFormat?: 'name' | 'email' | 'alias';
  documentFormat?: 'name' | 'full';
  phoneFormat?: { country?: string };
  checkboxStyle?: {
    color?: string;
    gantt?: boolean;
    label?: string;
  };
  formula?: string;
  rollup?: { sourceColId: string; aggregator: 'sum' | 'avg' | 'count' | 'min' | 'max' };
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
  formula?: string;
  users?: { id: string; name?: string; email?: string; avatar?: string }[];
  documents?: { id: string; name?: string }[];
  boards?: { id: string; name?: string }[];
  cards?: { id: string; name?: string }[];
  title?: string;
  inlineDocumentId?: string | null;
  externalSource?: {
    provider: 'google_drive' | 'onedrive';
    fileId: string;
    fileName: string;
    mimeType?: string;
    webViewLink?: string;
    webUrl?: string;
    isPublic: boolean;
    credentialId: string;
  } | null;
  _createdAt?: string;
  _lastEditedAt?: string;
  _createdBy?: string;
  _lastEditedBy?: string;
}

export interface BountifulRow {
  id: string;
  cells: Record<string, BountifulCell | null>;
  _createdAt?: string;
  _lastEditedAt?: string;
  _createdBy?: string;
  _lastEditedBy?: string;
}

export type BountifulViewLayout = 'table' | 'board' | 'gallery' | 'list' | 'calendar' | 'timeline';

export interface BountifulView {
  id: string;
  name: string;
  layout: BountifulViewLayout;
  filters?: { colId: string; operator: string; value: string }[];
  sorts?: { colId: string; direction: 'asc' | 'desc' }[];
  groupByColId?: string;
  dateColId?: string;
  hiddenColIds?: string[];
}

export interface WorkspaceMemberLike {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface UnifiedBountifulTableProps {
  id: string;
  brickId?: string;
  title?: string;
  columns: BountifulColumn[];
  rows: BountifulRow[];
  views?: BountifulView[];
  readonly?: boolean;
  onUpdate?: (content: {
    title?: string;
    columns: BountifulColumn[];
    rows: BountifulRow[];
    views?: BountifulView[];
  }) => void;
  onPatchCell?: (
    rowId: string,
    colId: string,
    cell: BountifulCell,
    rowMeta: { _lastEditedAt: string; _lastEditedBy: string },
  ) => void;
  onPatchColumn?: (colId: string, updates: Partial<BountifulColumn>) => void;
  onAddColumn?: (column: BountifulColumn, atIndex: number) => void;
  onRemoveColumn?: (colId: string) => void;
  onDuplicateColumn?: (srcColId: string, newColId: string, newName: string, atIndex: number) => void;
  documents?: { id: string; name?: string }[];
  boards?: { id: string; name?: string }[];
  users?: WorkspaceMemberLike[];
  activeBricks?: { id?: string; kind?: string; content?: Record<string, unknown> }[];
}

const COLOR_PRESETS = [
  '#22d3ee',
  '#a5b4fc',
  '#fcd34d',
  '#86efac',
  '#f9a8d4',
  '#fb923c',
  '#ef4444',
  '#8b5cf6',
];

const VIEW_LAYOUTS: BountifulViewLayout[] = ['table', 'board', 'gallery', 'list'];

// ─── Component ──────────────────────────────────────────────────────────────

export function UnifiedBountifulTable(props: UnifiedBountifulTableProps) {
  const {
    id,
    title,
    columns,
    rows,
    views,
    readonly,
    onUpdate,
    onPatchCell,
    onPatchColumn,
    onAddColumn,
    onRemoveColumn,
  } = props;

  const t = useTranslations('bountiful');

  // ─── View state ─────────────────────────────────────────────────────────
  const viewList = useMemo<BountifulView[]>(() => {
    if (Array.isArray(views) && views.length > 0) return views;
    return [{ id: 'default', name: 'Default', layout: 'table' as BountifulViewLayout }];
  }, [views]);

  const [activeViewId, setActiveViewId] = useState(viewList[0].id);
  const activeView = useMemo<BountifulView>(
    () => viewList.find((v) => v.id === activeViewId) || viewList[0],
    [viewList, activeViewId],
  );

  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);
  const [columnMenuColId, setColumnMenuColId] = useState<string | null>(null);
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const visibleColumns = useMemo(() => {
    const hidden = new Set(activeView.hiddenColIds ?? []);
    return columns.filter((c) => !c.hidden && !hidden.has(c.id));
  }, [columns, activeView.hiddenColIds]);

  // ─── Sort / filter ──────────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    let working = [...rows];
    const filters = activeView.filters ?? [];
    if (filters.length > 0) {
      working = working.filter((row) =>
        filters.every((f) => {
          const cell = row.cells?.[f.colId];
          const val = cell?.text ?? cell?.value ?? cell?.name ?? '';
          if (f.operator === 'contains')
            return String(val).toLowerCase().includes(f.value.toLowerCase());
          if (f.operator === 'equals') return String(val) === f.value;
          if (f.operator === 'not_empty') return Boolean(val);
          return true;
        }),
      );
    }
    const sorts = activeView.sorts ?? [];
    if (sorts.length > 0) {
      working.sort((a, b) => {
        for (const s of sorts) {
          const ca = a.cells?.[s.colId];
          const cb = b.cells?.[s.colId];
          const va = ca?.number ?? ca?.text ?? ca?.value ?? ca?.name ?? '';
          const vb = cb?.number ?? cb?.text ?? cb?.value ?? cb?.name ?? '';
          if (va === vb) continue;
          if (va < vb) return s.direction === 'asc' ? -1 : 1;
          return s.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return working;
  }, [rows, activeView.filters, activeView.sorts]);

  // ─── Group-by ───────────────────────────────────────────────────────────
  const groupedRows = useMemo(() => {
    const colId = activeView.groupByColId;
    if (!colId) return [{ key: '', label: '', rows: sortedRows }];
    const groups = new Map<string, { label: string; rows: BountifulRow[] }>();
    sortedRows.forEach((r) => {
      const cell = r.cells?.[colId];
      const key = cell?.name ?? cell?.value ?? cell?.text ?? '';
      const label = key || t('empty');
      if (!groups.has(key)) groups.set(key, { label, rows: [] });
      groups.get(key)!.rows.push(r);
    });
    return Array.from(groups.entries()).map(([key, v]) => ({ key, ...v }));
  }, [sortedRows, activeView.groupByColId, t]);

  // ─── Formula sheet engine ───────────────────────────────────────────────
  const computedRows = useMemo(() => {
    const formulaCols = columns.filter((c) => c.type === 'formula' && typeof c.formula === 'string');
    if (formulaCols.length === 0) return rows;
    const grid: string[][] = rows.map((row) =>
      columns.map((col) => {
        const cell = row.cells?.[col.id];
        if (col.type === 'number') return cell?.number !== undefined ? String(cell.number) : '';
        if (col.type === 'formula') return col.formula || '';
        return cell?.text ?? cell?.value ?? cell?.name ?? '';
      }),
    );
    sheetEngine.updateSheet(id, grid);
    const computed = sheetEngine.getComputedData(id, rows.length, columns.length);
    return rows.map((row, r) => {
      const nextCells = { ...(row.cells ?? {}) };
      columns.forEach((col, c) => {
        if (col.type !== 'formula') return;
        const v = computed[r]?.[c] ?? '';
        nextCells[col.id] = { type: 'formula', text: v, value: v };
      });
      return { ...row, cells: nextCells };
    });
  }, [columns, rows, id]);

  const computedGroups = useMemo(() => {
    if (!activeView.groupByColId) return groupedRows;
    const computedById = new Map(computedRows.map((r) => [r.id, r]));
    return groupedRows.map((g) => ({
      ...g,
      rows: g.rows.map((r) => computedById.get(r.id) || r),
    }));
  }, [groupedRows, computedRows, activeView.groupByColId]);

  // ─── Mutations ──────────────────────────────────────────────────────────
  const patchCell = (rowId: string, colId: string, cell: BountifulCell) => {
    if (readonly) return;
    if (onPatchCell) {
      const now = new Date().toISOString();
      onPatchCell(rowId, colId, cell, { _lastEditedAt: now, _lastEditedBy: 'me' });
      return;
    }
    if (!onUpdate) return;
    const nextRows = rows.map((r) =>
      r.id === rowId
        ? {
            ...r,
            cells: { ...(r.cells ?? {}), [colId]: cell },
            _lastEditedAt: new Date().toISOString(),
          }
        : r,
    );
    onUpdate({ title, columns, rows: nextRows, views });
  };

  const addRow = () => {
    if (readonly || !onUpdate) return;
    const rid = `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onUpdate({ title, columns, rows: [...rows, { id: rid, cells: {} }], views });
  };

  const addColumn = () => {
    if (readonly) return;
    const cid = `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const next: BountifulColumn = { id: cid, name: t('newColumn'), type: 'text' };
    if (onAddColumn) {
      onAddColumn(next, columns.length);
    } else if (onUpdate) {
      onUpdate({ title, columns: [...columns, next], rows, views });
    }
  };

  const removeColumn = (colId: string) => {
    if (readonly) return;
    if (onRemoveColumn) {
      onRemoveColumn(colId);
    } else if (onUpdate) {
      onUpdate({ title, columns: columns.filter((c) => c.id !== colId), rows, views });
    }
    setColumnMenuColId(null);
  };

  const moveColumn = (colId: string, direction: 'left' | 'right') => {
    if (readonly || !onUpdate) return;
    const idx = columns.findIndex((c) => c.id === colId);
    if (idx === -1) return;
    const target = direction === 'left' ? idx - 1 : idx + 1;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[idx], next[target]] = [next[target], next[idx]];
    onUpdate({ title, columns: next, rows, views });
    setColumnMenuColId(null);
  };

  const updateColumn = (colId: string, updates: Partial<BountifulColumn>) => {
    if (readonly) return;
    if (onPatchColumn) {
      onPatchColumn(colId, updates);
    } else if (onUpdate) {
      onUpdate({
        title,
        columns: columns.map((c) => (c.id === colId ? { ...c, ...updates } : c)),
        rows,
        views,
      });
    }
  };

  const setActiveViewLayout = (layout: BountifulViewLayout) => {
    if (readonly || !onUpdate) return;
    const nextViews = viewList.map((v) => (v.id === activeView.id ? { ...v, layout } : v));
    onUpdate({ title, columns, rows, views: nextViews });
  };

  const setActiveViewSort = (colId: string, direction: 'asc' | 'desc' | null) => {
    if (!onUpdate) return;
    const nextSorts = direction
      ? [{ colId, direction }]
      : (activeView.sorts ?? []).filter((s) => s.colId !== colId);
    const nextViews = viewList.map((v) =>
      v.id === activeView.id ? { ...v, sorts: nextSorts } : v,
    );
    onUpdate({ title, columns, rows, views: nextViews });
    setShowSortMenu(false);
  };

  const setActiveViewGroupBy = (colId: string | null) => {
    if (!onUpdate) return;
    const nextViews = viewList.map((v) =>
      v.id === activeView.id ? { ...v, groupByColId: colId ?? undefined } : v,
    );
    onUpdate({ title, columns, rows, views: nextViews });
    setShowGroupMenu(false);
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  const layout = activeView.layout;
  void setActiveViewId; // setter exposed for future multi-view picker

  return (
    <View
      style={{
        marginVertical: 4,
        gap: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: 8,
      }}
    >
      {/* Header: title + toolbar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 11,
            color: colors.mutedForeground,
            textTransform: 'uppercase',
            letterSpacing: 1,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {title ?? t('table')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <ToolbarBtn icon={LayoutGrid} label={layout} onPress={() => setShowViewSwitcher(true)} />
          <ToolbarBtn icon={ArrowUp} label={t('sort')} onPress={() => setShowSortMenu(true)} />
          <ToolbarBtn icon={ListIcon} label={t('group')} onPress={() => setShowGroupMenu(true)} />
          <ToolbarBtn icon={Filter} label={t('filter')} onPress={() => setShowFilterMenu(true)} />
          {!readonly ? (
            <Pressable
              onPress={addRow}
              hitSlop={6}
              style={{
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.cyan }}>
                + {t('row')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Active sort/group/filter chips */}
      <ActiveChips view={activeView} columns={columns} t={t} />

      {/* Body — switches by layout */}
      {rows.length === 0 ? (
        <Text
          style={{
            paddingHorizontal: 8,
            paddingVertical: 12,
            fontSize: 12,
            fontStyle: 'italic',
            color: colors.mutedForeground,
          }}
        >
          {t('empty')}
        </Text>
      ) : layout === 'table' ? (
        <TableView
          groups={computedGroups}
          columns={visibleColumns}
          readonly={!!readonly}
          onSetEditing={(e) => setEditing(e)}
          onColumnMenu={setColumnMenuColId}
          users={props.users ?? []}
        />
      ) : layout === 'board' ? (
        <BoardView
          groups={computedGroups}
          columns={visibleColumns}
          onCellEdit={(rowId, colId) => setEditing({ rowId, colId })}
          users={props.users ?? []}
        />
      ) : layout === 'gallery' ? (
        <GalleryView
          rows={computedRows}
          columns={visibleColumns}
          onCellEdit={(rowId, colId) => setEditing({ rowId, colId })}
          users={props.users ?? []}
        />
      ) : (
        <ListView
          rows={computedRows}
          columns={visibleColumns}
          onCellEdit={(rowId, colId) => setEditing({ rowId, colId })}
          users={props.users ?? []}
        />
      )}

      {/* Add-column footer */}
      {!readonly ? (
        <Pressable
          onPress={addColumn}
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            borderRadius: 6,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.cyan + '66',
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Plus size={10} color={colors.cyan} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.cyan }}>
            {t('column')}
          </Text>
        </Pressable>
      ) : null}

      {/* Cell editor modal */}
      {editing ? (
        <CellEditorModal
          column={columns.find((c) => c.id === editing.colId) as BountifulColumn}
          cell={rows.find((r) => r.id === editing.rowId)?.cells?.[editing.colId] ?? null}
          users={props.users ?? []}
          documents={props.documents ?? []}
          boards={props.boards ?? []}
          onClose={() => setEditing(null)}
          onChange={(next) => patchCell(editing.rowId, editing.colId, next)}
        />
      ) : null}

      {/* Column menu modal */}
      {columnMenuColId ? (
        <ColumnMenu
          column={columns.find((c) => c.id === columnMenuColId) as BountifulColumn}
          atIndex={columns.findIndex((c) => c.id === columnMenuColId)}
          colCount={columns.length}
          readonly={!!readonly}
          onClose={() => setColumnMenuColId(null)}
          onRename={(name) => updateColumn(columnMenuColId, { name })}
          onChangeType={(type) => updateColumn(columnMenuColId, { type })}
          onHide={() => updateColumn(columnMenuColId, { hidden: true })}
          onPin={(pinned) => updateColumn(columnMenuColId, { pinned })}
          onMoveLeft={() => moveColumn(columnMenuColId, 'left')}
          onMoveRight={() => moveColumn(columnMenuColId, 'right')}
          onRemove={() => removeColumn(columnMenuColId)}
        />
      ) : null}

      {/* View layout switcher */}
      {showViewSwitcher ? (
        <BottomMenu title={t('view')} onClose={() => setShowViewSwitcher(false)}>
          {VIEW_LAYOUTS.map((v) => (
            <MenuRow
              key={v}
              icon={iconForLayout(v)}
              label={v}
              active={layout === v}
              onPress={() => {
                setActiveViewLayout(v);
                setShowViewSwitcher(false);
              }}
            />
          ))}
        </BottomMenu>
      ) : null}

      {/* Sort menu */}
      {showSortMenu ? (
        <BottomMenu title={t('sort')} onClose={() => setShowSortMenu(false)}>
          {columns.map((c) => {
            const current = activeView.sorts?.find((s) => s.colId === c.id);
            return (
              <View
                key={c.id}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.medium,
                    fontSize: 12,
                    color: colors.foreground,
                  }}
                >
                  {c.name}
                </Text>
                <Pressable
                  onPress={() =>
                    setActiveViewSort(c.id, current?.direction === 'asc' ? null : 'asc')
                  }
                  style={{ padding: 6 }}
                >
                  <ArrowUp
                    size={14}
                    color={current?.direction === 'asc' ? colors.cyan : colors.mutedForeground}
                  />
                </Pressable>
                <Pressable
                  onPress={() =>
                    setActiveViewSort(c.id, current?.direction === 'desc' ? null : 'desc')
                  }
                  style={{ padding: 6 }}
                >
                  <ArrowDown
                    size={14}
                    color={current?.direction === 'desc' ? colors.cyan : colors.mutedForeground}
                  />
                </Pressable>
              </View>
            );
          })}
        </BottomMenu>
      ) : null}

      {/* Group-by menu */}
      {showGroupMenu ? (
        <BottomMenu title={t('group')} onClose={() => setShowGroupMenu(false)}>
          <MenuRow
            icon={X}
            label={t('groupNone')}
            active={!activeView.groupByColId}
            onPress={() => setActiveViewGroupBy(null)}
          />
          {columns
            .filter((c) =>
              ['select', 'status', 'multi_select', 'people', 'date'].includes(c.type),
            )
            .map((c) => (
              <MenuRow
                key={c.id}
                icon={iconForColType(c.type)}
                label={c.name}
                active={activeView.groupByColId === c.id}
                onPress={() => setActiveViewGroupBy(c.id)}
              />
            ))}
        </BottomMenu>
      ) : null}

      {/* Filter menu (placeholder — full editor coming) */}
      {showFilterMenu ? (
        <BottomMenu title={t('filter')} onClose={() => setShowFilterMenu(false)}>
          <Text
            style={{
              fontFamily: fonts.regular,
              fontSize: 12,
              color: colors.mutedForeground,
              padding: 8,
            }}
          >
            {t('filterTodo')}
          </Text>
        </BottomMenu>
      ) : null}
    </View>
  );
}

export default UnifiedBountifulTable;

// ─── View renderers ─────────────────────────────────────────────────────────

function TableView({
  groups,
  columns,
  readonly,
  onSetEditing,
  onColumnMenu,
  users,
}: {
  groups: { key: string; label: string; rows: BountifulRow[] }[];
  columns: BountifulColumn[];
  readonly: boolean;
  onSetEditing: (e: { rowId: string; colId: string } | null) => void;
  onColumnMenu: (colId: string | null) => void;
  users: WorkspaceMemberLike[];
}) {
  const colWidth = (c: BountifulColumn) => c.width ?? 140;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        {/* Header */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.muted }}>
          {columns.map((c) => (
            <Pressable
              key={c.id}
              onLongPress={() => onColumnMenu(c.id)}
              style={{
                width: colWidth(c),
                borderRightWidth: 1,
                borderBottomWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 6,
                paddingVertical: 4,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {iconForColTypeNode(c.type)}
              <Text
                style={{
                  fontFamily: fonts.semibold,
                  fontSize: 11,
                  color: colors.foreground,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {c.name}
              </Text>
              {!readonly ? (
                <Pressable onPress={() => onColumnMenu(c.id)} hitSlop={4}>
                  <MoreHorizontal size={11} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </View>
        {/* Groups + rows */}
        {groups.map((g) => (
          <View key={g.key || '__nogroup__'}>
            {g.key ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  backgroundColor: colors.muted,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ChevronDown size={11} color={colors.mutedForeground} />
                <Text
                  style={{
                    fontFamily: fonts.semibold,
                    fontSize: 11,
                    color: colors.mutedForeground,
                  }}
                >
                  {g.label} · {g.rows.length}
                </Text>
              </View>
            ) : null}
            {g.rows.map((row) => (
              <View key={row.id} style={{ flexDirection: 'row' }}>
                {columns.map((c) => {
                  const cell = row.cells?.[c.id] ?? null;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() =>
                        readonly ? null : onSetEditing({ rowId: row.id, colId: c.id })
                      }
                      disabled={readonly}
                      style={{
                        width: colWidth(c),
                        borderRightWidth: 1,
                        borderBottomWidth: 1,
                        borderColor: colors.border,
                        padding: 6,
                        minHeight: 32,
                      }}
                    >
                      <CellValue column={c} cell={cell} users={users} />
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function BoardView({
  groups,
  columns,
  onCellEdit,
  users,
}: {
  groups: { key: string; label: string; rows: BountifulRow[] }[];
  columns: BountifulColumn[];
  onCellEdit: (rowId: string, colId: string) => void;
  users: WorkspaceMemberLike[];
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {groups.map((g) => (
          <View
            key={g.key || '__nogroup__'}
            style={{
              width: 220,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.muted,
              padding: 6,
              gap: 6,
            }}
          >
            <Text
              style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.mutedForeground }}
            >
              {g.label || 'Sin grupo'} · {g.rows.length}
            </Text>
            {g.rows.map((row) => {
              const firstColId = columns[0]?.id;
              return (
                <Pressable
                  key={row.id}
                  onPress={() => firstColId && onCellEdit(row.id, firstColId)}
                  style={{
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    padding: 6,
                    gap: 4,
                  }}
                >
                  {columns.slice(0, 5).map((c) => (
                    <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {iconForColTypeNode(c.type)}
                      <CellValue column={c} cell={row.cells?.[c.id] ?? null} users={users} />
                    </View>
                  ))}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function GalleryView({
  rows,
  columns,
  onCellEdit,
  users,
}: {
  rows: BountifulRow[];
  columns: BountifulColumn[];
  onCellEdit: (rowId: string, colId: string) => void;
  users: WorkspaceMemberLike[];
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {rows.map((row) => {
        const firstColId = columns[0]?.id;
        return (
          <Pressable
            key={row.id}
            onPress={() => firstColId && onCellEdit(row.id, firstColId)}
            style={{
              width: 160,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              padding: 8,
              gap: 4,
            }}
          >
            {columns.slice(0, 4).map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {iconForColTypeNode(c.type)}
                <CellValue column={c} cell={row.cells?.[c.id] ?? null} users={users} />
              </View>
            ))}
          </Pressable>
        );
      })}
    </View>
  );
}

function ListView({
  rows,
  columns,
  onCellEdit,
  users,
}: {
  rows: BountifulRow[];
  columns: BountifulColumn[];
  onCellEdit: (rowId: string, colId: string) => void;
  users: WorkspaceMemberLike[];
}) {
  return (
    <View style={{ gap: 4 }}>
      {rows.map((row) => (
        <View
          key={row.id}
          style={{
            gap: 2,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border + '66',
            backgroundColor: colors.background,
            padding: 8,
          }}
        >
          {columns.map((c) => {
            const cell = row.cells?.[c.id] ?? null;
            return (
              <Pressable
                key={c.id}
                onPress={() => onCellEdit(row.id, c.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 6,
                  paddingVertical: 3,
                }}
              >
                <View style={{ width: 18, alignItems: 'center', justifyContent: 'center' }}>
                  {iconForColTypeNode(c.type)}
                </View>
                <Text
                  style={{
                    width: 110,
                    fontFamily: fonts.medium,
                    fontSize: 11,
                    color: colors.mutedForeground,
                  }}
                  numberOfLines={1}
                >
                  {c.name}
                </Text>
                <View style={{ flex: 1 }}>
                  <CellValue column={c} cell={cell} users={users} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Cell display ───────────────────────────────────────────────────────────

function CellValue({
  column,
  cell,
  users,
}: {
  column: BountifulColumn;
  cell: BountifulCell | null;
  users: WorkspaceMemberLike[];
}) {
  const t = useTranslations('bountiful');
  if (!cell) {
    return <EmptyText t={t} />;
  }
  const ct = canonicalType(column.type);

  if (ct === 'checkbox') {
    return cell.checked ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Check size={12} color={colors.success} />
        {column.checkboxStyle?.label ? (
          <Text style={{ fontSize: 11, color: colors.foreground }}>
            {column.checkboxStyle.label}
          </Text>
        ) : null}
      </View>
    ) : (
      <Square size={12} color={colors.mutedForeground} />
    );
  }

  if (ct === 'select' || ct === 'status') {
    const opt = (column.options ?? []).find((o) => o.name === (cell.name ?? cell.value));
    const color = opt?.color ?? cell.color ?? colors.mutedForeground;
    const label = cell.name ?? cell.value ?? '';
    if (!label) return <EmptyText t={t} />;
    return <Pill label={label} color={color} />;
  }

  if (ct === 'multi_select') {
    const items = cell.items ?? [];
    if (items.length === 0) return <EmptyText t={t} />;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {items.map((it, i) => (
          <Pill key={i} label={it.name} color={it.color} />
        ))}
      </View>
    );
  }

  if (ct === 'number') {
    return (
      <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground }}>
        {formatNumber(cell.number, column)}
      </Text>
    );
  }

  if (ct === 'url') {
    const url = cell.url ?? '';
    if (!url) return <EmptyText t={t} />;
    return (
      <Pressable onPress={() => void Linking.openURL(url)}>
        <Text
          style={{ fontSize: 11, color: colors.cyan, textDecorationLine: 'underline' }}
          numberOfLines={1}
        >
          {url}
        </Text>
      </Pressable>
    );
  }

  if (ct === 'email') {
    const v = cell.text ?? cell.value ?? '';
    if (!v) return <EmptyText t={t} />;
    return (
      <Pressable onPress={() => void Linking.openURL(`mailto:${v}`)}>
        <Text
          style={{ fontSize: 11, color: colors.cyan, textDecorationLine: 'underline' }}
          numberOfLines={1}
        >
          {v}
        </Text>
      </Pressable>
    );
  }

  if (ct === 'phone') {
    const v = cell.text ?? cell.value ?? '';
    if (!v) return <EmptyText t={t} />;
    return (
      <Pressable onPress={() => void Linking.openURL(`tel:${v}`)}>
        <Text
          style={{ fontSize: 11, color: colors.cyan, textDecorationLine: 'underline' }}
          numberOfLines={1}
        >
          {v}
        </Text>
      </Pressable>
    );
  }

  if (ct === 'date') {
    const d = cell.start ?? '';
    if (!d) return <EmptyText t={t} />;
    return (
      <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground }}>
        {formatDate(d, column)}
      </Text>
    );
  }

  if (ct === 'user') {
    const list = cell.users ?? [];
    if (list.length === 0) return <EmptyText t={t} />;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {list.map((u) => {
          const ref = users.find((x) => x.id === u.id);
          const name = ref?.name ?? u.name ?? u.email ?? u.id;
          return <RefPill key={u.id} type="user" name={name} />;
        })}
      </View>
    );
  }

  if (ct === 'document') {
    const list = cell.documents ?? [];
    if (list.length === 0) return <EmptyText t={t} />;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {list.map((d) => (
          <RefPill key={d.id} type="doc" name={d.name ?? d.id} />
        ))}
      </View>
    );
  }

  if (ct === 'board') {
    const list = cell.boards ?? [];
    if (list.length === 0) return <EmptyText t={t} />;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {list.map((b) => (
          <RefPill key={b.id} type="board" name={b.name ?? b.id} />
        ))}
      </View>
    );
  }

  if (ct === 'card') {
    const list = cell.cards ?? [];
    if (list.length === 0) return <EmptyText t={t} />;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {list.map((c) => (
          <RefPill key={c.id} type="card" name={c.name ?? c.id} />
        ))}
      </View>
    );
  }

  if (ct === 'popup_document') {
    const label = cell.title ?? cell.text ?? cell.value ?? '';
    if (!label) return <EmptyText t={t} />;
    return <RefPill type="doc" name={label} />;
  }

  if (ct === 'formula') {
    const v = cell.text ?? cell.value ?? cell.formula ?? '';
    return (
      <Text
        style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.cyan }}
        numberOfLines={2}
      >
        {v}
      </Text>
    );
  }

  // text + everything else (incl. rollup, created_*) → plain text fallback
  const v = cell.text ?? cell.value ?? cell.name ?? '';
  if (!v) return <EmptyText t={t} />;
  return (
    <Text style={{ fontSize: 11, color: colors.foreground }} numberOfLines={3}>
      {v}
    </Text>
  );
}

function EmptyText({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Text style={{ fontSize: 11, fontStyle: 'italic', color: colors.mutedForeground }}>
      {t('empty')}
    </Text>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        backgroundColor: color + '22',
        borderColor: color + '55',
      }}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color }}>{label}</Text>
    </View>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────────────

function CellEditorModal({
  column,
  cell,
  users,
  documents,
  boards,
  onClose,
  onChange,
}: {
  column: BountifulColumn;
  cell: BountifulCell | null;
  users: WorkspaceMemberLike[];
  documents: { id: string; name?: string }[];
  boards: { id: string; name?: string }[];
  onClose(): void;
  onChange(next: BountifulCell): void;
}) {
  const t = useTranslations('bountiful');
  if (!column) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            padding: 16,
            gap: 12,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.foreground }}>
              {column.name}
            </Text>
            <Pressable onPress={onClose} hitSlop={6}>
              <X size={14} color={colors.foreground} />
            </Pressable>
          </View>
          <CellEditor
            column={column}
            cell={cell}
            users={users}
            documents={documents}
            boards={boards}
            onChange={onChange}
          />
          <Pressable
            onPress={onClose}
            style={{
              alignSelf: 'flex-end',
              borderRadius: 6,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.foreground }}>
              {t('done')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CellEditor({
  column,
  cell,
  users,
  documents,
  boards,
  onChange,
}: {
  column: BountifulColumn;
  cell: BountifulCell | null;
  users: WorkspaceMemberLike[];
  documents: { id: string; name?: string }[];
  boards: { id: string; name?: string }[];
  onChange(next: BountifulCell): void;
}) {
  const t = useTranslations('bountiful');
  const ct = canonicalType(column.type);
  const cur = cell ?? { type: ct };

  if (ct === 'checkbox') {
    return (
      <Pressable
        onPress={() => onChange({ ...cur, type: 'checkbox', checked: !cur.checked })}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          padding: 12,
        }}
      >
        {cur.checked ? (
          <Check size={14} color={colors.success} />
        ) : (
          <Square size={14} color={colors.mutedForeground} />
        )}
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.foreground }}>
          {column.checkboxStyle?.label ?? t('toggle')}
        </Text>
      </Pressable>
    );
  }

  if (ct === 'select' || ct === 'status') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(column.options ?? []).map((opt) => {
          const active = cur.name === opt.name;
          return (
            <Pressable
              key={opt.id}
              onPress={() =>
                onChange({ ...cur, type: 'select', name: opt.name, color: opt.color })
              }
              style={{
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 999,
                borderWidth: active ? 2 : 1,
                backgroundColor: opt.color + '22',
                borderColor: opt.color + (active ? 'cc' : '55'),
              }}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: opt.color }}>
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
              style={{
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 999,
                borderWidth: active ? 2 : 1,
                backgroundColor: opt.color + '22',
                borderColor: opt.color + (active ? 'cc' : '55'),
              }}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: opt.color }}>
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
        style={{
          height: 48,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          paddingHorizontal: 12,
          color: colors.foreground,
          fontFamily: fonts.mono,
        }}
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
        style={{
          height: 48,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          paddingHorizontal: 12,
          color: colors.foreground,
          fontFamily: fonts.mono,
        }}
      />
    );
  }

  if (ct === 'email') {
    return (
      <TextInput
        value={cur.text ?? cur.value ?? ''}
        onChangeText={(v) => onChange({ ...cur, type: 'email', text: v, value: v })}
        placeholder="name@example.com"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={{
          height: 48,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          paddingHorizontal: 12,
          color: colors.foreground,
          fontFamily: fonts.mono,
        }}
      />
    );
  }

  if (ct === 'phone') {
    return (
      <TextInput
        value={cur.text ?? cur.value ?? ''}
        onChangeText={(v) => onChange({ ...cur, type: 'phone_number', text: v, value: v })}
        placeholder="+1 555 0123"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="phone-pad"
        style={{
          height: 48,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          paddingHorizontal: 12,
          color: colors.foreground,
          fontFamily: fonts.mono,
        }}
      />
    );
  }

  if (ct === 'date') {
    // Mobile: text-driven YYYY-MM-DD entry. Native date wheel is a phase-2 dep.
    return (
      <TextInput
        value={cur.start ?? ''}
        onChangeText={(v) => onChange({ ...cur, type: 'date', start: v })}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          height: 48,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          paddingHorizontal: 12,
          color: colors.foreground,
          fontFamily: fonts.mono,
        }}
      />
    );
  }

  if (ct === 'user') {
    const selected = cur.users ?? [];
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.mutedForeground }}>
          {t('selectUsers')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {users.map((u) => {
            const active = selected.some((s) => s.id === u.id);
            return (
              <Pressable
                key={u.id}
                onPress={() => {
                  const next = active
                    ? selected.filter((s) => s.id !== u.id)
                    : [...selected, { id: u.id, name: u.name, email: u.email }];
                  onChange({ ...cur, type: 'people', users: next });
                }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? colors.cyan : colors.border,
                  backgroundColor: active ? colors.cyan + '22' : colors.background,
                }}
              >
                <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.foreground }}>
                  {u.name ?? u.email ?? u.id}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (ct === 'document') {
    const selected = cur.documents ?? [];
    return (
      <RefMultiSelect
        label={t('selectDocuments')}
        options={documents.map((d) => ({ id: d.id, name: d.name ?? d.id }))}
        selected={selected.map((s) => ({ id: s.id, name: s.name ?? s.id }))}
        onChange={(next) => onChange({ ...cur, type: 'document', documents: next })}
      />
    );
  }

  if (ct === 'board') {
    const selected = cur.boards ?? [];
    return (
      <RefMultiSelect
        label={t('selectBoards')}
        options={boards.map((b) => ({ id: b.id, name: b.name ?? b.id }))}
        selected={selected.map((s) => ({ id: s.id, name: s.name ?? s.id }))}
        onChange={(next) => onChange({ ...cur, type: 'board', boards: next })}
      />
    );
  }

  if (ct === 'card') {
    const selected = cur.cards ?? [];
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.mutedForeground }}>
          {t('selectCards')}
        </Text>
        {selected.map((c, i) => (
          <View key={c.id + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <RefPill type="card" name={c.name ?? c.id} />
            <Pressable
              onPress={() =>
                onChange({ ...cur, type: 'card', cards: selected.filter((_, j) => j !== i) })
              }
              hitSlop={6}
            >
              <X size={12} color={colors.destructive} />
            </Pressable>
          </View>
        ))}
      </View>
    );
  }

  if (ct === 'formula') {
    return (
      <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.cyan }}>
        {column.formula ?? cur.formula ?? '=…'}
      </Text>
    );
  }

  // text + rollup + created_* + last_edited_* + popup_document → free-form
  return (
    <TextInput
      value={cur.text ?? cur.value ?? ''}
      onChangeText={(v) =>
        onChange({ ...cur, type: ct === 'text' ? 'text' : column.type, text: v })
      }
      placeholder={column.name}
      placeholderTextColor={colors.mutedForeground}
      multiline
      style={{
        minHeight: 80,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        padding: 8,
        color: colors.foreground,
        fontFamily: fonts.regular,
        fontSize: 13,
      }}
    />
  );
}

function RefMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: { id: string; name: string }[];
  onChange(next: { id: string; name: string }[]): void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.mutedForeground }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => {
          const active = selected.some((s) => s.id === o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() =>
                onChange(active ? selected.filter((s) => s.id !== o.id) : [...selected, o])
              }
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 6,
                borderWidth: active ? 2 : 1,
                borderColor: active ? colors.cyan : colors.border,
                backgroundColor: active ? colors.cyan + '22' : colors.background,
              }}
            >
              <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: colors.foreground }}>
                {o.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ColumnMenu({
  column,
  atIndex,
  colCount,
  readonly,
  onClose,
  onRename,
  onChangeType,
  onHide,
  onPin,
  onMoveLeft,
  onMoveRight,
  onRemove,
}: {
  column: BountifulColumn;
  atIndex: number;
  colCount: number;
  readonly: boolean;
  onClose(): void;
  onRename(name: string): void;
  onChangeType(type: string): void;
  onHide(): void;
  onPin(pinned: boolean): void;
  onMoveLeft(): void;
  onMoveRight(): void;
  onRemove(): void;
}) {
  const t = useTranslations('bountiful');
  const [name, setName] = useState(column?.name ?? '');
  const [showTypePicker, setShowTypePicker] = useState(false);
  if (!column) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            padding: 16,
            gap: 8,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.foreground }}>
              {t('column')}
            </Text>
            <Pressable onPress={onClose} hitSlop={6}>
              <X size={14} color={colors.foreground} />
            </Pressable>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            onBlur={() => onRename(name)}
            placeholder={t('newColumn')}
            placeholderTextColor={colors.mutedForeground}
            editable={!readonly}
            style={{
              height: 40,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              paddingHorizontal: 12,
              color: colors.foreground,
              fontFamily: fonts.medium,
              fontSize: 13,
            }}
          />
          <MenuRow
            icon={iconForColType(column.type)}
            label={`${t('type')}: ${column.type}`}
            onPress={() => setShowTypePicker(true)}
          />
          {/* Mobile: chevron up/down replace @dnd-kit column reorder.
              // TODO: gesture DnD — phase 2 */}
          <MenuRow
            icon={ArrowUp}
            label={t('moveLeft')}
            disabled={readonly || atIndex === 0}
            onPress={onMoveLeft}
          />
          <MenuRow
            icon={ArrowDown}
            label={t('moveRight')}
            disabled={readonly || atIndex >= colCount - 1}
            onPress={onMoveRight}
          />
          <MenuRow
            icon={EyeOff}
            label={t('hide')}
            disabled={readonly}
            onPress={() => {
              onHide();
              onClose();
            }}
          />
          <MenuRow
            icon={column.pinned ? CircleDot : Settings}
            label={column.pinned ? t('unpin') : t('pin')}
            disabled={readonly}
            onPress={() => onPin(!column.pinned)}
          />
          <MenuRow
            icon={Trash2}
            label={t('delete')}
            destructive
            disabled={readonly}
            onPress={onRemove}
          />

          {showTypePicker ? (
            <BottomMenu title={t('type')} onClose={() => setShowTypePicker(false)}>
              {COL_TYPE_VALUES.map((typ) => (
                <MenuRow
                  key={typ}
                  icon={iconForColType(typ)}
                  label={typ}
                  active={column.type === typ}
                  onPress={() => {
                    onChangeType(typ);
                    setShowTypePicker(false);
                  }}
                />
              ))}
            </BottomMenu>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BottomMenu({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            padding: 16,
            gap: 8,
            maxHeight: '70%' as `${number}%`,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.foreground }}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={6}>
              <X size={14} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 400 }}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onPress,
  active,
  disabled,
  destructive,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress(): void;
  active?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const color = destructive ? colors.destructive : active ? colors.cyan : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 8,
        paddingVertical: 10,
        opacity: disabled ? 0.4 : 1,
        borderRadius: 6,
        backgroundColor: active ? colors.cyan + '11' : 'transparent',
      }}
    >
      <Icon size={14} color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color, flex: 1 }}>{label}</Text>
      {active ? <Check size={12} color={colors.cyan} /> : null}
    </Pressable>
  );
}

function ToolbarBtn({
  icon: Icon,
  label,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 4,
      }}
    >
      <Icon size={11} color={colors.mutedForeground} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 10, color: colors.mutedForeground }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActiveChips({
  view,
  columns,
  t,
}: {
  view: BountifulView;
  columns: BountifulColumn[];
  t: ReturnType<typeof useTranslations>;
}) {
  const sortChips = (view.sorts ?? []).map((s) => {
    const c = columns.find((cc) => cc.id === s.colId);
    return c ? `${c.name} ${s.direction === 'asc' ? '↑' : '↓'}` : '';
  });
  const filterChips = (view.filters ?? []).map((f) => {
    const c = columns.find((cc) => cc.id === f.colId);
    return c ? `${c.name} ${f.operator} ${f.value}` : '';
  });
  const groupChip = view.groupByColId
    ? `${t('group')}: ${columns.find((c) => c.id === view.groupByColId)?.name ?? ''}`
    : null;
  const all = [...sortChips, ...filterChips, ...(groupChip ? [groupChip] : [])].filter(Boolean);
  if (all.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {all.map((label, i) => (
        <View
          key={i}
          style={{
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 2,
            backgroundColor: colors.muted,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{ fontFamily: fonts.regular, fontSize: 10, color: colors.mutedForeground }}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const COL_TYPE_VALUES = [
  'text',
  'rich_text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'people',
  'checkbox',
  'url',
  'email',
  'phone_number',
  'formula',
  'rollup',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'document',
  'board',
  'card',
  'popup_document',
];

function canonicalType(colType: string): string {
  switch (colType) {
    case 'title':
    case 'rich_text':
      return 'text';
    case 'email':
      return 'email';
    case 'phone_number':
      return 'phone';
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
    case 'document':
      return 'document';
    case 'board':
      return 'board';
    case 'card':
      return 'card';
    case 'popup_document':
      return 'popup_document';
    case 'formula':
      return 'formula';
    case 'rollup':
      return 'text';
    default:
      return colType || 'text';
  }
}

function iconForColType(colType: string): React.ComponentType<{ size?: number; color?: string }> {
  switch (canonicalType(colType)) {
    case 'checkbox':
      return CheckSquare;
    case 'number':
      return Hash;
    case 'url':
      return LinkIcon;
    case 'email':
      return Mail;
    case 'phone':
      return Phone;
    case 'date':
      return Calendar;
    case 'select':
      return ChevronDown;
    case 'multi_select':
      return ChevronDown;
    case 'status':
      return RotateCw;
    case 'user':
      return UserIcon;
    case 'document':
      return FileText;
    case 'board':
      return LayoutDashboard;
    case 'card':
      return CreditCard;
    case 'formula':
      return Sigma;
    case 'popup_document':
      return FileText;
    default:
      return TypeIcon;
  }
}

function iconForColTypeNode(colType: string) {
  const Icon = iconForColType(colType);
  return <Icon size={11} color={colors.mutedForeground} />;
}

function iconForLayout(layout: BountifulViewLayout) {
  switch (layout) {
    case 'board':
      return LayoutGrid;
    case 'gallery':
      return LayoutDashboard;
    case 'list':
      return ListIcon;
    case 'calendar':
    case 'timeline':
      return Calendar;
    default:
      return LayoutGrid;
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

// Suppress unused-icon warnings for icons exported in the public type-icons
// catalog but not directly referenced in the current minimal UI (they exist
// so future-phase editors render the correct lucide glyph without churn).
void Clock;
void UserCheck;
void Edit3;
void COLOR_PRESETS;
