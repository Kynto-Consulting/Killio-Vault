import { Text, View } from 'react-native';

import { useCapture } from './CaptureContext';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Lightweight, non-blocking banner shown while the offline Vosk speech model is
 * downloaded + unzipped on first run (a one-time ~39MB fetch that is otherwise
 * silent). View-based progress bar — no extra deps.
 *
 *   downloading → "Descargando modelo de voz… {progress}%" + thin bar
 *   preparing   → "Preparando modelo de voz…" (indeterminate, full bar)
 *   error       → the failure message
 *   ready/idle  → renders nothing
 *
 * Reads modelStatus from CaptureContext, so it can be dropped onto any screen
 * inside CaptureProvider (e.g. the assistant) to surface progress.
 */
export function ModelStatusBanner() {
  const { modelStatus } = useCapture();
  const t = useTranslations('captureModel');

  if (!modelStatus) return null;
  const { state } = modelStatus;
  if (state !== 'downloading' && state !== 'preparing' && state !== 'error') {
    return null;
  }

  const progress =
    state === 'downloading'
      ? Math.max(0, Math.min(100, Math.round(modelStatus.progress ?? 0)))
      : 100;

  const label =
    state === 'downloading'
      ? t('downloading', { progress })
      : state === 'preparing'
        ? t('preparing')
        : modelStatus.message ?? t('error');

  const isError = state === 'error';

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 6,
      }}
    >
      <Text
        style={{
          color: isError ? colors.destructive : colors.foreground,
          fontSize: 12,
          fontFamily: fonts.medium,
        }}
        numberOfLines={2}
      >
        {label}
      </Text>
      {!isError ? (
        <View
          style={{
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.border,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 3,
              borderRadius: 2,
              width: `${progress}%`,
              backgroundColor: colors.cyan,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
