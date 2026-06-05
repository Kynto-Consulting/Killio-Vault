import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import {
  BarChart3,
  Bot,
  Blocks,
  CalendarClock,
  History,
  LogOut,
  Mic,
  MessageSquare,
  SlidersHorizontal,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react-native';

import { useNav } from './NavContext';
import { useAuth } from '../core/auth/AuthContext';
import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

type Route =
  | '/home' | '/diary' | '/assistant' | '/history' | '/agents'
  | '/integrations' | '/schedule' | '/usage' | '/settings';

interface Item {
  key: string;
  icon: LucideIcon;
  route: Route;
}

const ITEMS: Item[] = [
  { key: 'assistant', icon: MessageSquare, route: '/assistant' },
  { key: 'history', icon: History, route: '/history' },
  { key: 'diary', icon: Mic, route: '/diary' },
  { key: 'agents', icon: Bot, route: '/agents' },
  { key: 'integrations', icon: Blocks, route: '/integrations' },
  { key: 'schedule', icon: CalendarClock, route: '/schedule' },
  { key: 'usage', icon: BarChart3, route: '/usage' },
  { key: 'settings', icon: SlidersHorizontal, route: '/settings' },
];

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
  const { personalTeam, signOut } = useAuth();

  const workspaceName = personalTeam?.name ?? 'Workspace';
  const initial = workspaceName.charAt(0).toUpperCase();

  const go = (route: Route) => {
    closeNav();
    // Defer navigation a tick so the Modal fully unmounts on Android first —
    // navigating mid-close leaves a ghost overlay that swallows touches and
    // blocks reopening the drawer the second time.
    requestAnimationFrame(() => {
      router.push(route);
    });
  };

  // Render the Modal ONLY when open so it fully unmounts on close — otherwise a
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
        {/* Panel — absolute, left */}
        <SafeAreaView
          edges={['top', 'bottom', 'left']}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '84%', maxWidth: 360 }}
          className="rounded-r-2xl border-r border-border bg-card"
        >
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-border/60 p-4">
            <View className="flex-1 flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                <Text style={{ fontFamily: fonts.bold }} className="text-sm text-primary">{initial}</Text>
              </View>
              <View className="flex-1">
                <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground" numberOfLines={1}>
                  {workspaceName}
                </Text>
                <Text className="text-xs text-muted-foreground">Killio</Text>
              </View>
            </View>
            <Pressable onPress={closeNav} hitSlop={10} className="rounded-md p-1">
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Nav items */}
          <ScrollView className="flex-1" contentContainerClassName="px-3 py-4 gap-1">
            {ITEMS.map((it) => {
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
