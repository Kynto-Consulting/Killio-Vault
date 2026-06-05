import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Killio Vault — Android-first companion app.
 *
 * Phase 0 only declares the base app + the API base URL. The native bits that
 * require a custom dev-build (typed foreground service, MediaProjection screen
 * capture, wake word) are added as config plugins in later phases — Expo Go is
 * used purely for JS/UI iteration until then.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Killio Vault',
  slug: 'killio-vault',
  scheme: 'killiovault',
  version: '0.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  icon: './assets/icon.png',
  backgroundColor: '#000000',
  android: {
    package: 'dev.killio.vault',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#000000',
    },
    // Phase 1+ adds RECORD_AUDIO + FOREGROUND_SERVICE_MICROPHONE (Android 14
    // typed FGS) here; requested at runtime on first launch in the dev-build APK.
    permissions: [],
  },
  ios: {
    bundleIdentifier: 'dev.killio.vault',
    supportsTablet: false,
  },
  plugins: [
    "expo-asset",
    'expo-router',
    'expo-secure-store',
    [
      'expo-calendar',
      {
        calendarPermission: 'Killio Vault usa tu calendario para darle contexto al asistente.',
      },
    ],
    [
      'expo-contacts',
      { contactsPermission: 'Killio Vault busca contactos para llamar o enviar SMS por ti.' },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Killio Vault usa tu ubicación para dar contexto al asistente.',
      },
    ],
    'expo-notifications',
    'expo-font',
    './plugins/withVaultCapture',
  ],
  extra: {
    // Hosted backend by default. Override with EXPO_PUBLIC_API_BASE_URL for local
    // dev (e.g. http://localhost:4000 + `adb reverse tcp:4000 tcp:4000`, or the
    // emulator alias http://10.0.2.2:4000).
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://backend.killio.dev',
  },
});
