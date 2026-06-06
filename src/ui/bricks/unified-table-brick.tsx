import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Calculator,
  Columns as ColumnsIcon,
  Maximize2,
  Minimize2,
  Plus,
  Rows as RowsIcon,
  Table as TableIcon,
  Trash2,
} from 'lucide-react-native';

import { colLabel, sheetEngine } from '../sheet-engine';
import { RefPill, type RefType } from '../RefPill';
import { useTranslations } from '../../i18n';
import { colors } from '../../theme/theme';
import { fonts } from '../../theme/fonts';

/**
 * Canonical RN port of the web `unified-table-brick.tsx` (Excel-like simple
 * table). Replaces the legacy `src/ui/UnifiedTableBrick.tsx`. Same feature
 * surface where mobile allows:
 *
 *  - A/B/C… column letter headers, row numbers, tap-to-edit cells
 *  - Inline formula editing with computed value display
 *  - HyperFormula via shared `sheet-engine.ts` (=SUM, =AVERAGE, =IF, =VLOOKUP…)
 *  - Function-name suggestion popover anchored to the formula bar
 *  - Add/remove row & column, editable title, fullscreen modal toggle
 *  - Inline @-mentions rendered as RefPill chips inside read-only cells
 *
 * Mobile: drag-to-select range, hover-only delete buttons, portal-anchored
 * popovers, and KaTeX are dropped — instead range references are typed
 * (=SUM(A1:A5)) and the suggestion popover lives in the bottom formula bar.
 *
 * // TODO: gesture DnD — phase 2 (column/row reorder via long-press)
 */

interface FunctionMeta {
  name: string;
  description: string;
  parameters: string[];
}

export interface UnifiedTableBrickProps {
  id: string;
  title?: string;
  data: string[][];
  onUpdate: (data: string[][]) => void;
  onUpdateTitle?: (title: string) => void;
  onPatchCell?: (rowIndex: number, colIndex: number, value: string) => void;
  onPatchStructure?: (patch: {
    kind: 'table_add_row' | 'table_remove_row' | 'table_add_col' | 'table_remove_col';
    index?: number;
  }) => void;
  readonly?: boolean;
  // The following are accepted to mirror the web surface; mobile only uses
  // them for the @-mention RefPill rendering.
  documents?: { id: string; name?: string; title?: string }[];
  boards?: { id: string; name?: string }[];
  folders?: { id: string; name?: string }[];
  users?: { id: string; name?: string; email?: string }[];
  activeBricks?: { id?: string; kind?: string; content?: Record<string, unknown> }[];
}

// HyperFormula function catalog (mirrors the most common functions surfaced
// by the web sheetEngine.getFunctionsWithMetadata()).
const COMMON_FUNCTIONS: Record<string, { description: string; parameters: string[] }> = {
  SUM: { description: 'Suma todos los números en un rango de celdas.', parameters: ['numero1', '[numero2]', '...'] },
  AVERAGE: { description: 'Calcula el promedio de los argumentos.', parameters: ['numero1', '[numero2]', '...'] },
  COUNT: { description: 'Cuenta cuántas celdas contienen números.', parameters: ['valor1', '[valor2]', '...'] },
  COUNTA: { description: 'Cuenta celdas no vacías.', parameters: ['valor1', '[valor2]', '...'] },
  MAX: { description: 'Valor máximo de un conjunto.', parameters: ['numero1', '[numero2]', '...'] },
  MIN: { description: 'Valor mínimo de un conjunto.', parameters: ['numero1', '[numero2]', '...'] },
  IF: { description: 'Condición → valor si verdadero, valor si falso.', parameters: ['prueba', 'verdadero', '[falso]'] },
  VLOOKUP: { description: 'Búsqueda vertical en una tabla.', parameters: ['valor', 'matriz', 'col', '[rango]'] },
  HLOOKUP: { description: 'Búsqueda horizontal en una tabla.', parameters: ['valor', 'matriz', 'fila', '[rango]'] },
  CONCATENATE: { description: 'Une varios textos en uno solo.', parameters: ['texto1', '[texto2]', '...'] },
  TODAY: { description: 'Fecha actual.', parameters: [] },
  NOW: { description: 'Fecha y hora actuales.', parameters: [] },
  ROUND: { description: 'Redondea un número.', parameters: ['numero', 'decimales'] },
  ABS: { description: 'Valor absoluto.', parameters: ['numero'] },
  AND: { description: 'Lógico Y.', parameters: ['logico1', '[logico2]', '...'] },
  OR: { description: 'Lógico O.', parameters: ['logico1', '[logico2]', '...'] },
  NOT: { description: 'Lógico NO.', parameters: ['logico'] },
};

