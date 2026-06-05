import * as SecureStore from 'expo-secure-store';

/**
 * Secure token storage backed by the Android Keystore (expo-secure-store).
 * RN has no cookie jar, so we persist both tokens and replay the refresh token
 * in the request body — the backend /auth/refresh accepts a body fallback.
 */

const ACCESS_KEY = 'killio.accessToken';
const REFRESH_KEY = 'killio.refreshToken';
const PERSONAL_TEAM_KEY = 'killio.personalTeamId';
const ACTIVE_TEAM_KEY = 'killio.activeTeamId';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(PERSONAL_TEAM_KEY),
    SecureStore.deleteItemAsync(ACTIVE_TEAM_KEY),
  ]);
}

export async function savePersonalTeamId(teamId: string): Promise<void> {
  await SecureStore.setItemAsync(PERSONAL_TEAM_KEY, teamId);
}

export async function getPersonalTeamId(): Promise<string | null> {
  return SecureStore.getItemAsync(PERSONAL_TEAM_KEY);
}

/**
 * Active workspace selected by the user for Vault. Persists across launches
 * so the user doesn't pick again every cold start. Defaults to the personal
 * workspace until they explicitly switch.
 */
export async function saveActiveTeamId(teamId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_TEAM_KEY, teamId);
}

export async function getActiveTeamId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_TEAM_KEY);
}
