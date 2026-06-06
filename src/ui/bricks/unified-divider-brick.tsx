import React from 'react';
import { View } from 'react-native';
import { colors } from '@/theme/theme';

interface DividerBrickProps {
  id: string;
  readonly?: boolean;
}

/**
 * RN port of the web UnifiedDividerBrick. Renders a thin horizontal rule.
 * Mobile: drops `cursor-pointer` / `select-none` — taps are routed by BrickList.
 */
export const UnifiedDividerBrick: React.FC<DividerBrickProps> = (_props) => {
  return (
    <View className="py-3">
      <View
        style={{
          height: 2,
          borderRadius: 999,
          backgroundColor: colors.mutedForeground + '33', // ≈ /20 opacity
        }}
      />
    </View>
  );
};
