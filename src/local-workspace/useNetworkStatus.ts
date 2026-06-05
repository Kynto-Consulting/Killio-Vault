import { useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/core/api/config';

/**
 * Lightweight reachability hook. We don't ship @react-native-community/netinfo
 * yet, so this pings the Killio backend health endpoint on a slow interval.
 * On Android the OS already throttles polling when the app is backgrounded —
 * good enough to decide whether to surface the offline banner.
 */
const POLL_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

export type NetworkStatus = 'unknown' | 'online' | 'offline';

export function useNetworkStatus(): {
  status: NetworkStatus;
  retry(): Promise<void>;
} {
  const [status, setStatus] = useState<NetworkStatus>('unknown');
  const inflight = useRef<Promise<void> | null>(null);

  const probe = async () => {
    if (inflight.current) {
      await inflight.current;
      return;
    }
    const run = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      try {
        // Any backend response (even 401) means we have a network path. We
        // pick /auth/me because the backend mounts it without further
        // routing logic; the request stays cheap (no DB read on bad token).
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          method: 'GET',
          signal: ctrl.signal,
          headers: { Accept: 'application/json' },
        });
        setStatus(res.status < 500 ? 'online' : 'offline');
      } catch {
        setStatus('offline');
      } finally {
        clearTimeout(timer);
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  };

  useEffect(() => {
    void probe();
    const id = setInterval(() => void probe(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, retry: probe };
}
