/**
 * Backend response shapes. Mirrors Killio-Backend contracts verified against:
 *  - auth.service.ts buildAuthResponse()
 *  - auth.controller.ts /auth/me
 *  - teams.controller.ts GET /teams
 */

export interface AuthUser {
  id: string;
  name: string | null;
  alias: string | null;
  otpLoginEnabled?: boolean;
  bio?: string | null;
  timezone?: string | null;
  locale?: string | null;
}

export interface AuthSession {
  id: string;
  expiresAt: string;
}

/** Returned by /auth/login, /auth/refresh, /auth/verify-otp (success). */
export interface AuthResponse {
  user: AuthUser;
  session: AuthSession;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** /auth/login returns this instead when OTP login is enabled for the account. */
export interface OtpRequiredResponse {
  otpRequired: true;
  token?: string;
  [key: string]: unknown;
}

export function isAuthResponse(
  v: AuthResponse | OtpRequiredResponse | unknown,
): v is AuthResponse {
  return !!v && typeof v === 'object' && 'accessToken' in (v as object);
}

/** /auth/request-otp response (carries the verification token to echo back). */
export interface RequestOtpResponse {
  token: string;
  [key: string]: unknown;
}

/** A workspace. Personal workspace has isPersonal === true. */
export interface Team {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  planTier?: string;
  icon?: string | null;
  role?: string;
}
