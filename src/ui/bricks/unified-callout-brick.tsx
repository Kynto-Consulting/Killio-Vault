import React from 'react';
import { TextInput, View } from 'react-native';
import { AlertCircle, Info, Lightbulb } from 'lucide-react-native';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { RichText } from '../RichText';

type CalloutVariant = 'tip' | 'info' | 'warning';

interface CalloutBrickProps {
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
  variant?: CalloutVariant;
  documents?: any[];
  boards?: any[];
  activeBricks?: any[];
  users?: any[];
}

const VARIANT_ICON = {
  tip: Lightbulb,
  info: Info,
  warning: AlertCircle,
};

const VARIANT_COLOR = {
  tip: colors.indigo,
  info: colors.cyan,
  warning: colors.warning,
};

/**
 * RN port of the web UnifiedCalloutBrick. Colored callout block with an icon.
 * Mobile: drops the dark-mode variant classes — colors come from the theme
 * directly so the brick looks the same on Android dark mode.
 */
export const UnifiedCalloutBrick: React.FC<CalloutBrickProps> = ({
  text,
  onUpdate,
  readonly,
  variant = 'tip',
}) => {
  const t = useTranslations('brickEditor');
  const Icon = VARIANT_ICON[variant] ?? Lightbulb;
  const tint = VARIANT_COLOR[variant] ?? colors.indigo;
  return (
    <View
      className="my-2 flex-row items-start gap-3 rounded-md border p-3"
      style={{
        borderColor: tint + '55',
        backgroundColor: tint + '14',
      }}
    >
      <View style={{ marginTop: 2 }}>
        <Icon size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        {readonly ? (
          <RichText content={text} />
        ) : (
          <TextInput
            value={text}
            onChangeText={onUpdate}
            multiline
            numberOfLines={2}
            placeholder={t('callout.placeholder')}
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
