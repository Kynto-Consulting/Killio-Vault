import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { useCapture } from '@/capture/CaptureContext';
import { searchDiary, type DiarySearchHit } from '@/core/api/vault.client';
import { flushOutbox, localDate } from '@/db/outbox';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

export default function DiaryScreen() {
  const t = useTranslations('diary');
  const { personalTeam } = useAuth();
  const { pending, refreshPending } = useCapture();
  const [hits, setHits] = useState<DiarySearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const today = localDate(Date.now());

  const load = useCallback(async () => {
    if (!personalTeam?.id) return;
    setLoading(true);
    try {
      setHits(await searchDiary({ teamId: personalTeam.id, date: today }));
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [personalTeam?.id, today]);

  useEffect(() => {
    void load();
  }, [load]);

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
        data={hits}
        keyExtractor={(h) => h.brickId}
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
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-px bg-border/50 my-1" />}
      />
    </Screen>
  );
}

function formatHm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
