import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Eye, Pencil } from 'lucide-react-native';

import { MathRenderer } from './MathRenderer';
import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * LaTeX editor with live KaTeX preview. Mirrors the experience the web
 * `inline-pickers.tsx` math picker offers: a textarea on top, the rendered
 * formula underneath, plus a display / inline toggle. Vault uses this whenever
 * the user inserts a math block from the brick "+" menu so the formula they
 * type immediately appears under the input.
 */
interface LatexEditorProps {
  value: string;
  onChange(next: string): void;
  /** Pass true to insert a `$$...$$` block, false for inline `$...$`. */
  display?: boolean;
  onToggleDisplay?(next: boolean): void;
}

export function LatexEditor({
  value,
  onChange,
  display = true,
  onToggleDisplay,
}: LatexEditorProps) {
  const t = useTranslations('latex');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-center justify-between">
        <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
          {t('title')}
        </Text>
        <View className="flex-row gap-1">
          {onToggleDisplay ? (
            <Pressable
              onPress={() => onToggleDisplay(!display)}
              className="rounded-md border border-border bg-background px-2 py-1"
            >
              <Text style={{ fontFamily: fonts.medium }} className="text-[10px] text-foreground">
                {display ? t('display') : t('inline')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
            className="flex-row items-center gap-1 rounded-md border border-border bg-background px-2 py-1"
          >
            {mode === 'edit' ? (
              <Eye size={11} color={colors.foreground} />
            ) : (
              <Pencil size={11} color={colors.foreground} />
            )}
            <Text style={{ fontFamily: fonts.medium }} className="text-[10px] text-foreground">
              {mode === 'edit' ? t('preview') : t('edit')}
            </Text>
          </Pressable>
        </View>
      </View>

      {mode === 'edit' ? (
        <TextInput
          value={value}
          onChangeText={onChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('placeholder')}
          placeholderTextColor={colors.mutedForeground}
          style={{ fontFamily: fonts.mono, minHeight: 60 }}
          className="rounded-md border border-border bg-background p-2 text-sm text-foreground"
        />
      ) : null}

      {/* Live preview is always rendered; in edit mode it shows under the
          textarea, in preview mode it replaces it. */}
      <View className={mode === 'edit' ? 'rounded-md border border-border/40 bg-background p-2' : ''}>
        {value.trim() ? (
          <MathRenderer formula={value} display={display} />
        ) : (
          <Text className="text-xs text-muted-foreground italic">
            {t('empty')}
          </Text>
        )}
      </View>
    </View>
  );
}