const FUNCTION_NAMES = Object.keys(COMMON_FUNCTIONS);

// ─── @-mention parsing ──────────────────────────────────────────────────────
// Mirrors the web ReferenceResolver renderRich() output shape so cells with
// inline `@doc:id|name` / `@user:id` tokens render as RefPills exactly like
// the web app.
type RichPart =
  | { kind: 'text'; value: string }
  | { kind: 'pill'; type: RefType; id: string; name: string };

const MENTION_RE = /@(doc|board|card|user|deep|mention|room|thread|transcript|event|ext|mesh):([^\s|]+)(?:\|([^\s]+))?/g;

function parseRich(value: string): RichPart[] {
  if (!value) return [];
  const parts: RichPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', value: value.slice(lastIndex, match.index) });
    }
    parts.push({
      kind: 'pill',
      type: match[1] as RefType,
      id: match[2],
      name: match[3] ? decodeURIComponent(match[3]) : match[2],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    parts.push({ kind: 'text', value: value.slice(lastIndex) });
  }
  return parts;
}

export function UnifiedTableBrick({
  id,
  title,
  data,
  onUpdate,
  onUpdateTitle,
  onPatchCell,
  onPatchStructure,
  readonly,
}: UnifiedTableBrickProps) {
  const t = useTranslations('tableBrick');

  const normalizedData = useMemo(() => {
    if (Array.isArray(data) && data.length > 0) return data;
    return [[t('defaultColA'), t('defaultColB')], ['', '']];
  }, [data, t]);

  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [computedData, setComputedData] = useState<string[][]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title || '');

  const [suggestions, setSuggestions] = useState<FunctionMeta[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filterText, setFilterText] = useState('');

  const inputRefs = useRef<Record<string, TextInput | null>>({});

  useEffect(() => {
    setDraftTitle(title || '');
  }, [title]);

  useEffect(() => {
    sheetEngine.updateSheet(id, normalizedData);
    const rows = normalizedData.length;
    const cols = normalizedData[0]?.length || 1;
    setComputedData(sheetEngine.getComputedData(id, rows, cols));
  }, [id, normalizedData]);

  const colCount = normalizedData[0]?.length || 1;

  const commitEdit = () => {
    if (!editingCell) return;
    const { r, c } = editingCell;
    if (onPatchCell) {
      onPatchCell(r, c, editingValue);
    } else {
      const next = normalizedData.map((row) => [...row]);
      next[r][c] = editingValue;
      onUpdate(next);
    }
  };

  const stopEditing = () => {
    setShowSuggestions(false);
    setEditingCell(null);
    setEditingValue('');
  };

  const focusCell = (r: number, c: number) => {
    const maxRow = normalizedData.length - 1;
    const maxCol = (normalizedData[0]?.length || 1) - 1;
    const rr = Math.max(0, Math.min(r, maxRow));
    const cc = Math.max(0, Math.min(c, maxCol));
    const key = `${rr}-${cc}`;
    inputRefs.current[key]?.focus();
    setEditingCell({ r: rr, c: cc });
    setEditingValue(normalizedData[rr][cc] || '');
    setShowSuggestions(false);
  };

  const commitTitle = () => {
    if (readonly || !onUpdateTitle) return;
    const currentTitle = title || '';
    if (draftTitle === currentTitle) return;
    onUpdateTitle(draftTitle);
  };

  const addRow = () => {
    const cols = normalizedData[0]?.length || 1;
    if (onPatchStructure) onPatchStructure({ kind: 'table_add_row' });
    else onUpdate([...normalizedData, new Array(cols).fill('')]);
  };

  const addColumn = () => {
    if (onPatchStructure) onPatchStructure({ kind: 'table_add_col' });
    else onUpdate(normalizedData.map((row) => [...row, '']));
  };

  const removeRow = (idx: number) => {
    if (readonly || normalizedData.length <= 1) return;
    if (onPatchStructure) onPatchStructure({ kind: 'table_remove_row', index: idx });
    else onUpdate(normalizedData.filter((_, i) => i !== idx));
  };

  const removeColumn = (idx: number) => {
    if (readonly || (normalizedData[0]?.length || 0) <= 1) return;
    if (onPatchStructure) onPatchStructure({ kind: 'table_remove_col', index: idx });
    else onUpdate(normalizedData.map((row) => row.filter((_, i) => i !== idx)));
  };

  const updateSuggestions = (value: string) => {
    if (!value.startsWith('=')) {
      setShowSuggestions(false);
      return false;
    }
    const match = value.match(/([A-Z]+)$/i);
    if (!match) {
      setShowSuggestions(false);
      return false;
    }
    const token = match[1].toUpperCase();
    const filtered = FUNCTION_NAMES.filter((n) => n.startsWith(token)).map((name) => ({
      name,
      ...COMMON_FUNCTIONS[name],
    }));
    if (filtered.length === 0) {
      setShowSuggestions(false);
      return false;
    }
    setFilterText(token);
    setSuggestions(filtered);
    setShowSuggestions(true);
    return true;
  };

  const applySuggestion = (fn: string) => {
    if (!editingCell) return;
    const nextValue = `${editingValue.slice(0, editingValue.length - filterText.length)}${fn}(`;
    setEditingValue(nextValue);
    setShowSuggestions(false);
    const key = `${editingCell.r}-${editingCell.c}`;
    setTimeout(() => inputRefs.current[key]?.focus(), 0);
  };

  const getDisplayValue = (r: number, c: number) => {
    if (editingCell?.r === r && editingCell?.c === c) return editingValue;
    return computedData[r]?.[c] ?? normalizedData[r]?.[c] ?? '';
  };

  // Mobile: tap a URL-only cell text to open it.
  const maybeOpenUrl = (s: string) => {
    if (/^https?:\/\//i.test(s)) {
      void Linking.openURL(s);
    }
  };

  const content = (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        flex: isFullscreen ? 1 : undefined,
      }}
    >
      {/* Header bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.muted,
          padding: 8,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingHorizontal: 4 }}>
          <TableIcon size={14} color={colors.cyan} />
          {readonly ? (
            <Text
              style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.mutedForeground, flex: 1 }}
              numberOfLines={1}
            >
              {title?.trim() || t('defaultTitle')}
            </Text>
          ) : (
            <TextInput
              value={draftTitle}
              onChangeText={setDraftTitle}
              onBlur={commitTitle}
              onSubmitEditing={commitTitle}
              placeholder={t('titlePlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              style={{
                flex: 1,
                fontFamily: fonts.semibold,
                fontSize: 11,
                color: colors.foreground,
                padding: 0,
              }}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {!readonly ? (
            <>
              <ToolBtn icon={ColumnsIcon} label={t('addColumnCompact')} onPress={addColumn} />
              <ToolBtn icon={RowsIcon} label={t('addRowCompact')} onPress={addRow} />
            </>
          ) : null}
          <Pressable
            onPress={() => setIsFullscreen((v) => !v)}
            hitSlop={4}
            style={{
              height: 28,
              paddingHorizontal: 8,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isFullscreen ? (
              <Minimize2 size={13} color={colors.foreground} />
            ) : (
              <Maximize2 size={13} color={colors.foreground} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Sheet grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {/* Column header row */}
          <View style={{ flexDirection: 'row', backgroundColor: colors.muted }}>
            <HeaderCell width={36}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.mutedForeground }}>#</Text>
            </HeaderCell>
            {Array.from({ length: colCount }).map((_, c) => (
              <HeaderCell key={`h-${c}`} width={120}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.mutedForeground }}>
                    {colLabel(c)}
                  </Text>
                  {!readonly ? (
                    <Pressable onPress={() => removeColumn(c)} hitSlop={4}>
                      <Trash2 size={10} color={colors.destructive} />
                    </Pressable>
                  ) : null}
                </View>
              </HeaderCell>
            ))}
          </View>
          {/* Data rows */}
          {/* Mobile: rows are not virtualized — wrapping FlatList would break
              horizontal ScrollView measurement. For very wide tables we accept
              non-virtualized rows in v1. */}
          <ScrollView style={{ maxHeight: isFullscreen ? undefined : 320, minHeight: 80 }}>
            {normalizedData.map((row, r) => (
              <View key={`r-${r}`} style={{ flexDirection: 'row' }}>
                <RowNumberCell index={r} readonly={!!readonly} onRemove={() => removeRow(r)} />
                {Array.from({ length: colCount }).map((_, c) => {
                  const rawCell = row[c] ?? '';
                  const isEditing = editingCell?.r === r && editingCell?.c === c;
                  const isFormula = rawCell.startsWith('=');
                  const display = String(getDisplayValue(r, c) ?? '');
                  const richParts = !isEditing && !isFormula ? parseRich(display) : null;
                  return (
                    <BodyCell key={`c-${r}-${c}`} width={120}>
                      {richParts && richParts.some((p) => p.kind === 'pill') ? (
                        <Pressable
                          onPress={() => {
                            if (readonly) return;
                            setEditingCell({ r, c });
                            setEditingValue(rawCell);
                          }}
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 4,
                            minHeight: 32,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          {richParts.map((p, i) =>
                            p.kind === 'text' ? (
                              <Text
                                key={`t-${i}`}
                                style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.foreground }}
                              >
                                {p.value}
                              </Text>
                            ) : (
                              <RefPill key={`p-${i}`} type={p.type} name={p.name} />
                            ),
                          )}
                        </Pressable>
                      ) : (
                        <TextInput
                          ref={(el) => {
                            inputRefs.current[`${r}-${c}`] = el;
                          }}
                          value={isEditing ? editingValue : display}
                          editable={!readonly}
                          onFocus={() => {
                            if (readonly) return;
                            setEditingCell({ r, c });
                            setEditingValue(rawCell);
                            setShowSuggestions(false);
                          }}
                          onBlur={() => {
                            if (readonly) return;
                            if (editingCell?.r === r && editingCell?.c === c) {
                              commitEdit();
                              stopEditing();
                            }
                          }}
                          onChangeText={(value) => {
                            if (readonly) return;
                            setEditingValue(value);
                            updateSuggestions(value);
                          }}
                          onSubmitEditing={() => {
                            commitEdit();
                            focusCell(r + 1, c);
                          }}
                          placeholderTextColor={colors.mutedForeground}
                          style={{
                            fontFamily: isFormula ? fonts.mono : fonts.regular,
                            fontSize: 12,
                            color: isFormula ? colors.cyan : colors.foreground,
                            paddingHorizontal: 6,
                            paddingVertical: 4,
                            minHeight: 32,
                            width: '100%',
                          }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          onContentSizeChange={() => {
                            // no-op — TextInput sizing handled by minHeight
                          }}
                        />
                      )}
                      {isFormula && !isEditing ? (
                        <Pressable
                          onPress={() => {
                            if (readonly) return;
                            setEditingCell({ r, c });
                            setEditingValue(rawCell);
                          }}
                          style={{ position: 'absolute', top: 2, right: 2 }}
                        >
                          <Calculator size={9} color={colors.cyan} />
                        </Pressable>
                      ) : null}
                      {/* Mobile: long-press a URL cell to open it. */}
                      {!isEditing && /^https?:\/\//i.test(display) ? (
                        <Pressable
                          onLongPress={() => maybeOpenUrl(display)}
                          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                        />
                      ) : null}
                    </BodyCell>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Formula bar — mobile substitute for the web's cell-anchored popover.
          Mirrors the active cell address + editable raw formula. */}
      {editingCell ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
            padding: 6,
          }}
        >
          <Calculator size={12} color={colors.cyan} />
          <Text
            style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.mutedForeground, minWidth: 36 }}
          >
            {colLabel(editingCell.c)}
            {editingCell.r + 1}
          </Text>
          <TextInput
            value={editingValue}
            onChangeText={(v) => {
              setEditingValue(v);
              updateSuggestions(v);
            }}
            onSubmitEditing={() => {
              commitEdit();
              stopEditing();
            }}
            style={{
              flex: 1,
              fontFamily: fonts.mono,
              fontSize: 12,
              color: colors.foreground,
              padding: 0,
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="=SUM(A1:A5)"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>
      ) : null}

      {/* Suggestions popover */}
      {showSuggestions && suggestions.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 56,
            maxHeight: 200,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <ScrollView>
            {suggestions.map((fn) => (
              <Pressable
                key={fn.name}
                onPress={() => applySuggestion(fn.name)}
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.foreground }}>
                    {fn.name}
                  </Text>
                  {fn.parameters.length > 0 ? (
                    <Text
                      style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.mutedForeground }}
                    >
                      ({fn.parameters.join(', ')})
                    </Text>
                  ) : null}
                </View>
                {fn.description ? (
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 2 }}>
                    {fn.description}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Footer add buttons */}
      {!readonly ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            padding: 6,
          }}
        >
          <FooterBtn icon={Plus} label={t('addRow')} onPress={addRow} />
          <FooterBtn icon={Plus} label={t('addColumn')} onPress={addColumn} />
        </View>
      ) : null}
    </View>
  );

  if (isFullscreen) {
    return (
      <Modal
        visible
        transparent={false}
        animationType="fade"
        onRequestClose={() => setIsFullscreen(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background, padding: 12 }}>{content}</View>
      </Modal>
    );
  }

  return content;
}

// Backwards-compat default export so older imports still work.
export default UnifiedTableBrick;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function HeaderCell({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <View
      style={{
        width,
        borderBottomWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.border,
        paddingVertical: 4,
        paddingHorizontal: 4,
        backgroundColor: colors.muted,
      }}
    >
      {children}
    </View>
  );
}

function BodyCell({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <View
      style={{
        width,
        borderBottomWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.border,
        position: 'relative',
      }}
    >
      {children}
    </View>
  );
}

function RowNumberCell({
  index,
  readonly,
  onRemove,
}: {
  index: number;
  readonly: boolean;
  onRemove(): void;
}) {
  return (
    <View
      style={{
        width: 36,
        borderBottomWidth: 1,
        borderRightWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.muted,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 4,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.mutedForeground }}>
        {index + 1}
      </Text>
      {!readonly ? (
        <Pressable onPress={onRemove} hitSlop={4}>
          <Trash2 size={9} color={colors.destructive} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ToolBtn({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof TableIcon;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 28,
        paddingHorizontal: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Icon size={11} color={colors.foreground} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.foreground }}>
        + {label}
      </Text>
    </Pressable>
  );
}

function FooterBtn({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof TableIcon;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 28,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Icon size={11} color={colors.foreground} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}
