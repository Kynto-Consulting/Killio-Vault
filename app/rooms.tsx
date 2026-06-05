import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Hash, MessageCircle, Users } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import {
  findOrCreateDm,
  listTeamRooms,
  type Room,
} from '@/core/api/rooms.client';
import { api } from '@/core/api/http';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

interface MemberRow {
  id: string;
  name: string;
  primaryEmail?: string | null;
  avatarUrl?: string | null;
}

/**
 * Team rooms + workspace members in a single list. Tap a room to open the
 * chat; tap a member to (lazily) create a DM room and route into it.
 */
export default function RoomsScreen() {
  const router = useRouter();
  const t = useTranslations('roomsScreen');
  const { activeTeam } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      const [rs, ms] = await Promise.all([
        listTeamRooms(activeTeam.id),
        api.get<MemberRow[]>(`/teams/${activeTeam.id}/members`).then((r) => r.data ?? []),
      ]);
      setRooms(rs);
      setMembers(ms);
    } catch {
      setRooms([]);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDm = async (m: MemberRow) => {
    if (!activeTeam?.id) return;
    setDmPickerOpen(false);
    try {
      const room = await findOrCreateDm(activeTeam.id, m.id);
      router.push({ pathname: '/rooms/[id]', params: { id: room.id, name: m.name } });
    } catch {
      /* swallow */
    }
  };

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4 flex-row items-start justify-between">
        <View className="flex-1">
          <H1>{t('title')}</H1>
          <Body muted>{t('subtitle')}</Body>
        </View>
        <Pressable
          onPress={() => setDmPickerOpen(true)}
          className="h-9 flex-row items-center gap-1 rounded-md bg-primary px-3"
        >
          <Users size={13} color={colors.primaryForeground ?? '#171717'} />
          <Text
            style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
            className="text-xs"
          >
            {t('newDm')}
          </Text>
        </Pressable>
      </View>

      <FlatList
        className="mt-3"
        contentContainerClassName="px-5 pb-10 gap-2"
        data={rooms}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={
          <Card>
            <Body muted>{t('empty')}</Body>
          </Card>
        }
        renderItem={({ item }) => {
          const Icon = item.type === 'dm' ? MessageCircle : Hash;
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/rooms/[id]',
                  params: { id: item.id, name: item.name },
                })
              }
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <View className="h-9 w-9 items-center justify-center rounded-md bg-cyan/10">
                <Icon size={14} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-sm text-foreground"
                  numberOfLines={1}
                >
                  {item.emoji ? `${item.emoji} ` : ''}
                  {item.name}
                </Text>
                <Text className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {item.type}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      {/* DM picker modal */}
      <Modal
        visible={dmPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDmPickerOpen(false)}
      >
        <View className="flex-1 items-center justify-end bg-background/80">
          <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-2 max-h-[70%]">
            <Text style={{ fontFamily: fonts.bold }} className="text-base text-foreground">
              {t('pickMember')}
            </Text>
            <FlatList
              data={members}
              keyExtractor={(m) => m.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void openDm(item)}
                  className="flex-row items-center gap-3 rounded-md px-3 py-2 active:bg-secondary"
                >
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-secondary">
                    <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
                      {item.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontFamily: fonts.medium }}
                      className="text-sm text-foreground"
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.primaryEmail ? (
                      <Text className="text-[10px] text-muted-foreground">{item.primaryEmail}</Text>
                    ) : null}
                  </View>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
