import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import * as authApi from '../api/auth.client';
import type { RegisterInput } from '../api/auth.client';
import { resolvePersonalTeam } from '../api/teams.client';
import { isAuthResponse, AuthResponse, Team } from '../api/types';
import { setAuthFailureHandler } from '../api/http';
import { registerForPush, unregisterForPush } from '../../push/registerPush';
import {
  clearTokens,
  getAccessToken,
  getPersonalTeamId,
  savePersonalTeamId,
  saveTokens,
} from './token-store';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  personalTeam: Team | null;
  /** Returns true if signed in, false if the account requires OTP. */
  loginWithPassword(email: string, password: string): Promise<boolean>;
  verifyOtp(email: string, code: string, token: string): Promise<void>;
  registerAccount(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [personalTeam, setPersonalTeam] = useState<Team | null>(null);

  const completeSignIn = useCallback(async (auth: AuthResponse) => {
    await saveTokens({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    const team = await resolvePersonalTeam();
    if (team) {
      await savePersonalTeamId(team.id);
      setPersonalTeam(team);
    }
    setStatus('signedIn');
    // Register for Killio push so normal notifications reach Vault.
    void registerForPush();
  }, []);

  const signOut = useCallback(async () => {
    await unregisterForPush().catch(() => {});
    await clearTokens();
    setPersonalTeam(null);
    setStatus('signedOut');
  }, []);

  // Restore an existing session on launch: if we hold an access token, verify it
  // via /auth/me (the interceptor refreshes it if expired) and rehydrate state.
  useEffect(() => {
    setAuthFailureHandler(() => {
      void signOut();
    });
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      try {
        await authApi.me();
        const team = await resolvePersonalTeam();
        if (team) {
          await savePersonalTeamId(team.id);
          setPersonalTeam(team);
        } else {
          const cachedId = await getPersonalTeamId();
          if (cachedId) setPersonalTeam({ id: cachedId } as Team);
        }
        setStatus('signedIn');
        void registerForPush();
      } catch {
        await signOut();
      }
    })();
    return () => setAuthFailureHandler(null);
  }, [signOut]);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password);
      if (isAuthResponse(res)) {
        await completeSignIn(res);
        return true;
      }
      return false; // OTP required — caller routes to the OTP step.
    },
    [completeSignIn],
  );

  const verifyOtp = useCallback(
    async (email: string, code: string, token: string) => {
      const res = await authApi.verifyOtp(email, code, token);
      await completeSignIn(res);
    },
    [completeSignIn],
  );

  const registerAccount = useCallback(
    async (input: RegisterInput) => {
      const res = await authApi.register(input);
      await completeSignIn(res);
    },
    [completeSignIn],
  );

  const value = useMemo<AuthState>(
    () => ({ status, personalTeam, loginWithPassword, verifyOtp, registerAccount, signOut }),
    [status, personalTeam, loginWithPassword, verifyOtp, registerAccount, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
