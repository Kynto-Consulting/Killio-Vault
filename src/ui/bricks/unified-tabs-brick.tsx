import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { RichText } from '../RichText';

interface TabRecord {
  id: string;
  label: string;
  content?: string;
}

interface TabsBrickProps {
  id: string;
  tabs: TabRecord[];
  childrenByContainer?: Record<string, string[]>;
  onUpdate: (data: { tabs: TabRecord[] }) => void;
  readonly?: boolean;
  activeBricks?: any[];
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
  documents?: any[];
  boards?: any[];
  users?: any[];
}

/**
 * RN port of the web UnifiedTabsBrick. Horizontal pill strip + body region.
 *
 * Mobile: tab strip is a horizontal ScrollView (web used overflow-x-auto).
 * The body delegates to UnifiedBrickList on web; until ported here, the
 * active tab's content is rendered as plain editable text.
 * // TODO: nested brick list — phase 2
 */
export const UnifiedTabsBrick: React.FC<TabsBrickProps> = ({
  tabs = [],
  onUpdate,
  readonly,
}) => {
  const t = useTranslations('brickEditor');
  const safeTabs: TabRecord[] =
    tabs.length > 0
      ? tabs
      : [{ id: '1', label: t('tabs.defaultTab1'), content: '' }];
  const [activeTab, setActiveTab] = useState(safeTabs[0].id);

  const updateTab = (
    tabId: string,
    overrides: Partial<{ label: string; content: string }>,
  ) => {
    onUpdate({
      tabs: safeTabs.map((tab) =>
        tab.id === tabId ? { ...tab, ...overrides } : tab,
      ),
    });
  };

  const addTab = () => {
    const newId = Math.random().toString(36).substring(7);
    onUpdate({
      tabs: [
        ...safeTabs,
        {
          id: newId,
          label: `${t('tabs.defaultTabN')} ${safeTabs.length + 1}`,
          content: '',
        },
      ],
    });
    setActiveTab(newId);
  };

  const removeTab = (tabId: string) => {
    if (safeTabs.length <= 1) return;
    const next = safeTabs.filter((tab) => tab.id !== tabId);
    onUpdate({ tabs: next });
    if (activeTab === tabId) setActiveTab(next[0].id);
  };

  const activeContent =
    safeTabs.find((tab) => tab.id === activeTab)?.content || '';

  return (
    <View
      className="overflow-hidden rounded-lg border border-border/50"
      style={{ marginVertical: 4 }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="bg-secondary/30 border-b border-border/40"
        contentContainerStyle={{ paddingHorizontal: 4, paddingTop: 4 }}
      >
        {safeTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              className="flex-row items-center px-3 py-2"
              style={{
                borderBottomWidth: 2,
                borderBottomColor: isActive ? colors.primary : 'transparent',
                backgroundColor: isActive ? colors.background : 'transparent',
              }}
            >
              {readonly ? (
                <Text
                  style={{
                    fontFamily: isActive ? fonts.semibold : fonts.regular,
                    color: isActive ? colors.foreground : colors.mutedForeground,
                    fontSize: 13,
                  }}
                >
                  {tab.label}
                </Text>
              ) : (
                <TextInput
                  value={tab.label}
                  onChangeText={(v) => updateTab(tab.id, { label: v })}
                  style={{
                    fontFamily: isActive ? fonts.semibold : fonts.regular,
                    color: isActive ? colors.foreground : colors.mutedForeground,
                    fontSize: 13,
                    padding: 0,
                    minWidth: 50,
                  }}
                />
              )}
              {!readonly && safeTabs.length > 1 && (
                <Pressable
                  onPress={() => removeTab(tab.id)}
                  hitSlop={6}
                  style={{ marginLeft: 8 }}
                >
                  <Trash2 size={12} color={colors.mutedForeground} />
                </Pressable>
              )}
            </Pressable>
          );
        })}
        {!readonly && (
          <Pressable
            onPress={addTab}
            className="items-center justify-center px-3 py-2"
          >
            <Plus size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </ScrollView>
      <View
        className="bg-background"
        style={{ padding: 12, minHeight: 50 }}
      >
        {readonly ? (
          <RichText content={activeContent} />
        ) : (
          <TextInput
            value={activeContent}
            onChangeText={(v) => updateTab(activeTab, { content: v })}
            multiline
            numberOfLines={3}
            placeholder={t('tabs.contentPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            style={{
              fontFamily: fonts.regular,
              color: colors.foreground,
              fontSize: 14,
              padding: 0,
            }}
          />
        )}
      </View>
    </View>
  );
};
