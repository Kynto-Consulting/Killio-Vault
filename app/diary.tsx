import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { useCapture } from '@/capture/CaptureContext';
import { searchDiary, type DiarySearchHit } from '@/core/api/vault.client';
import { flushOutbox, localDate, getLocalSegments, onDiaryChanged } from '@/db/outbox';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

export default function DiaryScreen() {
  const t = useTranslations('diary');
  const { activeTeam } = useAuth();
  const { pending, refreshPending } = useCapture();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const today = localDate(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    // Local-first: show on-device transcripts immediately (incl. not-yet-
    // uploaded "pending" ones), then merge in the server diary (deduped by ts,
    // server wins). So you see what you just said without waiting for a flush.
    const local = getLocalSegments(today);
    let hits: DiarySearchHit[] = [];
    try {
      if (activeTeam?.id) hits = await searchDiary({ teamId: activeTeam.id, date: today });
    } catch { /* offline — local only */ }
    const byTs = new Map<number, DiaryEntry>();
    for (const l of local) byTs.set(l.ts, { key: `l-${l.ts}`, ts: l.ts, text: l.text, pending: l.pending });
    for (const h of hits) byTs.set(h.ts, { key: h.brickId, ts: h.ts, text: h.text, pending: false });
    setEntries([...byTs.values()].sort((a, b) => a.ts - b.ts));
    setLoading(false);
  }, [activeTeam?.id, today]);

  useEffect(() => {
    void load();
  }, [load]);

  // Real-time: re-load the local-first view the instant a new transcript is
  // enqueued (independent of voice-ID/wake). Only reacts to today's date so a
  // late segment for a prior day doesn't churn the current view.
  useEffect(() => {
    const unsub = onDiaryChanged((date) => {
      if (date === today) void load();
    });
    return unsub;
  }, [load, today]);

  const syncNow = async () => {
    await flushOutbox();
    refreshPending();
    await load();
  };

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4">
        <H1>{t('title', { date: today })}</H1>
        <View className="flex-row items-center justify-between">
          <Body muted>{t('pending', { n: pending })}</Body>
          <Pressable
            onPress={syncNow}
            className="flex-row items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 active:opacity-80"
          >
            <RefreshCw size={14} color={colors.foreground} />
            <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
              {t('sync')}
            </Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        className="mt-2"
        contentContainerClassName="px-5 pb-6"
        data={entries}
        keyExtractor={(e) => e.key}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={
          <Card>
            <Body muted>{t('empty')}</Body>
          </Card>
        }
        renderItem={({ item }) => (
          <View className="flex-row gap-3 py-1.5">
            <Text style={{ fontFamily: fonts.mono }} className="w-12 text-sm text-muted-foreground">
              {formatHm(item.ts)}
            </Text>
            <Text className="flex-1 text-base leading-6 text-foreground">{item.text}</Text>
            {item.pending ? (
              <Text className="text-[10px] text-muted-foreground self-center">●</Text>
            ) : null}
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-px bg-border/50 my-1" />}
      />
    </Screen>
  );
}

interface DiaryEntry {
  key: string;
  ts: number;
  text: string;
  /** Not yet uploaded to the server diary (local-only). */
  pending: boolean;
}

function formatHm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
