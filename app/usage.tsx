import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Sparkles, RotateCcw } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { getUsage, resetDate, daysUntil, type AiUsage } from '@/core/api/usage.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

export default function UsageScreen() {
  const t = useTranslations('usage');
  const { activeTeam } = useAuth();
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      setUsage(await getUsage(activeTeam.id));
    } catch {
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const limit = usage?.limit ?? 0;
  const used = usage?.creditsUsed ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const reset = usage ? resetDate(usage.periodStart) : null;
  const days = reset ? daysUntil(reset) : 0;
  const barColor = pct >= 90 ? colors.destructive : pct >= 70 ? colors.warning : colors.cyan;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerClassName="p-5 gap-3"
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
      >
        <H1>{t('title')}</H1>
        <Body muted>{t('subtitle')}</Body>

        <Card className="mt-1">
          <View className="flex-row items-center gap-2">
            <Sparkles size={16} color={colors.cyan} />
            <Text style={{ fontFamily: fonts.semibold }} className="text-base text-foreground">
              {t('credits')}
            </Text>
          </View>

          {/* % bar (Claude-style) */}
          <View className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <View
              style={{ width: `${pct}%`, backgroundColor: barColor }}
              className="h-full rounded-full"
            />
          </View>

          <View className="mt-2 flex-row items-baseline justify-between">
            <Text style={{ fontFamily: fonts.bold }} className="text-2xl text-foreground">
              {pct}%
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t('usedOf', { used: round(used), limit: round(limit) })}
            </Text>
          </View>
          <Body muted>{t('remaining', { n: round(usage?.remaining ?? 0) })}</Body>
        </Card>

        <Card>
          <View className="flex-row items-center gap-2">
            <RotateCcw size={16} color={colors.mutedForeground} />
            <Text style={{ fontFamily: fonts.medium }} className="text-base text-foreground">
              {t('resetsIn', { n: days })}
            </Text>
          </View>
          {reset ? (
            <Body muted>{t('resetsOn', { date: reset.toLocaleDateString() })}</Body>
          ) : null}
          {usage ? <Body muted>{t('tokens', { n: usage.tokensUsed.toLocaleString() })}</Body> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
