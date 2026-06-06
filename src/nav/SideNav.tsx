import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import {
  BarChart3,
  Bell,
  Bot,
  Blocks,
  Brain,
  CalendarClock,
  Check,
  ChevronsUpDown,
  FileText,
  History,
  Kanban as KanbanIcon,
  LogOut,
  Mic,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Settings,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useRef, useState } from 'react';

import { useNav } from './NavContext';
import { useAppMode, type AppMode } from './AppModeContext';
import { useAuth } from '../core/auth/AuthContext';
import { useLocalWorkspace } from '../local-workspace/LocalWorkspaceProvider';
import { createTeam } from '../core/api/teams.client';
import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

type Route =
  | '/home' | '/diary' | '/assistant' | '/history' | '/agents'
  | '/integrations' | '/schedule' | '/usage' | '/settings'
  | '/documents' | '/workspace' | '/local-workspaces'
  | '/memories' | '/search' | '/notifications' | '/rooms' | '/b' | '/teams';

interface Item {
  key: string;
  icon: LucideIcon;
  route: Route;
}

const VAULT_ITEMS: Item[] = [
  { key: 'assistant', icon: MessageSquare, route: '/assistant' },
  { key: 'history', icon: History, route: '/history' },
  { key: 'diary', icon: Mic, route: '/diary' },
  { key: 'agents', icon: Bot, route: '/agents' },
  { key: 'memories', icon: Brain, route: '/memories' },
  { key: 'search', icon: Search, route: '/search' },
  { key: 'notifications', icon: Bell, route: '/notifications' },
  { key: 'integrations', icon: Blocks, route: '/integrations' },
  { key: 'schedule', icon: CalendarClock, route: '/schedule' },
  { key: 'usage', icon: BarChart3, route: '/usage' },
  { key: 'settings', icon: SlidersHorizontal, route: '/settings' },
];

const WORKSPACE_ITEMS: Item[] = [
  { key: 'workspace', icon: BarChart3, route: '/workspace' },
  { key: 'documents', icon: FileText, route: '/documents' },
  { key: 'boards', icon: KanbanIcon, route: '/b' },
  { key: 'rooms', icon: MessageSquare, route: '/rooms' },
  { key: 'teams', icon: Users, route: '/teams' },
];

function itemsForMode(mode: AppMode, isLocal: boolean): Item[] {
  if (mode !== 'workspace') return VAULT_ITEMS;
  // `/teams` is cloud-only; hide it when the user is in a local workspace.
  return isLocal ? WORKSPACE_ITEMS.filter((it) => it.key !== 'teams') : WORKSPACE_ITEMS;
}

/**
 * Left slide-in drawer mirroring Killio-Frontend's mobile-nav-sheet:
 * bg-card panel, rounded-r-2xl, workspace header (icon box + name + "Killio"),
 * lucide nav items with active highlight, user footer.
 */
