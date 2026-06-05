import Constants from 'expo-constants';

/** Base URL of the Killio backend. Defaults to the hosted backend; override with
 *  EXPO_PUBLIC_API_BASE_URL for local dev (e.g. http://localhost:4000 + adb reverse). */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://backend.killio.dev';

/** Shared request timeout (ms). Streaming endpoints set their own. */
export const DEFAULT_TIMEOUT_MS = 20_000;
