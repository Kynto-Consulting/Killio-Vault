import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';

import { API_BASE_URL, DEFAULT_TIMEOUT_MS } from './config';
import { AuthResponse } from './types';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  saveTokens,
} from '../auth/token-store';

/**
 * Shared axios instance for the Killio backend.
 *
 * - Attaches the Bearer access token to every request.
 * - On 401, refreshes once via POST /auth/refresh with the refresh token in the
 *   request BODY (RN has no cookie jar; the backend accepts a body fallback),
 *   then retries the original request.
 * - Refresh is single-flight: concurrent 401s share one refresh promise.
 * - If refresh fails, tokens are cleared and onAuthFailure() fires so the UI
 *   can route back to login.
 */

let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;
    try {
      // Bare axios (not `api`) so this request skips the interceptors below.
      const { data } = await axios.post<AuthResponse>(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken },
        { timeout: DEFAULT_TIMEOUT_MS },
      );
      await saveTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return data.accessToken;
    } catch {
      await clearTokens();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
});

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status === 401 && original && !original._retried) {
      original._retried = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return api.request(original);
      }
      onAuthFailure?.();
    }

    return Promise.reject(error);
  },
);
