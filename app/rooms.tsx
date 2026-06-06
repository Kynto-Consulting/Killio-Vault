import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronRight, Hash, MessageCircle, Users } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import {
  findOrCreateDm,
  listTeamRooms,
  listTeamRoomGroups,
  type Room,
  type RoomGroup,
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
  const [groups, setGroups] = useState<RoomGroup[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      const [rs, gs, ms] = await Promise.all([
        listTeamRooms(activeTeam.id),
        listTeamRoomGroups(activeTeam.id).catch(() => [] as RoomGroup[]),
        api.get<MemberRow[]>(`/teams/${activeTeam.id}/members`).then((r) => r.data ?? []),
      ]);
      setRooms(rs);
      setGroups(gs);
      setMembers(ms);
    } catch {
      setRooms([]);
      setGroups([]);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  // Build SectionList sections: one per room-group (in group sort order), then
  // a trailing "Other" section for any ungrouped room. This is what puts the
  // Vault assistant conversation rooms (groupId = the team's "Vault" group)
  // INSIDE the collapsible VAULT folder instead of loose below it.
  const sections = useMemo(() => {
    const byGroup = new Map<string, Room[]>();
    const ungrouped: Room[] = [];
    for (const r of rooms) {
      if (r.groupId) {
        const arr = byGroup.get(r.groupId) ?? [];
        arr.push(r);
        byGroup.set(r.groupId, arr);
      } else {
        ungrouped.push(r);
      }
    }
    const out: { key: string; title: string; emoji?: string | null; data: Room[] }[] = [];
    for (const g of groups) {
      const data = byGroup.get(g.id) ?? [];
      if (data.length === 0) continue;
      out.push({ key: g.id, title: g.name, emoji: g.emoji, data });
    }
    if (ungrouped.length > 0) {
      out.push({ key: '__ungrouped__', title: t('ungrouped'), data: ungrouped });
    }
    // Respect collapse state without dropping the header row.
    return out.map((s) => ({ ...s, data: collapsed[s.key] ? [] : s.data }));
  }, [rooms, groups, collapsed, t]);

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
          accessibilityRole="button"
          accessibilityLabel={t('newDm')}
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

      <SectionList
        className="mt-3"
        contentContainerClassName="px-5 pb-10 gap-2"
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
        ListEmptyComponent={
          <Card>
            <Body muted>{t('empty')}</Body>
          </Card>
        }
        renderSectionHeader={({ section }) => {
          const isCollapsed = !!collapsed[section.key];
          const Chevron = isCollapsed ? ChevronRight : ChevronDown;
          return (
            <Pressable
              onPress={() =>
                setCollapsed((prev) => ({ ...prev, [section.key]: !prev[section.key] }))
              }
              className="flex-row items-center gap-1.5 px-1 pt-2 pb-1"
              accessibilityRole="button"
              accessibilityLabel={section.title}
            >
              <Chevron size={14} color={colors.mutedForeground} />
              <Text
                style={{ fontFamily: fonts.bold }}
                className="text-[11px] uppercase tracking-widest text-muted-foreground"
                numberOfLines={1}
              >
                {section.emoji ? `${section.emoji} ` : ''}
                {section.title}
              </Text>
            </Pressable>
          );
        }}
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
              accessibilityRole="button"
              accessibilityLabel={item.name}
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
