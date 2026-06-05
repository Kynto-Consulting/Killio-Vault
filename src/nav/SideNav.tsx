import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import {
  BarChart3,
  Bot,
  Blocks,
  CalendarClock,
  Check,
  ChevronsUpDown,
  FileText,
  HardDriveDownload,
  History,
  LogOut,
  Mic,
  MessageSquare,
  SlidersHorizontal,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';

import { useNav } from './NavContext';
import { useAppMode, type AppMode } from './AppModeContext';
import { useAuth } from '../core/auth/AuthContext';
import { useLocalWorkspace } from '../local-workspace/LocalWorkspaceProvider';
import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

type Route =
  | '/home' | '/diary' | '/assistant' | '/history' | '/agents'
  | '/integrations' | '/schedule' | '/usage' | '/settings'
  | '/documents' | '/workspace' | '/local-workspaces';

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
  { key: 'integrations', icon: Blocks, route: '/integrations' },
  { key: 'schedule', icon: CalendarClock, route: '/schedule' },
  { key: 'usage', icon: BarChart3, route: '/usage' },
  { key: 'settings', icon: SlidersHorizontal, route: '/settings' },
];

const WORKSPACE_ITEMS: Item[] = [
  { key: 'workspace', icon: BarChart3, route: '/workspace' },
  { key: 'documents', icon: FileText, route: '/documents' },
  { key: 'localWorkspaces', icon: HardDriveDownload, route: '/local-workspaces' },
];

function itemsForMode(mode: AppMode): Item[] {
  return mode === 'workspace' ? WORKSPACE_ITEMS : VAULT_ITEMS;
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
  const { activeTeam, workspaces, setActiveTeam, signOut } = useAuth();
  const { mode, setMode } = useAppMode();
  const local = useLocalWorkspace();
  const [pickerOpen, setPickerOpen] = useState(false);
  const items = itemsForMode(mode);

  const isLocal = local.mode === 'local';
  const workspaceName = isLocal
    ? local.active?.name ?? 'Local'
    : activeTeam?.name ?? 'Workspace';
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
              <Pressable
                className="flex-1 flex-row items-center gap-3"
                onPress={() => setPickerOpen((v) => !v)}
                hitSlop={6}
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
                      ? '💾 Local · solo este dispositivo'
                      : activeTeam?.isPersonal
                        ? 'Personal · Killio'
                        : activeTeam?.planTier ?? 'Killio'}
                  </Text>
                </View>
                <ChevronsUpDown size={14} color={colors.mutedForeground} />
              </Pressable>
              <Pressable onPress={closeNav} hitSlop={10} className="rounded-md p-1 ml-1">
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
                      Killio · Cloud
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
                            <Text className="text-[10px] uppercase tracking-wide text-muted-foreground">personal</Text>
                          )}
                          {isActive && <Check size={14} color={colors.cyan} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {/* Local workspaces */}
                <View>
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="px-2 text-[9px] uppercase tracking-widest text-muted-foreground mb-1"
                  >
                    Local · Este dispositivo
                  </Text>
                  {local.workspaces.length === 0 ? (
                    <Text className="px-2 text-xs text-muted-foreground italic">
                      Sin workspaces locales.
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
                          <Text className="text-[10px] uppercase tracking-wide text-cyan">local</Text>
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
                      Nuevo workspace local
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
                      {m === 'vault' ? 'Vault' : 'Workspace'}
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
