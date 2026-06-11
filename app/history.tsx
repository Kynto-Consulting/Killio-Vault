import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, MessageSquare } from 'lucide-react-native';

import { Screen, H1, Body } from '@/ui';
import { stripMarkup } from '@/ui/ai-markup';
import { useAuth } from '@/core/auth/AuthContext';
import { listConversations, type ConversationSummary } from '@/core/api/agent.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/** ChatGPT-style conversation history (reuses the agent conversation store). */
export default function HistoryScreen() {
  const router = useRouter();
  const t = useTranslations('history');
  const { activeTeam } = useAuth();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      setItems(await listConversations(activeTeam.id));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4">
        <H1>{t('title')}</H1>
        <Body muted>{t('subtitle')}</Body>
      </View>
      <FlatList
        className="mt-3"
        contentContainerClassName="px-5 pb-6 gap-2"
        data={items}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={<Body muted>{t('empty')}</Body>}
        renderItem={({ item }) => (
          <Pressable
            className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3.5 active:opacity-80"
            onPress={() => router.push({ pathname: '/assistant', params: { conversationId: item.id } })}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-secondary">
              <MessageSquare size={16} color={colors.cyan} />
            </View>
            <View className="flex-1">
              <Text style={{ fontFamily: fonts.medium }} className="text-base text-foreground" numberOfLines={1}>
                {stripMarkup(String(item.title || item.preview || '')) || t('conversation')}
              </Text>
              {item.preview ? (
                <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                  {stripMarkup(String(item.preview))}
                </Text>
              ) : null}
            </View>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      />
    </Screen>
  );
}
