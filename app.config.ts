import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Killio Vault â€” Android-first companion app.
 *
 * Phase 0 only declares the base app + the API base URL. The native bits that
 * require a custom dev-build (typed foreground service, MediaProjection screen
 * capture, wake word) are added as config plugins in later phases â€” Expo Go is
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
    // Android App Links for killio.dev — when the user taps a killio.dev URL
    // on their phone and Vault is installed, the OS opens it directly inside
    // the app instead of the browser. Both `killio.dev` and `www.killio.dev`
    // are claimed. The `https://killio.dev/.well-known/assetlinks.json` file
    // on the frontend must include the app's SHA-256 cert fingerprint for
    // `autoVerify: true` to actually verify — otherwise Android still routes
    // the link to Vault but as an "unverified" handler.
    //
    // Paths claimed (must mirror Vault's expo-router screens):
    //   /accept-invite          → /teams/accept
    //   /teams/accept           → /teams/accept
    //   /teams                  → /teams
    //   /b, /b/<id>             → /b, /b/<id>
    //   /d, /d/<id>             → /d, /d/<id>
    //   /rooms, /rooms/<id>     → /rooms, /rooms/<id>
    //   /workspace              → /workspace
    //   /documents              → /documents
    //   /integrations           → /integrations
    //   /vault                  → /home (Vault landing)
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          // Invite acceptance (both shapes the backend can emit).
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/accept-invite' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/accept-invite' },
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/teams' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/teams' },
          // Boards (kanban + gantt) detail.
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/b' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/b' },
          // NOTE: /m (Meshboards) is intentionally NOT claimed — the
          // matching expo-router screen doesn't exist yet, so claiming it
          // here would route killio.dev/m/<id> into Vault and 404. Re-add
          // once `app/m/[id].tsx` lands.
          // Documents detail.
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/d' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/d' },
          // Rooms.
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/rooms' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/rooms' },
          // Workspace + integrations top-levels.
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/workspace' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/workspace' },
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/documents' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/documents' },
          { scheme: 'https', host: 'killio.dev', pathPrefix: '/integrations' },
          { scheme: 'https', host: 'www.killio.dev', pathPrefix: '/integrations' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
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
          'Killio Vault usa tu ubicaciÃ³n para dar contexto al asistente.',
      },
    ],
    'expo-notifications',
    'expo-font',
    // Torch/flashlight is handled by the native killio-torch module via
    // CameraManager.setTorchMode — it needs NO camera preview and NO CAMERA
    // permission, so the expo-camera plugin is intentionally not included.
    'expo-brightness',
    './plugins/withVaultCapture',
    './plugins/withVaultWidgets',
    './plugins/withReleaseSigning',
  ],
  extra: {
    // Hosted backend by default. Override with EXPO_PUBLIC_API_BASE_URL for local
    // dev (e.g. http://localhost:4000 + `adb reverse tcp:4000 tcp:4000`, or the
    // emulator alias http://10.0.2.2:4000).
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://backend.killio.dev',
    eas: {
      projectId: 'cf180796-0bbb-4bb0-89b7-f102e5c96345',
    },
  },
});

