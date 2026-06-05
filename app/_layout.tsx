import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { Menu } from 'lucide-react-native';

import { AuthProvider } from '@/core/auth/AuthContext';
import { CaptureProvider } from '@/capture/CaptureContext';
import { I18nProvider } from '@/i18n';
import { NavProvider, useNav } from '@/nav/NavContext';
import { AppModeProvider } from '@/nav/AppModeContext';
import { DocumentsProvider } from '@/documents/DocumentsProvider';
import { LocalWorkspaceProvider } from '@/local-workspace/LocalWorkspaceProvider';
import { SideNav } from '@/nav/SideNav';
import { WakeListener } from '@/wakeword/WakeListener';
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
    <Pressable onPress={openNav} hitSlop={12} style={{ paddingHorizontal: 6 }}>
      <Menu size={22} color={colors.foreground} />
    </Pressable>
  );
}

const withMenu = { headerLeft: () => <MenuButton /> } as const;

export default function RootLayout() {
  const fontsLoaded = useAppFonts();

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <LocalWorkspaceProvider>
        <AuthProvider>
          <AppModeProvider>
          <DocumentsProvider>
          <CaptureProvider>
            <NavProvider>
              <StatusBar style="light" />
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
                <Stack.Screen name="home" options={{ title: 'Vault', ...withMenu }} />
                <Stack.Screen name="consent" options={{ title: 'Privacidad' }} />
                <Stack.Screen name="diary" options={{ title: 'Diario', ...withMenu }} />
                <Stack.Screen name="settings" options={{ title: 'Captura', ...withMenu }} />
                <Stack.Screen name="schedule" options={{ title: 'Horarios', ...withMenu }} />
                <Stack.Screen name="assistant" options={{ title: 'Asistente', ...withMenu }} />
                <Stack.Screen name="history" options={{ title: 'Historial', ...withMenu }} />
                <Stack.Screen name="agents" options={{ title: 'Agentes', ...withMenu }} />
                <Stack.Screen name="integrations" options={{ title: 'Integraciones', ...withMenu }} />
                <Stack.Screen name="usage" options={{ title: 'Uso', ...withMenu }} />
                <Stack.Screen name="whatsapp-pair" options={{ title: 'WhatsApp' }} />
                <Stack.Screen name="documents" options={{ title: 'Documentos', ...withMenu }} />
                <Stack.Screen name="document/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="workspace" options={{ title: 'Workspace', ...withMenu }} />
                <Stack.Screen name="d/index" options={{ headerShown: false }} />
                <Stack.Screen name="d/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="local-workspaces" options={{ title: 'Workspaces locales', ...withMenu }} />
              </Stack>
              <SideNav />
              <WakeListener />
            </NavProvider>
          </CaptureProvider>
          </DocumentsProvider>
          </AppModeProvider>
        </AuthProvider>
        </LocalWorkspaceProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
