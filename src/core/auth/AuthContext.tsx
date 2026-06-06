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
import { listTeams, vaultEligibleTeams } from '../api/teams.client';
import { isAuthResponse, AuthResponse, Team } from '../api/types';
import { setAuthFailureHandler } from '../api/http';
import { registerForPush, unregisterForPush } from '../../push/registerPush';
import {
  clearTokens,
  getAccessToken,
  getActiveTeamId,
  getPersonalTeamId,
  saveActiveTeamId,
  savePersonalTeamId,
  saveTokens,
} from './token-store';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  /** Personal workspace — always exists for an authenticated user. */
  personalTeam: Team | null;
  /** Currently-active workspace (may be the personal one or a shared team). */
  activeTeam: Team | null;
  /** All workspaces the user can use with Vault (personal + Pro+ shared). */
  workspaces: Team[];
  /** Authenticated user's id. `null` until /auth/me resolves on launch. */
  currentUserId: string | null;
  /** Switch the active workspace. Persists the choice across launches. */
  setActiveTeam(teamId: string): Promise<void>;
  /** Re-fetches workspaces from backend (after creating a new team). */
  refreshWorkspaces(): Promise<void>;
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
  const [activeTeam, setActiveTeamState] = useState<Team | null>(null);
  const [workspaces, setWorkspaces] = useState<Team[]>([]);
  // Mobile: cache the signed-in user's id so screens that need to identify
  // "this is me" (read receipts, own message bubble color, etc.) don't have
  // to re-call /auth/me on mount.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const hydrateWorkspaces = useCallback(async () => {
    const teams = await listTeams();
    const eligible = vaultEligibleTeams(teams);
    setWorkspaces(eligible);
    const personal = eligible.find((t) => t.isPersonal) ?? null;
    setPersonalTeam(personal);
    if (personal) await savePersonalTeamId(personal.id);

    const storedActive = await getActiveTeamId();
    const resolvedActive =
      eligible.find((t) => t.id === storedActive) ?? personal ?? eligible[0] ?? null;
    if (resolvedActive) {
      await saveActiveTeamId(resolvedActive.id);
      setActiveTeamState(resolvedActive);
    } else {
      setActiveTeamState(null);
    }
    return { personal, active: resolvedActive };
  }, []);

  const completeSignIn = useCallback(async (auth: AuthResponse) => {
    await saveTokens({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    // Mobile: cache the freshly authenticated user id (used by rooms read
    // receipts to mark own messages).
    try {
      const profile = await authApi.me();
      const uid = typeof profile?.id === 'string' ? (profile.id as string) : null;
      setCurrentUserId(uid);
    } catch {
      setCurrentUserId(null);
    }
    await hydrateWorkspaces();
    setStatus('signedIn');
    // Register for Killio push so normal notifications reach Vault.
    void registerForPush();
  }, [hydrateWorkspaces]);

  const signOut = useCallback(async () => {
    await unregisterForPush().catch(() => {});
    await clearTokens();
    setPersonalTeam(null);
    setActiveTeamState(null);
    setWorkspaces([]);
    setCurrentUserId(null);
    setStatus('signedOut');
  }, []);

  const setActiveTeam = useCallback(
    async (teamId: string) => {
      const next = workspaces.find((t) => t.id === teamId);
      if (!next) {
        // Workspace list may be stale — re-fetch then try once more.
        const teams = await listTeams();
        const eligible = vaultEligibleTeams(teams);
        setWorkspaces(eligible);
        const found = eligible.find((t) => t.id === teamId);
        if (!found) throw new Error('Workspace not available for Vault.');
        await saveActiveTeamId(found.id);
        setActiveTeamState(found);
        return;
      }
      await saveActiveTeamId(next.id);
      setActiveTeamState(next);
    },
    [workspaces],
  );

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
        const profile = await authApi.me();
        const uid = typeof profile?.id === 'string' ? (profile.id as string) : null;
        setCurrentUserId(uid);
        try {
          await hydrateWorkspaces();
        } catch {
          // Offline / transient — fall back to cached ids so the app still
          // shows something useful until the network returns.
          const cachedPersonal = await getPersonalTeamId();
          const cachedActive = (await getActiveTeamId()) ?? cachedPersonal;
          if (cachedPersonal) {
            const stub = { id: cachedPersonal } as Team;
            setPersonalTeam(stub);
            if (cachedActive === cachedPersonal) setActiveTeamState(stub);
          }
          if (cachedActive && cachedActive !== cachedPersonal) {
            setActiveTeamState({ id: cachedActive } as Team);
          }
        }
        setStatus('signedIn');
        void registerForPush();
      } catch {
        await signOut();
      }
    })();
    return () => setAuthFailureHandler(null);
  }, [signOut, hydrateWorkspaces]);

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

  const refreshWorkspaces = useCallback(async () => {
    await hydrateWorkspaces();
  }, [hydrateWorkspaces]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      personalTeam,
      activeTeam,
      workspaces,
      currentUserId,
      setActiveTeam,
      refreshWorkspaces,
      loginWithPassword,
      verifyOtp,
      registerAccount,
      signOut,
    }),
    [
      status,
      personalTeam,
      activeTeam,
      workspaces,
      currentUserId,
      setActiveTeam,
      refreshWorkspaces,
      loginWithPassword,
      verifyOtp,
      registerAccount,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
