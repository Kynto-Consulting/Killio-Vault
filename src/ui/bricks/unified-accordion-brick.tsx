import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { RichText } from '../RichText';

interface AccordionBrickProps {
  id: string;
  title: string;
  body?: string;
  isExpanded: boolean;
  childrenByContainer?: Record<string, string[]>;
  onUpdate: (data: any) => void;
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
 * RN port of the web UnifiedAccordionBrick. Collapsible header + body.
 *
 * Mobile: the web version delegates nested children to UnifiedBrickList (which
 * still depends on @dnd-kit + DOM). Until that list is ported, the body
 * collapses into a plain editable text region — same as BrickRenderer's
 * built-in accordion. // TODO: nested brick list — phase 2
 */
export const UnifiedAccordionBrick: React.FC<AccordionBrickProps> = ({
  title,
  body,
  isExpanded,
  onUpdate,
  readonly,
}) => {
  const t = useTranslations('brickEditor');
  const [localExpanded, setLocalExpanded] = useState(isExpanded);

  useEffect(() => {
    setLocalExpanded(isExpanded);
  }, [isExpanded]);

  const toggle = () => {
    const next = !localExpanded;
    setLocalExpanded(next);
    onUpdate({ isExpanded: next });
  };

  return (
    <View
      className="w-full overflow-hidden rounded-lg border border-border/50"
      style={{ marginVertical: 4 }}
    >
      <Pressable
        onPress={toggle}
        className="flex-row items-center gap-2 bg-secondary/40 px-3 py-2"
      >
        <View
          style={{
            padding: 2,
            borderRadius: 6,
            backgroundColor: localExpanded ? colors.cyan + '22' : 'transparent',
          }}
        >
          {localExpanded ? (
            <ChevronDown size={16} color={colors.cyan} />
          ) : (
            <ChevronRight size={16} color={colors.mutedForeground} />
          )}
        </View>

        {readonly ? (
          <RichText
            content={title || t('accordion.defaultTitle')}
            color={colors.foreground}
          />
        ) : (
          <TextInput
            value={title}
            onChangeText={(v) => onUpdate({ title: v })}
            placeholder={t('accordion.titlePlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            style={{
              flex: 1,
              fontFamily: fonts.semibold,
              fontSize: 14,
              color: colors.foreground,
              padding: 0,
            }}
          />
        )}
      </Pressable>

      {localExpanded && (
        <View
          style={{
            paddingLeft: 16,
            paddingRight: 12,
            paddingVertical: 8,
            borderLeftWidth: 2,
            borderLeftColor: colors.cyan + '33',
            marginLeft: 10,
            minHeight: 32,
          }}
        >
          {readonly ? (
            <RichText content={body || ''} />
          ) : (
            <TextInput
              value={body || ''}
              onChangeText={(v) => onUpdate({ body: v })}
              multiline
              numberOfLines={3}
              placeholder={t('accordion.bodyPlaceholder')}
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
      )}
    </View>
  );
};
