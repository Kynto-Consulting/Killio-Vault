import React from 'react';
import { TextInput, View } from 'react-native';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { RichText } from '../RichText';

// NOTE: the web brick depends on workspace context types (DocumentSummary,
// BoardSummary, DocumentBrick, WorkspaceMemberLike) which are frontend-only.
// Vault keeps the same prop names so callers from BrickRenderer can pass them
// through verbatim; the prop shape is typed loosely (`any[]`) until the Vault
// API surface mirrors those contracts.
interface QuoteBrickProps {
  id: string;
  text: string;
  onUpdate: (text: string) => void;
  onAddBrick?: (
    kind: string,
    afterBrickId?: string,
    parentProps?: any,
    initialContent?: any,
  ) => void;
  readonly?: boolean;
  documents?: any[];
  boards?: any[];
  activeBricks?: any[];
  users?: any[];
}

/**
 * RN port of the web UnifiedQuoteBrick. Italic body text with a left accent
 * bar, editable in place when `!readonly`.
 * Mobile: drops `cursor-pointer` and `hover:` web pseudo-states.
 */
export const UnifiedQuoteBrick: React.FC<QuoteBrickProps> = ({
  text,
  onUpdate,
  readonly,
}) => {
  const t = useTranslations('brickEditor');
  return (
    <View
      className="my-2 rounded-r-md bg-secondary/30 py-2 pl-3 pr-2"
      style={{ borderLeftWidth: 4, borderLeftColor: colors.primary }}
    >
      {readonly ? (
        <RichText content={text} color={colors.mutedForeground} />
      ) : (
        <TextInput
          value={text}
          onChangeText={onUpdate}
          multiline
          numberOfLines={2}
          placeholder={t('quote.placeholder')}
          placeholderTextColor={colors.mutedForeground}
          style={{
            fontFamily: fonts.regular,
            fontStyle: 'italic',
            color: colors.mutedForeground,
            fontSize: 14,
            padding: 0,
          }}
        />
      )}
    </View>
  );
};
