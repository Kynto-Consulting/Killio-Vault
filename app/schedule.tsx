import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen, Card, H1, Body, Button } from '@/ui';
import { useCapture } from '@/capture/CaptureContext';
import {
  CaptureMode,
  TimeWindow,
  parseHhMm,
  minToHhMm,
} from '@/capture/schedule';
import { useTranslations } from '@/i18n';
import { colors, radius, spacing, typography } from '@/theme/theme';

export default function ScheduleScreen() {
  const t = useTranslations('schedule');
  const { mode, setMode } = useCapture();

  const windows: TimeWindow[] =
    mode.kind === 'windows' ? mode.windows : [];

  const dayLabels = t('dayShort').split(',');

  const apply = (next: CaptureMode) => void setMode(next);

  const setWindows = (w: TimeWindow[]) =>
    apply(w.length ? { kind: 'windows', windows: w } : { kind: 'off' });

  const addWindow = () =>
    setWindows([...windows, { startMin: 9 * 60, endMin: 18 * 60, days: [] }]);

  const removeWindow = (i: number) =>
    setWindows(windows.filter((_, idx) => idx !== i));

  const patchWindow = (i: number, patch: Partial<TimeWindow>) =>
    setWindows(windows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));

  const toggleDay = (i: number, day: number) => {
    const w = windows[i];
    const days = w.days ?? [];
    patchWindow(i, {
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    });
  };

  return (
    <Screen scroll>
      <H1>{t('title')}</H1>
      <Body muted>{t('subtitle')}</Body>

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Button
          title={mode.kind === 'always' ? `● ${t('mode247')}` : t('mode247')}
          variant={mode.kind === 'always' ? 'primary' : 'secondary'}
          onPress={() => apply({ kind: 'always' })}
        />
        <Button
          title={mode.kind === 'windows' ? `● ${t('modeWindows')}` : t('modeWindows')}
          variant={mode.kind === 'windows' ? 'primary' : 'secondary'}
          onPress={() =>
            apply(
              windows.length
                ? { kind: 'windows', windows }
                : { kind: 'windows', windows: [{ startMin: 9 * 60, endMin: 18 * 60, days: [] }] },
            )
          }
        />
        <Button
          title={mode.kind === 'off' ? `● ${t('modeOff')}` : t('modeOff')}
          variant={mode.kind === 'off' ? 'primary' : 'secondary'}
          onPress={() => apply({ kind: 'off' })}
        />
      </View>

      {mode.kind === 'windows' ? (
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <Body>{t('windows')}</Body>
          {windows.map((w, i) => (
            <Card key={i}>
              <View style={styles.timeRow}>
                <TimeField
                  label={t('from')}
                  value={minToHhMm(w.startMin)}
                  onCommit={(min) => patchWindow(i, { startMin: min })}
                  invalidLabel={t('invalidTime')}
                  placeholder={t('timePlaceholder')}
                />
                <TimeField
                  label={t('to')}
                  value={minToHhMm(w.endMin)}
                  onCommit={(min) => patchWindow(i, { endMin: min })}
                  invalidLabel={t('invalidTime')}
                  placeholder={t('timePlaceholder')}
                />
              </View>

              <Text style={styles.label}>{t('days')}</Text>
              <View style={styles.daysRow}>
                {dayLabels.map((d, day) => {
                  const on = (w.days ?? []).includes(day);
                  return (
                    <Pressable
                      key={day}
                      style={[styles.dayChip, on && styles.dayChipOn]}
                      onPress={() => toggleDay(i, day)}
                    >
                      <Text style={[styles.dayText, on && styles.dayTextOn]}>{d}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {(w.days ?? []).length === 0 ? (
                <Body muted>{t('everyDay')}</Body>
              ) : null}

              <Button title={t('remove')} variant="danger" onPress={() => removeWindow(i)} />
            </Card>
          ))}
          <Button title={t('addWindow')} variant="secondary" onPress={addWindow} />
        </View>
      ) : null}
    </Screen>
  );
}

function TimeField({
  label,
  value,
  onCommit,
  invalidLabel,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (min: number) => void;
  invalidLabel: string;
  placeholder: string;
}) {
  const [text, setText] = useState(value);
  const [err, setErr] = useState(false);
  const commit = () => {
    try {
      onCommit(parseHhMm(text));
      setErr(false);
    } catch {
      setErr(true);
    }
  };
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, err && styles.inputErr]}
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType="numbers-and-punctuation"
      />
      {err ? <Text style={styles.errText}>{invalidLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  timeRow: { flexDirection: 'row', gap: spacing.md },
  label: { color: colors.mutedForeground, fontSize: typography.fontSize.sm },
  input: {
    backgroundColor: colors.background,
    color: colors.foreground,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
  },
  inputErr: { borderColor: colors.destructive },
  errText: { color: colors.destructive, fontSize: typography.fontSize.xs },
  daysRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipOn: { backgroundColor: colors.lime },
  dayText: { color: colors.foreground, fontSize: typography.fontSize.sm },
  dayTextOn: { color: colors.primaryForeground, fontWeight: typography.weight.bold },
});
