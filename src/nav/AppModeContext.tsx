import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * Vault runs in two distinct surfaces:
 *
 *  - `vault`     — the always-on companion (diary, voice assistant, history,
 *                  agents, integrations, schedule, usage, capture settings).
 *  - `workspace` — a mobile-adapted Killio workspace (workspace home, document
 *                  browser, brick renderer + editor). Reuses the same active
 *                  team but emulates the web frontend at ~80% so users can
 *                  navigate their actual Killio entities from the phone.
 *
 * The choice is persisted in SecureStore so the last surface is restored on
 * launch alongside the active workspace.
 */
export type AppMode = 'vault' | 'workspace';

const MODE_KEY = 'killio.appMode';
const DEFAULT_MODE: AppMode = 'vault';

interface AppModeState {
  mode: AppMode;
  setMode(next: AppMode): Promise<void>;
  /** Convenience: flip between the two modes. */
  toggleMode(): Promise<void>;
}

const AppModeContext = createContext<AppModeState | null>(null);

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(DEFAULT_MODE);

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(MODE_KEY);
        if (stored === 'vault' || stored === 'workspace') {
          setModeState(stored);
        }
      } catch {
        /* SecureStore absent in some test envs — keep default. */
      }
    })();
  }, []);

  const setMode = useCallback(async (next: AppMode) => {
    setModeState(next);
    try {
      await SecureStore.setItemAsync(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMode = useCallback(async () => {
    const next: AppMode = mode === 'vault' ? 'workspace' : 'vault';
    await setMode(next);
  }, [mode, setMode]);

  const value = useMemo<AppModeState>(
    () => ({ mode, setMode, toggleMode }),
    [mode, setMode, toggleMode],
  );

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeState {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be used within AppModeProvider');
  return ctx;
}
