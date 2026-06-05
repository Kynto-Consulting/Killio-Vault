import { useEffect, useState } from 'react';

import { getEntitlements, type VaultEntitlements } from '../core/api/vault.client';
import { useAuth } from '../core/auth/AuthContext';

/**
 * Loads the user's Vault entitlements (plan-gated features) so the UI can grey
 * out / upsell locked features. Falls back to a free-tier shape on failure.
 */
const FREE_FALLBACK: VaultEntitlements = {
  tier: 'free',
  policy: {
    enabled: true,
    onDeviceDiary: true,
    cloudSttMinutesMonthly: 0,
    screenCapture: false,
    localAgents: 1,
    wakeWord: false,
  },
};

export function useEntitlements(): {
  entitlements: VaultEntitlements;
  loading: boolean;
} {
  const { personalTeam } = useAuth();
  const [entitlements, setEntitlements] = useState<VaultEntitlements>(FREE_FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!personalTeam?.id) {
        setLoading(false);
        return;
      }
      try {
        const e = await getEntitlements(personalTeam.id);
        if (!cancelled) setEntitlements(e);
      } catch {
        if (!cancelled) setEntitlements(FREE_FALLBACK);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personalTeam?.id]);

  return { entitlements, loading };
}
