import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, Check } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import {
  listNotifications,
  markAllAsRead,
  markAsRead,
  type NotificationRow,
} from '@/core/api/notifications.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Inbox / feed for the user's cloud notifications. Mirrors the web
 * NotificationsDrawer in a fullscreen mobile layout. Tapping an item marks
 * it read and follows the linkUrl when present (deep-links into /document,
 * /workspace etc.).
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const t = useTranslations('pushInbox');
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listNotifications());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (n: NotificationRow) => {
    if (!n.readAt) {
      try {
        await markAsRead(n.id);
        setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      } catch {
        /* swallow */
      }
    }
    if (n.linkUrl?.startsWith('/')) router.push(n.linkUrl as any);
  };

  const markAll = async () => {
    try {
      await markAllAsRead();
      const now = new Date().toISOString();
      setItems((cur) => cur.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    } catch {
      /* swallow */
    }
  };

  return (
    <Screen padded={false}>
      <View className="flex-row items-start justify-between px-5 pt-4">
        <H1>{t('title')}</H1>
        {items.some((x) => !x.readAt) ? (
          <Pressable
            onPress={markAll}
            className="h-9 flex-row items-center gap-1 rounded-md border border-border bg-secondary px-3"
          >
            <Check size={13} color={colors.foreground} />
            <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
              {t('markAllRead')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        className="mt-3"
        contentContainerClassName="px-5 pb-10 gap-2"
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={
          <Card>
            <View className="items-center justify-center py-10 gap-2 opacity-60">
              <Bell size={28} color={colors.mutedForeground} />
              <Body muted>{t('empty')}</Body>
            </View>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void open(item)}
            className={`rounded-xl border ${
              item.readAt ? 'border-border bg-card' : 'border-cyan/40 bg-cyan/5'
            } p-3 gap-1`}
          >
            <View className="flex-row items-start justify-between">
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="flex-1 text-sm text-foreground"
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text className="text-[10px] text-muted-foreground">
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text className="text-xs text-foreground/80">{item.message}</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
