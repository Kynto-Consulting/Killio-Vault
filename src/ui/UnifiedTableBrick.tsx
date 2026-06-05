import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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

import { colLabel, sheetEngine } from './sheet-engine';
import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * 1:1 port of Killio-Frontend's `unified-table-brick.tsx`. Same features:
 * column letter headers (A, B, … AA …), row numbers, tap-to-edit cells,
 * inline formula editing with computed value display, =SUM/=AVERAGE/etc.
 * via the shared HyperFormula sheet-engine, formula-function suggestion
 * popover, add/remove row and column, editable title, and a fullscreen
 * toggle. Mobile substitutions:
 *
 * - Drag-to-select range (mouse-down on cell while editing) is not feasible
 *   on a touch surface without long-press conflicts; instead, the user
 *   types the range directly (e.g. =SUM(A1:A5)) and the engine evaluates.
 * - Suggestions popover is anchored to the formula bar instead of the
 *   cell because RN inputs don't expose getBoundingClientRect.
 * - Reference picker (`@`-mentions inside cells) is omitted — the web's
 *   picker depends on the full ReferenceResolver + workspace context which
 *   doesn't ship on mobile yet; raw text/refs round-trip unchanged.
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
}

// HyperFormula functions table. Mirrors the web sheetEngine catalog so the
// same suggestion popover surfaces in mobile.
const COMMON_FUNCTIONS: Record<string, { description: string; parameters: string[] }> = {
  SUM: { description: 'Suma todos los números en un rango de celdas.', parameters: ['numero1', '[numero2]', '...'] },
  AVERAGE: { description: 'Calcula el promedio de los argumentos.', parameters: ['numero1', '[numero2]', '...'] },
  COUNT: { description: 'Cuenta cuántas celdas contienen números.', parameters: ['valor1', '[valor2]', '...'] },
  MAX: { description: 'Valor máximo de un conjunto.', parameters: ['numero1', '[numero2]', '...'] },
  MIN: { description: 'Valor mínimo de un conjunto.', parameters: ['numero1', '[numero2]', '...'] },
  IF: { description: 'Condición → valor si verdadero, valor si falso.', parameters: ['prueba', 'verdadero', '[falso]'] },
  VLOOKUP: { description: 'Búsqueda vertical en una tabla.', parameters: ['valor', 'matriz', 'col', '[rango]'] },
  CONCATENATE: { description: 'Une varios textos en uno solo.', parameters: ['texto1', '[texto2]', '...'] },
  TODAY: { description: 'Fecha actual.', parameters: [] },
  NOW: { description: 'Fecha y hora actuales.', parameters: [] },
};

const FUNCTION_NAMES = Object.keys(COMMON_FUNCTIONS);

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
              <Text
                style={{ fontFamily: fonts.bold, fontSize: 10, color: colors.mutedForeground }}
              >
                #
              </Text>
            </HeaderCell>
            {Array.from({ length: colCount }).map((_, c) => (
              <HeaderCell key={`h-${c}`} width={120}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
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
          <ScrollView
            style={{
              maxHeight: isFullscreen ? undefined : 320,
              minHeight: 80,
            }}
          >
            {normalizedData.map((row, r) => (
              <View key={`r-${r}`} style={{ flexDirection: 'row' }}>
                <RowNumberCell
                  index={r}
                  readonly={!!readonly}
                  onRemove={() => removeRow(r)}
                />
                {Array.from({ length: colCount }).map((_, c) => {
                  const rawCell = row[c] ?? '';
                  const isEditing = editingCell?.r === r && editingCell?.c === c;
                  const isFormula = rawCell.startsWith('=');
                  const display = getDisplayValue(r, c);
                  return (
                    <BodyCell key={`c-${r}-${c}`} width={120}>
                      <TextInput
                        ref={(el) => {
                          inputRefs.current[`${r}-${c}`] = el;
                        }}
                        value={isEditing ? editingValue : String(display ?? '')}
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
                      />
                      {isFormula && !isEditing ? (
                        <View style={{ position: 'absolute', top: 2, right: 2 }}>
                          <Calculator size={9} color={colors.cyan} />
                        </View>
                      ) : null}
                    </BodyCell>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Formula bar — shows the raw formula being edited, and the suggestion
          popover anchors below it for usability on mobile. */}
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
            {colLabel(editingCell.c)}{editingCell.r + 1}
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
                  <Text
                    style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.foreground }}
                  >
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
      <Modal visible transparent={false} animationType="fade" onRequestClose={() => setIsFullscreen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, padding: 12 }}>{content}</View>
      </Modal>
    );
  }

  return content;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function HeaderCell({
  width,
  children,
}: {
  width: number;
  children: React.ReactNode;
}) {
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

function BodyCell({
  width,
  children,
}: {
  width: number;
  children: React.ReactNode;
}) {
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
