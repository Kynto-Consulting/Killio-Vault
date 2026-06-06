import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  ChevronRight,
  CircleDot,
  Lock,
  Mail,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';

import { Screen, Card, H1, Body, Label, Button } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { useLocalWorkspace } from '@/local-workspace/LocalWorkspaceProvider';
import {
  getTeamMetrics,
  listTeamActivity,
  listTeamInvites,
  listTeamMembers,
  removeMember,
  revokeInvite,
  updateMemberAlias,
  updateMemberRole,
  type TeamActivity,
  type TeamInvite,
  type TeamMember,
  type TeamMetrics,
} from '@/core/api/teams.client';
import { me as fetchMe } from '@/core/api/auth.client';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

type Tab = 'members' | 'invites' | 'activity';

const ASSIGNABLE_ROLES: Array<'admin' | 'member' | 'viewer' | 'guest'> = [
  'admin',
  'member',
  'viewer',
  'guest',
];

function roleColor(role?: string): string {
  const r = (role ?? '').toLowerCase();
  if (r === 'owner') return colors.lime;
  if (r === 'admin') return colors.indigo;
  if (r === 'member') return colors.cyan;
  if (r === 'viewer' || r === 'guest') return colors.mutedForeground;
  return colors.mutedForeground;
}

function memberDisplay(m: TeamMember): string {
  return (
    m.alias?.trim() ||
    m.workspaceAlias?.trim() ||
    m.displayName?.trim() ||
    m.name?.trim() ||
    m.email ||
    m.primaryEmail ||
    '—'
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * Vault workspace members + invites + activity screen. Mirrors the Killio web
 * `/teams` page 1:1 in capability, adapted to mobile UX:
 *  • Dropdown menus become bottom-sheet action modals.
 *  • Inline tables become FlatList rows with right-side action buttons.
 *  • Long-press on a member row opens its action sheet.
 */
export default function TeamsScreen() {
  const router = useRouter();
  const t = useTranslations('teams');
  const local = useLocalWorkspace();
  const { activeTeam } = useAuth();

  if (local.mode === 'local') {
    // /teams is cloud-only — redirect local-mode users back to workspace home.
    return <Redirect href="/workspace" />;
  }

  const teamId = activeTeam?.id ?? null;

  const [tab, setTab] = useState<Tab>('members');
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [activity, setActivity] = useState<TeamActivity[]>([]);
  const [metrics, setMetrics] = useState<TeamMetrics | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Action sheets for a member.
  const [actionMember, setActionMember] = useState<TeamMember | null>(null);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasOpen, setAliasOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = (await fetchMe()) as { id?: string };
        if (data?.id) setMe({ id: data.id });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadAll = useCallback(async () => {
    if (!teamId) return;
    setRefreshing(true);
    try {
      const [mm, ii, aa, mx] = await Promise.allSettled([
        listTeamMembers(teamId),
        listTeamInvites(teamId),
        listTeamActivity(teamId),
        getTeamMetrics(teamId),
      ]);
      if (mm.status === 'fulfilled') setMembers(mm.value);
      if (ii.status === 'fulfilled') setInvites(ii.value);
      if (aa.status === 'fulfilled') setActivity(aa.value);
      if (mx.status === 'fulfilled') setMetrics(mx.value);
    } finally {
      setRefreshing(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Realtime: subscribe to team:<id> so changes from the web propagate live.
  // Backend now emits these (task #13). Every event fans loadAll() which kicks
  // 4 parallel HTTP calls (members + invites + activity + metrics) — bursts of
  // events (e.g. accept-invite emits both invite.accepted AND member.added)
  // would multiply that. Coalesce into a single trailing reload via a 300ms
  // debounced ref-based scheduler.
  const debouncedReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (debouncedReloadTimer.current) clearTimeout(debouncedReloadTimer.current);
    debouncedReloadTimer.current = setTimeout(() => {
      debouncedReloadTimer.current = null;
      void loadAll();
    }, 300);
  }, [loadAll]);
  useEffect(
    () => () => {
      if (debouncedReloadTimer.current) clearTimeout(debouncedReloadTimer.current);
    },
    [],
  );
  useRealtimeChannel(teamId ? `team:${teamId}` : null, {
    enabled: !!teamId,
    events: {
      'member.added': scheduleReload,
      'member.removed': scheduleReload,
      'member.left': scheduleReload,
      'member.role_changed': scheduleReload,
      'member.alias_updated': scheduleReload,
      'invite.sent': scheduleReload,
      'invite.revoked': scheduleReload,
      'invite.accepted': scheduleReload,
    },
  });

  const pendingInvites = useMemo(
    () => invites.filter((i) => i.status === 'pending'),
    [invites],
  );

  const isOwnerActor = useMemo(() => {
    if (!me) return false;
    const myMembership = members.find((m) => m.id === me.id);
    return (myMembership?.role ?? '').toLowerCase() === 'owner';
  }, [me, members]);
  const canManageMembers = useMemo(() => {
    if (!me) return false;
    const myMembership = members.find((m) => m.id === me.id);
    const r = (myMembership?.role ?? '').toLowerCase();
    return r === 'owner' || r === 'admin';
  }, [me, members]);

  const planLabel = activeTeam?.isPersonal
    ? t('personalBadge')
    : t('planBadge', { tier: (activeTeam?.planTier ?? 'free').toUpperCase() });

  const openInvite = () => router.push('/teams/invite');

  const closeMemberActions = () => {
    setActionMember(null);
    setRolePickerOpen(false);
    setAliasOpen(false);
    setAliasDraft('');
  };

  const onPickRole = async (role: string) => {
    if (!teamId || !actionMember?.membershipId) return;
    try {
      await updateMemberRole(teamId, actionMember.membershipId, role);
      closeMemberActions();
      await loadAll();
    } catch (e: any) {
      Alert.alert('Error', String(e?.response?.data?.message ?? e?.message ?? e));
    }
  };

  const onSaveAlias = async () => {
    if (!teamId || !actionMember?.membershipId) return;
    try {
      const trimmed = aliasDraft.trim();
      await updateMemberAlias(teamId, actionMember.membershipId, trimmed.length ? trimmed : null);
      closeMemberActions();
      await loadAll();
    } catch (e: any) {
      Alert.alert('Error', String(e?.response?.data?.message ?? e?.message ?? e));
    }
  };

  const onRemove = () => {
    if (!teamId || !actionMember?.membershipId) return;
    const name = memberDisplay(actionMember);
    const id = actionMember.membershipId;
    Alert.alert(
      t('removeConfirmTitle'),
      t('removeConfirmBody', { name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMember(teamId, id);
              closeMemberActions();
              await loadAll();
            } catch (e: any) {
              Alert.alert('Error', String(e?.response?.data?.message ?? e?.message ?? e));
            }
          },
        },
      ],
    );
  };

  const onRevokeInvite = (invite: TeamInvite) => {
    if (!teamId) return;
    Alert.alert(
      t('revokeConfirmTitle'),
      t('revokeConfirmBody', { email: invite.email }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('revoke'),
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeInvite(teamId, invite.id);
              await loadAll();
            } catch (e: any) {
              Alert.alert('Error', String(e?.response?.data?.message ?? e?.message ?? e));
            }
          },
        },
      ],
    );
  };

  if (!teamId) {
    return (
      <Screen>
        <H1>{t('title')}</H1>
        <Body muted>{t('noMembers')}</Body>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4 gap-3">
        {/* Header */}
        <View className="flex-row items-start justify-between gap-2">
          <View style={{ flex: 1 }}>
            <H1>{activeTeam?.name ?? t('title')}</H1>
            <View className="flex-row items-center gap-2">
              {activeTeam?.isPersonal ? (
                <View className="flex-row items-center gap-1 rounded-full border border-indigo/30 bg-indigo/10 px-2 py-0.5">
                  <Lock size={10} color={colors.indigo} />
                  <Text
                    style={{ fontFamily: fonts.semibold, color: colors.indigo }}
                    className="text-[10px] uppercase tracking-wider"
                  >
                    {planLabel}
                  </Text>
                </View>
              ) : (
                <View className="rounded-full border border-border bg-secondary px-2 py-0.5">
                  <Text
                    style={{ fontFamily: fonts.semibold, color: colors.mutedForeground }}
                    className="text-[10px] uppercase tracking-wider"
                  >
                    {planLabel}
                  </Text>
                </View>
              )}
              <Text className="text-xs text-muted-foreground">{t('subtitle')}</Text>
            </View>
          </View>
          <Pressable
            onPress={openInvite}
            disabled={activeTeam?.isPersonal === true}
            style={{ opacity: activeTeam?.isPersonal ? 0.4 : 1 }}
            className="h-9 flex-row items-center gap-1 rounded-full bg-lime px-3"
            accessibilityLabel={t('addMember')}
          >
            <UserPlus size={13} color={colors.background} />
            <Text
              style={{ fontFamily: fonts.semibold, color: colors.background }}
              className="text-xs"
            >
              {t('addMember')}
            </Text>
          </Pressable>
        </View>

        {/* Metrics strip */}
        <View className="flex-row gap-2">
          <MetricChip label={t('metric.members', { n: metrics?.membersCount ?? members.length })} />
          <MetricChip label={t('metric.invites', { n: metrics?.pendingInvites ?? pendingInvites.length })} />
          {metrics?.storageBytes != null && (
            <MetricChip label={t('metric.storage', { label: humanBytes(metrics.storageBytes) })} />
          )}
        </View>

        {/* Tabs */}
        <View className="flex-row rounded-xl border border-border bg-background p-1">
          {(['members', 'invites', 'activity'] as const).map((k) => {
            const active = tab === k;
            const count =
              k === 'members'
                ? members.length
                : k === 'invites'
                  ? pendingInvites.length
                  : activity.length;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                className={`flex-1 items-center justify-center rounded-lg py-2 ${active ? 'bg-secondary' : ''}`}
              >
                <Text
                  style={{ fontFamily: active ? fonts.semibold : fonts.medium }}
                  className={`text-xs ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {k === 'members'
                    ? t('tabMembers')
                    : k === 'invites'
                      ? t('tabInvites')
                      : t('tabActivity')}
                  <Text className="text-muted-foreground"> · {count}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Body */}
      {tab === 'members' && (
        <FlatList
          data={members}
          keyExtractor={(m) => m.membershipId ?? m.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 8 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor={colors.foreground} />
          }
          ListEmptyComponent={
            <View className="px-5 py-8 items-center">
              <Body muted>{t('noMembers')}</Body>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = !!me && item.id === me.id;
            const name = memberDisplay(item);
            const email = item.primaryEmail ?? item.email ?? '';
            const role = (item.role ?? '').toLowerCase();
            const roleHex = roleColor(role);
            const ownerLockedForNonOwner = role === 'owner' && !isOwnerActor;
            const canAct = !isMe && (canManageMembers || isMe) && !ownerLockedForNonOwner;
            return (
              <Pressable
                onLongPress={canAct ? () => setActionMember(item) : undefined}
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
              >
                <View
                  style={{
                    backgroundColor: `${colors.cyan}1a`,
                    borderColor: `${colors.cyan}44`,
                  }}
                  className="h-9 w-9 items-center justify-center rounded-full border"
                >
                  <Text
                    style={{ fontFamily: fonts.bold, color: colors.cyan }}
                    className="text-sm"
                  >
                    {(name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-center gap-1">
                    <Text
                      style={{ fontFamily: fonts.semibold, color: colors.foreground }}
                      className="text-sm"
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    {isMe && (
                      <Text
                        style={{ fontFamily: fonts.semibold, color: colors.lime }}
                        className="text-[10px] uppercase tracking-wider"
                      >
                        · {t('you')}
                      </Text>
                    )}
                  </View>
                  {!!email && (
                    <Text
                      style={{ color: colors.mutedForeground }}
                      className="text-xs"
                      numberOfLines={1}
                    >
                      {email}
                    </Text>
                  )}
                </View>
                <View
                  style={{
                    borderColor: `${roleHex}55`,
                    backgroundColor: `${roleHex}1a`,
                  }}
                  className="rounded-full border px-2 py-0.5"
                >
                  <Text
                    style={{ fontFamily: fonts.semibold, color: roleHex }}
                    className="text-[10px] uppercase tracking-wider"
                  >
                    {t(`role.${role || 'member'}`)}
                  </Text>
                </View>
                {canAct && (
                  <Pressable
                    hitSlop={8}
                    onPress={() => setActionMember(item)}
                    className="p-1"
                  >
                    <MoreHorizontal size={16} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </Pressable>
            );
          }}
        />
      )}

      {tab === 'invites' && (
        <FlatList
          data={pendingInvites}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 8 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor={colors.foreground} />
          }
          ListEmptyComponent={
            <View className="px-5 py-8 items-center">
              <Body muted>{t('noInvites')}</Body>
            </View>
          }
          renderItem={({ item }) => {
            const roleHex = roleColor(item.role);
            return (
              <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                <View className="h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary">
                  <Mail size={14} color={colors.mutedForeground} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{ fontFamily: fonts.semibold, color: colors.foreground }}
                    className="text-sm"
                    numberOfLines={1}
                  >
                    {item.email}
                  </Text>
                  <Text style={{ color: colors.mutedForeground }} className="text-xs">
                    {formatRelative(item.createdAt)} · {item.deliveryStatus ?? item.status}
                  </Text>
                </View>
                <View
                  style={{
                    borderColor: `${roleHex}55`,
                    backgroundColor: `${roleHex}1a`,
                  }}
                  className="rounded-full border px-2 py-0.5"
                >
                  <Text
                    style={{ fontFamily: fonts.semibold, color: roleHex }}
                    className="text-[10px] uppercase tracking-wider"
                  >
                    {t(`role.${(item.role ?? 'member').toLowerCase()}`)}
                  </Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() => onRevokeInvite(item)}
                  className="ml-1 h-8 w-8 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10"
                  accessibilityLabel={t('revoke')}
                >
                  <X size={14} color={colors.destructive} />
                </Pressable>
              </View>
            );
          }}
        />
      )}

      {tab === 'activity' && (
        <FlatList
          data={activity}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 6 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor={colors.foreground} />
          }
          ListEmptyComponent={
            <View className="px-5 py-8 items-center">
              <Body muted>{t('noActivity')}</Body>
            </View>
          }
          renderItem={({ item }) => {
            const { Icon, color, message } = renderActivity(item, t);
            return (
              <View className="flex-row items-start gap-3 rounded-xl border border-border bg-card px-3 py-2">
                <View
                  style={{ backgroundColor: `${color}1a`, borderColor: `${color}44` }}
                  className="h-7 w-7 items-center justify-center rounded-full border"
                >
                  <Icon size={12} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: colors.foreground, fontFamily: fonts.medium }}
                    className="text-sm"
                  >
                    {message}
                  </Text>
                  <Text style={{ color: colors.mutedForeground }} className="text-[10px]">
                    {formatRelative(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Member action sheet (bottom modal) */}
      <Modal
        visible={!!actionMember}
        transparent
        animationType="fade"
        onRequestClose={closeMemberActions}
      >
        <Pressable
          onPress={closeMemberActions}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surface,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingBottom: 28,
          }}
        >
          {actionMember && (
            <View className="px-4 pt-4 gap-3">
              <View className="flex-row items-center justify-between">
                <Text
                  style={{ fontFamily: fonts.semibold, color: colors.foreground }}
                  className="text-base"
                  numberOfLines={1}
                >
                  {memberDisplay(actionMember)}
                </Text>
                <Pressable hitSlop={10} onPress={closeMemberActions}>
                  <X size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {!rolePickerOpen && !aliasOpen && (
                <View className="gap-1">
                  {canManageMembers && me?.id !== actionMember.id && (actionMember.role ?? '').toLowerCase() !== 'owner' && (
                    <SheetRow
                      Icon={UserPlus}
                      label={t('changeRole')}
                      onPress={() => setRolePickerOpen(true)}
                    />
                  )}
                  <SheetRow
                    Icon={Pencil}
                    label={t('setAlias')}
                    onPress={() => {
                      setAliasDraft(actionMember.alias ?? actionMember.workspaceAlias ?? '');
                      setAliasOpen(true);
                    }}
                  />
                  {(actionMember.role ?? '').toLowerCase() !== 'owner' && (
                    <SheetRow
                      Icon={UserMinus}
                      label={t('remove')}
                      destructive
                      onPress={onRemove}
                    />
                  )}
                </View>
              )}

              {rolePickerOpen && (
                <View className="gap-1">
                  <Label>{t('selectRole')}</Label>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => onPickRole(r)}
                      className="flex-row items-center justify-between rounded-lg px-3 py-2 border border-border bg-background"
                    >
                      <Text
                        style={{ color: roleColor(r), fontFamily: fonts.semibold }}
                        className="text-sm uppercase tracking-wider"
                      >
                        {t(`role.${r}`)}
                      </Text>
                      <ChevronRight size={14} color={colors.mutedForeground} />
                    </Pressable>
                  ))}
                </View>
              )}

              {aliasOpen && (
                <View className="gap-2">
                  <Label>{t('setAlias')}</Label>
                  <TextInput
                    value={aliasDraft}
                    onChangeText={setAliasDraft}
                    placeholder={t('aliasPlaceholder')}
                    placeholderTextColor={colors.mutedForeground}
                    autoFocus
                    style={{ fontFamily: fonts.regular, color: colors.foreground }}
                    className="rounded-xl border border-border bg-background px-4 py-3 text-sm"
                  />
                  <View className="flex-row gap-2 mt-1">
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('cancel')}
                        onPress={() => setAliasOpen(false)}
                        variant="secondary"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title={t('save')} onPress={onSaveAlias} variant="primary" />
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>
    </Screen>
  );
}

// ── Small presentational helpers ────────────────────────────────────────────

function MetricChip({ label }: { label: string }) {
  return (
    <View className="rounded-full border border-border bg-secondary px-3 py-1">
      <Text
        style={{ fontFamily: fonts.medium, color: colors.foreground }}
        className="text-[11px]"
      >
        {label}
      </Text>
    </View>
  );
}

function SheetRow({
  Icon,
  label,
  onPress,
  destructive,
}: {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const color = destructive ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg px-3 py-3 border border-border bg-background"
    >
      <Icon size={16} color={color} />
      <Text
        style={{ color, fontFamily: 'Inter-Medium' }}
        className="flex-1 text-sm"
      >
        {label}
      </Text>
      <ChevronRight size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

function humanBytes(n: number): string {
  if (!n) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)}${units[i]}`;
}

function renderActivity(
  a: TeamActivity,
  t: (key: string, params?: Record<string, string | number>) => string,
): {
  Icon: LucideIcon;
  color: string;
  message: string;
} {
  const action = a.type;
  const payload = a.payload ?? {};
  const actor = a.actor ?? '';
  const shortActor = actor ? `${actor.slice(0, 6)}…` : '?';
  const role = String(payload.role ?? '');
  const email = String(payload.email ?? '');

  switch (action) {
    case 'team.invite.created':
      return {
        Icon: Mail,
        color: colors.cyan,
        message: t('activity.inviteSent', { actor: shortActor, email, role }),
      };
    case 'team.invite.accepted':
      return {
        Icon: UserPlus,
        color: colors.success,
        message: t('activity.inviteAccepted', { actor: shortActor }),
      };
    case 'team.invite.revoked':
      return {
        Icon: X,
        color: colors.destructive,
        message: t('activity.inviteRevoked', { actor: shortActor }),
      };
    case 'team.member.role_changed':
      return {
        Icon: UserPlus,
        color: colors.indigo,
        message: t('activity.roleChanged', { actor: shortActor, role }),
      };
    case 'team.member.alias_updated':
      return {
        Icon: Pencil,
        color: colors.mutedForeground,
        message: t('activity.aliasChanged', { actor: shortActor }),
      };
    case 'team.member.left':
      return {
        Icon: UserMinus,
        color: colors.warning,
        message: t('activity.memberLeft', { actor: shortActor }),
      };
    case 'team.member.removed':
      return {
        Icon: Trash2,
        color: colors.destructive,
        message: t('activity.memberRemoved', { actor: shortActor }),
      };
    case 'team.member.added':
      return {
        Icon: Users,
        color: colors.success,
        message: t('activity.memberAdded', { actor: shortActor }),
      };
    default:
      return {
        Icon: CircleDot,
        color: colors.mutedForeground,
        message: t('activity.generic', { action }),
      };
  }
}
