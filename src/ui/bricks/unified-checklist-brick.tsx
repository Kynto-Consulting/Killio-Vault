import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Plus,
  Square,
  Trash2,
} from 'lucide-react-native';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { RichText } from '../RichText';

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

interface ChecklistBrickProps {
  id: string;
  items: ChecklistItem[];
  onUpdate: (newItems: ChecklistItem[]) => void;
  readonly?: boolean;
  documents?: any[];
  boards?: any[];
  users?: any[];
}

/**
 * RN port of the web UnifiedChecklistBrick. Each row: up/down chevrons +
 * tappable checkbox + inline TextInput + trash.
 *
 * Mobile: drops shadcn group-hover affordances and @dnd-kit drag handles.
 * Reorder is via up/down ArrowUp/ArrowDown buttons.
 * // TODO: gesture DnD — phase 2
 */
export const UnifiedChecklistBrick: React.FC<ChecklistBrickProps> = ({
  items = [],
  onUpdate,
  readonly,
}) => {
  const t = useTranslations('brickEditor');

  const handleItemUpdate = (idx: number, data: Partial<ChecklistItem>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...data };
    onUpdate(next);
  };

  const addItem = (idx?: number) => {
    const newItem: ChecklistItem = {
      id: Crypto.randomUUID(),
      label: '',
      checked: false,
    };
    const next = [...items];
    if (idx !== undefined) next.splice(idx + 1, 0, newItem);
    else next.push(newItem);
    onUpdate(next);
  };

  const removeItem = (idx: number) => {
    onUpdate(items.filter((_, i) => i !== idx));
  };

  const moveItem = (idx: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    onUpdate(next);
  };

  return (
    <View className="w-full gap-1 py-1">
      {items.length === 0 && !readonly && (
        <Pressable
          onPress={() => addItem()}
          className="w-full flex-row items-center gap-2 rounded-md border border-dashed border-border px-3 py-2"
        >
          <Plus size={14} color={colors.mutedForeground} />
          <RichText
            content={t('checklist.addFirstItem')}
            color={colors.mutedForeground}
          />
        </Pressable>
      )}

      {items.map((item, idx) => (
        <View
          key={item.id || idx}
          className="flex-row items-start gap-2 rounded-md px-1 py-0.5"
        >
          {!readonly && (
            <View className="gap-0.5 pt-0.5">
              <Pressable
                onPress={() => moveItem(idx, 'up')}
                disabled={idx === 0}
                hitSlop={4}
                style={{ opacity: idx === 0 ? 0.2 : 0.5 }}
              >
                <ArrowUp size={11} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={() => moveItem(idx, 'down')}
                disabled={idx === items.length - 1}
                hitSlop={4}
                style={{ opacity: idx === items.length - 1 ? 0.2 : 0.5 }}
              >
                <ArrowDown size={11} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={() =>
              !readonly && handleItemUpdate(idx, { checked: !item.checked })
            }
            hitSlop={6}
            style={{ marginTop: 4 }}
          >
            {item.checked ? (
              <CheckSquare size={16} color={colors.cyan} strokeWidth={2.5} />
            ) : (
              <Square size={16} color={colors.mutedForeground} strokeWidth={2} />
            )}
          </Pressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            {readonly ? (
              <RichText
                content={item.label || ''}
                color={item.checked ? colors.mutedForeground : colors.foreground}
              />
            ) : (
              <TextInput
                value={item.label || ''}
                onChangeText={(val) => handleItemUpdate(idx, { label: val })}
                placeholder={t('checklist.itemPlaceholder')}
                placeholderTextColor={colors.mutedForeground}
                onSubmitEditing={() => addItem(idx)}
                blurOnSubmit={false}
                style={{
                  fontFamily: fonts.regular,
                  color: item.checked
                    ? colors.mutedForeground
                    : colors.foreground,
                  fontSize: 14,
                  padding: 0,
                  textDecorationLine: item.checked ? 'line-through' : 'none',
                }}
              />
            )}
          </View>

          {!readonly && (
            <Pressable
              onPress={() => removeItem(idx)}
              hitSlop={6}
              style={{ marginTop: 4 }}
            >
              <Trash2 size={13} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      ))}

      {!readonly && items.length > 0 && (
        <Pressable
          onPress={() => addItem(items.length - 1)}
          className="ml-8 mt-1 flex-row items-center gap-1 rounded px-2 py-1"
        >
          <Plus size={12} color={colors.mutedForeground} />
          <RichText content={t('checklist.addItem')} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
};
