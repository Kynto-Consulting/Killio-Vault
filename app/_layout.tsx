import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { Menu } from 'lucide-react-native';

import { AuthProvider } from '@/core/auth/AuthContext';
import { CaptureProvider } from '@/capture/CaptureContext';
import { I18nProvider, useTranslations } from '@/i18n';
import { NavProvider, useNav } from '@/nav/NavContext';
import { AppModeProvider } from '@/nav/AppModeContext';
import { DocumentsProvider } from '@/documents/DocumentsProvider';
import { WorkspaceCatalogProvider } from '@/workspace/WorkspaceCatalogContext';
import { LocalWorkspaceProvider } from '@/local-workspace/LocalWorkspaceProvider';
import { SideNav } from '@/nav/SideNav';
import { WakeListener } from '@/wakeword/WakeListener';
import { TorchHost } from '@/integrations/TorchHost';
import { useAppFonts, fonts } from '@/theme/fonts';
import { colors } from '@/theme/theme';

void SplashScreen.preventAutoHideAsync();

// Force Inter as the default font for every <Text> across the app.
const TextAny = Text as unknown as { defaultProps?: { style?: unknown } };
TextAny.defaultProps = TextAny.defaultProps ?? {};
TextAny.defaultProps.style = [{ fontFamily: fonts.regular, color: colors.foreground }];

/** Hamburger that opens the side drawer; shown on authed screens. */
function MenuButton() {
  const { openNav } = useNav();
  return (
    <Pressable onPressIn={openNav} hitSlop={12} style={{ paddingHorizontal: 6 }}>
      <Menu size={22} color={colors.foreground} />
    </Pressable>
  );
}

const withMenu = { headerLeft: () => <MenuButton /> } as const;

/** Renders the actual Stack — split out so it can use useTranslations() under
 *  the I18nProvider that the outer RootLayout mounts. */
function AppStack() {
  const t = useTranslations('stack');
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: fonts.semibold },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ title: t('home'), ...withMenu }} />
      <Stack.Screen name="consent" options={{ title: t('consent') }} />
      <Stack.Screen name="diary" options={{ title: t('diary'), ...withMenu }} />
      <Stack.Screen name="settings" options={{ title: t('settings'), ...withMenu }} />
      <Stack.Screen name="voice-id" options={{ title: t('voiceId') }} />
      <Stack.Screen name="schedule" options={{ title: t('schedule'), ...withMenu }} />
      <Stack.Screen name="assistant" options={{ title: t('assistant'), ...withMenu }} />
      <Stack.Screen name="history" options={{ title: t('history'), ...withMenu }} />
      <Stack.Screen name="agents" options={{ title: t('agents'), ...withMenu }} />
      <Stack.Screen name="integrations" options={{ title: t('integrations'), ...withMenu }} />
      <Stack.Screen name="usage" options={{ title: t('usage'), ...withMenu }} />
      <Stack.Screen name="whatsapp-pair" options={{ title: t('whatsappPair') }} />
      <Stack.Screen name="documents" options={{ title: t('documents'), ...withMenu }} />
      <Stack.Screen name="document/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="workspace" options={{ title: t('workspace'), ...withMenu }} />
      <Stack.Screen name="d/index" options={{ headerShown: false }} />
      <Stack.Screen name="d/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="local-workspaces" options={{ title: t('localWorkspaces'), ...withMenu }} />
      <Stack.Screen name="memories" options={{ title: t('memories'), ...withMenu }} />
      <Stack.Screen name="search" options={{ title: t('search'), ...withMenu }} />
      <Stack.Screen name="notifications" options={{ title: t('notifications'), ...withMenu }} />
      <Stack.Screen name="rooms" options={{ title: t('rooms'), ...withMenu }} />
      <Stack.Screen name="rooms/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="b/index" options={{ title: t('boards'), ...withMenu }} />
      <Stack.Screen name="b/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="teams/index" options={{ title: t('teams'), ...withMenu }} />
      <Stack.Screen name="teams/invite" options={{ title: t('inviteMember') }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const fontsLoaded = useAppFonts();

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <LocalWorkspaceProvider>
          <AuthProvider>
            <AppModeProvider>
            <WorkspaceCatalogProvider>
            <DocumentsProvider>
            <CaptureProvider>
              <NavProvider>
                <StatusBar style="light" />
                <AppStack />
                <SideNav />
                <WakeListener />
                <TorchHost />
              </NavProvider>
            </CaptureProvider>
            </DocumentsProvider>
            </WorkspaceCatalogProvider>
            </AppModeProvider>
          </AuthProvider>
          </LocalWorkspaceProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