export function SideNav() {
  const { open, closeNav } = useNav();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('nav');
  const tSide = useTranslations('sidenav');
  const tFallback = useTranslations('fallback');
  const { activeTeam, workspaces, setActiveTeam, signOut, refreshWorkspaces } = useAuth();
  const { mode, setMode } = useAppMode();
  const local = useLocalWorkspace();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Debounce duplicate touch delivery: on a freshly-shown Android fade Modal the
  // first gesture can arrive as two near-instant presses. Without this, the
  // second press would immediately re-toggle (and re-close) the picker. We
  // ignore any toggle that lands within DEBOUNCE_MS of the previous one.
  const lastToggleAt = useRef(0);
  const togglePicker = () => {
    const now = Date.now();
    if (now - lastToggleAt.current < 350) return;
    lastToggleAt.current = now;
    setPickerOpen((v) => !v);
  };
  const [creatingCloud, setCreatingCloud] = useState(false);
  const [newCloudName, setNewCloudName] = useState('');
  const [submittingCloud, setSubmittingCloud] = useState(false);
  const items = itemsForMode(mode, local.mode === 'local');

  const submitNewCloud = async () => {
    const name = newCloudName.trim();
    if (!name || submittingCloud) return;
    setSubmittingCloud(true);
    try {
      const team = await createTeam({ name });
      if (refreshWorkspaces) await refreshWorkspaces();
      await setActiveTeam(team.id);
      setNewCloudName('');
      setCreatingCloud(false);
      setPickerOpen(false);
      closeNav();
      requestAnimationFrame(() => router.push('/workspace'));
    } catch (e: any) {
      Alert.alert('Error', String(e?.response?.data?.message ?? e?.message ?? e));
    } finally {
      setSubmittingCloud(false);
    }
  };

  const isLocal = local.mode === 'local';
  const workspaceName = isLocal
    ? local.active?.name ?? tFallback('local')
    : activeTeam?.name ?? tFallback('workspace');
  const initial = workspaceName.charAt(0).toUpperCase();

  const go = (route: Route) => {
    closeNav();
    // Defer navigation a tick so the Modal fully unmounts on Android first â€”
    // navigating mid-close leaves a ghost overlay that swallows touches and
    // blocks reopening the drawer the second time.
    requestAnimationFrame(() => {
      router.push(route);
    });
  };

  // Render the Modal ONLY when open so it fully unmounts on close â€” otherwise a
  // transparent overlay can linger on Android and swallow all touches (the menu
  // button stops responding after the first close).
  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeNav} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        {/* Backdrop (full screen, behind panel) */}
        <Pressable
          onPress={closeNav}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          className="bg-background/80"
        />
        {/* Panel â€” absolute, left */}
        <SafeAreaView
          edges={['top', 'bottom', 'left']}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '84%', maxWidth: 360 }}
          className="rounded-r-2xl border-r border-border bg-card"
        >
          {/* Header — tapping the workspace block opens the picker */}
          <View className="border-b border-border/60">
            <View className="flex-row items-center justify-between p-4">
              {/*
                ROOT CAUSE of the unreliable workspace switcher:
                There were TWO adjacent Pressables — the workspace block
                (`setPickerOpen(true)`, open-only) and a separate chevron
                (`setPickerOpen((v) => !v)`, toggle). On a fade `Modal` Android
                can deliver the first gesture as a rapid press/again pair; a stray
                re-fire on the chevron toggled the freshly-opened picker straight
                back to closed, and the open-only block couldn't recover it — so
                it took several taps to land in the open state.
                FIX: collapse the two into ONE big, idempotent toggle target (the
                whole workspace row + chevron). `toggle` is a stable functional
                updater, but because it's the SOLE handler for the whole region
                there's no second control fighting it: a duplicate touch within
                the same row is debounced (see `togglePicker`). One tap opens,
                one tap closes — every time. Large hitSlop + a11y make the chip an
                easy target; the chevron rotates to signal state.
              */}
              <Pressable
                className="flex-1 flex-row items-center gap-3"
                onPress={togglePicker}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`${workspaceName} — ${tSide('switchWorkspace')}`}
                accessibilityState={{ expanded: pickerOpen }}
              >
                <View className="h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                  <Text style={{ fontFamily: fonts.bold }} className="text-sm text-primary">{initial}</Text>
                </View>
                <View className="flex-1">
                  <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground" numberOfLines={1}>
                    {workspaceName}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {isLocal
                      ? tSide('localOnDevice')
                      : activeTeam?.isPersonal
                        ? tSide('personalKillio')
                        : activeTeam?.planTier ?? tSide('killio')}
                  </Text>
                </View>
                <View
                  className="rounded-md p-1"
                  style={{ transform: [{ rotate: pickerOpen ? '180deg' : '0deg' }] }}
                >
                  <ChevronsUpDown size={16} color={pickerOpen ? colors.cyan : colors.mutedForeground} />
                </View>
              </Pressable>
              <Pressable
                onPress={closeNav}
                hitSlop={10}
                className="rounded-md p-1 ml-1"
                accessibilityRole="button"
                accessibilityLabel={tSide('closeMenu')}
              >
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {pickerOpen && (
              <View className="border-t border-border/40 px-2 py-2 gap-2">
                {/* Cloud teams */}
                {workspaces.length > 0 ? (
                  <View>
                    <Text
                      style={{ fontFamily: fonts.semibold }}
                      className="px-2 text-[9px] uppercase tracking-widest text-muted-foreground mb-1"
                    >
                      {tSide('cloudHeading')}
                    </Text>
                    {workspaces.map((w) => {
                      const isActive = !isLocal && w.id === activeTeam?.id;
                      return (
                        <Pressable
                          key={w.id}
                          onPress={async () => {
                            // Switching to a cloud team exits local mode if
                            // we were in one, mirroring the web behaviour.
                            if (isLocal) local.exitLocal();
                            await setActiveTeam(w.id);
                            setPickerOpen(false);
                          }}
                          className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${isActive ? 'bg-secondary' : ''}`}
                        >
                          <View className="h-6 w-6 items-center justify-center rounded border border-border bg-background">
                            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-foreground">
                              {w.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground" numberOfLines={1}>
                            {w.name}
                          </Text>
                          {w.isPersonal && (
                            <Text className="text-[10px] uppercase tracking-wide text-muted-foreground">{tSide('personalBadge')}</Text>
                          )}
                          {isActive && <Check size={14} color={colors.cyan} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {/* + New (cloud) workspace — inline name form */}
                {creatingCloud ? (
                  <View className="rounded-md border border-cyan/40 bg-background p-2 gap-2">
                    <Text
                      style={{ fontFamily: fonts.semibold }}
                      className="text-[10px] uppercase tracking-widest text-muted-foreground"
                    >
                      {tSide('newCloud')}
                    </Text>
                    <TextInput
                      value={newCloudName}
                      onChangeText={setNewCloudName}
                      placeholder={tSide('newCloudPlaceholder')}
                      placeholderTextColor={colors.mutedForeground}
                      autoFocus
                      onSubmitEditing={submitNewCloud}
                      style={{ fontFamily: fonts.regular, color: colors.foreground }}
                      className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                    />
                    <View className="flex-row justify-end gap-2">
                      <Pressable
                        onPress={() => {
                          setCreatingCloud(false);
                          setNewCloudName('');
                        }}
                        className="rounded-md border border-border bg-secondary px-3 py-1.5"
                      >
                        <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
                          {tSide('cancel')}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={submitNewCloud}
                        disabled={!newCloudName.trim() || submittingCloud}
                        style={{ opacity: !newCloudName.trim() || submittingCloud ? 0.5 : 1 }}
                        className="rounded-md bg-cyan px-3 py-1.5"
                      >
                        <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-background">
                          {submittingCloud ? '…' : tSide('create')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setCreatingCloud(true)}
                    className="flex-row items-center gap-2 rounded-md px-3 py-2"
                  >
                    <View className="h-6 w-6 items-center justify-center rounded border border-dashed border-border bg-background">
                      <Text style={{ fontFamily: fonts.bold }} className="text-[14px] text-foreground">+</Text>
                    </View>
                    <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground">
                      {tSide('newCloud')}
                    </Text>
                  </Pressable>
                )}

                {/* Local workspaces */}
                <View>
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="px-2 text-[9px] uppercase tracking-widest text-muted-foreground mb-1"
                  >
                    {tSide('localHeading')}
                  </Text>
                  {local.workspaces.length === 0 ? (
                    <Text className="px-2 text-xs text-muted-foreground italic">
                      {tSide('noLocal')}
                    </Text>
                  ) : (
                    local.workspaces.map((w) => {
                      const isActive = isLocal && w.id === local.activeId;
                      return (
                        <Pressable
                          key={w.id}
                          onPress={async () => {
                            await local.selectLocalWorkspace(w.id);
                            setPickerOpen(false);
                            closeNav();
                            requestAnimationFrame(() => router.push('/documents'));
                          }}
                          className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${isActive ? 'bg-secondary' : ''}`}
                        >
                          <View className="h-6 w-6 items-center justify-center rounded border border-cyan/30 bg-cyan/10">
                            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
                              {w.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground" numberOfLines={1}>
                            {w.name}
                          </Text>
                          <Text className="text-[10px] uppercase tracking-wide text-cyan">{tSide('localBadge')}</Text>
                          {isActive && <Check size={14} color={colors.cyan} />}
                        </Pressable>
                      );
                    })
                  )}
                  <Pressable
                    onPress={() => {
                      setPickerOpen(false);
                      closeNav();
                      requestAnimationFrame(() => router.push('/local-workspaces'));
                    }}
                    className="flex-row items-center gap-2 rounded-md px-3 py-2 mt-1"
                  >
                    <View className="h-6 w-6 items-center justify-center rounded border border-dashed border-border bg-background">
                      <Text style={{ fontFamily: fonts.bold }} className="text-[14px] text-foreground">+</Text>
                    </View>
                    <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground">
                      {tSide('newLocal')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          {/* Mode switch — Vault vs Workspace */}
          <View className="px-3 pt-3">
            <View className="flex-row rounded-xl border border-border bg-background p-1">
              {(['vault', 'workspace'] as const).map((m) => {
                const active = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={async () => {
                      await setMode(m);
                      // Jump to the canonical landing screen for the new mode
                      closeNav();
                      requestAnimationFrame(() => {
                        router.push(m === 'vault' ? '/assistant' : '/workspace');
                      });
                    }}
                    className={`flex-1 items-center justify-center rounded-lg py-2 ${active ? 'bg-secondary' : ''}`}
                  >
                    <Text
                      style={{ fontFamily: active ? fonts.semibold : fonts.medium }}
                      className={`text-xs ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      {m === 'vault' ? tSide('modeVault') : tSide('modeWorkspace')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Nav items */}
          <ScrollView className="flex-1" contentContainerClassName="px-3 py-4 gap-1">
            {items.map((it) => {
              const active = pathname === it.route;
              const Icon = it.icon;
              return (
                <Pressable
                  key={it.key}
                  onPress={() => go(it.route)}
                  className={`flex-row items-center gap-3 rounded-md px-3 py-3 ${active ? 'bg-secondary' : ''}`}
                >
                  <Icon size={18} color={active ? colors.cyan : colors.mutedForeground} />
                  <Text
                    style={{ fontFamily: active ? fonts.semibold : fonts.medium }}
                    className={`text-sm ${active ? 'text-foreground' : 'text-foreground/80'}`}
                  >
                    {t(it.key)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Footer */}
          <View className="flex-row items-center justify-between border-t border-border/60 p-3">
            <View className="flex-1 flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary">
                <Settings size={15} color={colors.mutedForeground} />
              </View>
              <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {workspaceName}
              </Text>
            </View>
            <Pressable
              hitSlop={10}
              className="rounded-md p-2"
              onPress={async () => {
                closeNav();
                await signOut();
                router.replace('/login');
              }}
            >
              <LogOut size={18} color={colors.destructive} />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
