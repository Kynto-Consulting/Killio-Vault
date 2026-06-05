import axios from 'axios';

import { api } from './http';
import { API_BASE_URL, DEFAULT_TIMEOUT_MS } from './config';
import {
  AuthResponse,
  OtpRequiredResponse,
  RequestOtpResponse,
} from './types';

/**
 * Auth API client. Login/OTP endpoints use bare axios (no Bearer needed and we
 * don't want the refresh interceptor firing on a login 401); authenticated
 * calls like /auth/me go through the shared `api` instance.
 */

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse | OtpRequiredResponse> {
  const { data } = await axios.post<AuthResponse | OtpRequiredResponse>(
    `${API_BASE_URL}/auth/login`,
    { email, password },
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  return data;
}

export interface RegisterInput {
  displayName: string;
  username: string;
  email: string;
  password: string;
  acceptedTerms: boolean;
  allowCommunications?: boolean;
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const { data } = await axios.post<AuthResponse>(
    `${API_BASE_URL}/auth/register`,
    {
      name: input.displayName,
      displayName: input.displayName,
      username: input.username,
      email: input.email,
      password: input.password,
      acceptedTerms: input.acceptedTerms,
      allowCommunications: !!input.allowCommunications,
    },
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  return data;
}

export async function requestOtp(email: string): Promise<RequestOtpResponse> {
  const { data } = await axios.post<RequestOtpResponse>(
    `${API_BASE_URL}/auth/request-otp`,
    { email, purpose: 'login' },
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  return data;
}

export async function verifyOtp(
  email: string,
  code: string,
  token: string,
): Promise<AuthResponse> {
  const { data } = await axios.post<AuthResponse>(
    `${API_BASE_URL}/auth/verify-otp`,
    { email, code, token, purpose: 'login', autoRegister: true },
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  return data;
}

/** Authenticated: verifies the current access token and returns the profile. */
export async function me(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function logout(refreshToken: string): Promise<void> {
  await axios
    .post(`${API_BASE_URL}/auth/logout`, { refreshToken })
    .catch(() => undefined);
}
