import React, { useEffect, useState } from 'react';
import { Dimensions, Pressable, Text, TextInput, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

interface ColumnRecord {
  id: string;
  text?: string;
}

interface ColumnsBrickProps {
  id: string;
  columns?: ColumnRecord[];
  childrenByContainer?: Record<string, string[]>;
  onUpdate: (data: { columns: ColumnRecord[] }) => void;
  readonly?: boolean;
  documents?: any[];
  boards?: any[];
  activeBricks?: any[];
  users?: any[];
  onAddBrick?: (
    kind: string,
    afterBrickId?: string,
    parentProps?: { parentId: string; containerId: string },
    initialContent?: any,
  ) => void;
  onDeleteBrick?: (id: string) => void;
  onUpdateBrick?: (id: string, content: any) => void;
  onReorderBricks?: (ids: string[]) => void;
  onCrossContainerDrop?: (
    activeId: string,
    overId: string,
    options?: any,
  ) => void;
}

/**
 * RN port of the web UnifiedColumnsBrick. Up to 5 side-by-side columns.
 *
 * Mobile: if window width < 600px (phones) columns stack vertically; on
 * tablet+ they keep the horizontal row layout. The web brick delegates each
 * column body to UnifiedBrickList (DnD nested editor); until that list is
 * ported, each column shows a single editable text region.
 * // TODO: nested brick list — phase 2
 */
export const UnifiedColumnsBrick: React.FC<ColumnsBrickProps> = ({
  columns = [],
  onUpdate,
  readonly,
}) => {
  const t = useTranslations('brickEditor');
  const safeColumns: ColumnRecord[] =
    columns && columns.length > 0
      ? columns
      : [
          { id: '1', text: '' },
          { id: '2', text: '' },
        ];

  const [isNarrow, setIsNarrow] = useState(
    Dimensions.get('window').width < 600,
  );
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setIsNarrow(window.width < 600);
    });
    return () => sub.remove();
  }, []);

  const updateCol = (idx: number, patch: Partial<ColumnRecord>) => {
    const next = safeColumns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onUpdate({ columns: next });
  };

  const addColumn = () => {
    if (safeColumns.length >= 5) return;
    const newId = Math.random().toString(36).substring(7);
    onUpdate({ columns: [...safeColumns, { id: newId, text: '' }] });
  };

  const removeColumn = (colId: string) => {
    if (safeColumns.length <= 2) return;
    onUpdate({ columns: safeColumns.filter((c) => c.id !== colId) });
  };

  return (
    <View style={{ marginVertical: 8 }}>
      <View
        style={{
          flexDirection: isNarrow ? 'column' : 'row',
          gap: 12,
          width: '100%',
        }}
      >
        {safeColumns.map((col, index) => (
          <View
            key={col.id}
            className="rounded-lg border border-border/30 bg-secondary/20"
            style={{ flex: isNarrow ? undefined : 1, minWidth: 0 }}
          >
            <View style={{ padding: 12, minHeight: 80 }}>
              {readonly ? (
                <Text
                  style={{
                    fontFamily: fonts.regular,
                    color: colors.foreground,
                    fontSize: 13,
                  }}
                >
                  {col.text || ''}
                </Text>
              ) : (
                <TextInput
                  value={col.text || ''}
                  onChangeText={(v) => updateCol(index, { text: v })}
                  multiline
                  numberOfLines={3}
                  placeholder={`${t('columns.placeholder')} ${index + 1}…`}
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    fontFamily: fonts.regular,
                    color: colors.foreground,
                    fontSize: 13,
                    padding: 0,
                  }}
                />
              )}
            </View>
            {!readonly && safeColumns.length > 2 && (
              <Pressable
                onPress={() => removeColumn(col.id)}
                hitSlop={6}
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  backgroundColor: colors.background,
                  borderRadius: 999,
                  padding: 4,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <X size={10} color={colors.destructive} />
              </Pressable>
            )}
          </View>
        ))}
      </View>
      {!readonly && safeColumns.length < 5 && (
        <Pressable
          onPress={addColumn}
          className="mt-2 flex-row items-center justify-center gap-1 self-center rounded-full border border-border bg-secondary/40 px-3 py-1"
        >
          <Plus size={12} color={colors.mutedForeground} />
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 11,
              color: colors.mutedForeground,
            }}
          >
            {t('columns.addCol')}
          </Text>
        </Pressable>
      )}
    </View>
  );
};
