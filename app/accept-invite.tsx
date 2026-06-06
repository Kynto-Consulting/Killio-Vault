import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, X } from 'lucide-react-native';

import { Screen, H1, Body, Button } from '@/ui';
import { acceptInvite } from '@/core/api/teams.client';
import { useAuth } from '@/core/auth/AuthContext';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Canonical accept-invite screen. The backend mints invite URLs of the form
 *
 *     https://killio.dev/accept-invite?token=…
 *     killiovault://accept-invite?token=…   (custom scheme + Android App Link
 *                                            both land here)
 *
 * which the manifest intent-filter routes into Vault when installed. The
 * screen accepts the invite via `POST /teams/invites/accept`, refreshes
 * workspaces, switches the active team, then bounces to `/workspace`.
 *
 * NOTE: a previous draft hosted the same logic at `/teams/accept` and used
 * this file as a redirect. We consolidated to a single canonical handler at
 * `/accept-invite` (matches the backend URL) to remove the divergent paths.
 */
export default function AcceptInviteScreen() {
  const router = useRouter();
  const t = useTranslations('teams');
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token ?? '';
  const { setActiveTeam, refreshWorkspaces, status } = useAuth();

  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedOut') {
      router.replace('/login');
      return;
    }
    if (!token) {
      setState('error');
      setErrorMsg(t('acceptError'));
      return;
    }
    (async () => {
      try {
        const res = await acceptInvite(token);
        // Refresh workspaces so the new team appears, then activate it.
        try {
          await refreshWorkspaces();
        } catch {
          /* ignore — setActiveTeam re-fetches if needed */
        }
        if (res?.teamId) {
          try {
            await setActiveTeam(res.teamId);
          } catch {
            /* setActiveTeam re-fetches and may still fail offline; show success anyway */
          }
        }
        setState('success');
        // Land the user on the workspace home.
        setTimeout(() => router.replace('/workspace'), 600);
      } catch (e: any) {
        setState('error');
        setErrorMsg(String(e?.response?.data?.message ?? e?.message ?? t('acceptError')));
      }
    })();
  }, [status, token, refreshWorkspaces, setActiveTeam, router, t]);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        {state === 'loading' && (
          <>
            <ActivityIndicator color={colors.foreground} size="large" />
            <H1>{t('acceptingTitle')}</H1>
            <Body muted>{t('acceptingBody')}</Body>
          </>
        )}
        {state === 'success' && (
          <>
            <View className="h-14 w-14 items-center justify-center rounded-full border border-success/40 bg-success/10">
              <Check size={26} color={colors.success} />
            </View>
            <H1>{t('accepted')}</H1>
          </>
        )}
        {state === 'error' && (
          <>
            <View className="h-14 w-14 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10">
              <X size={26} color={colors.destructive} />
            </View>
            <H1>{t('acceptError')}</H1>
            {errorMsg && (
              <Text
                style={{ color: colors.mutedForeground, fontFamily: fonts.regular, textAlign: 'center' }}
                className="text-sm px-4"
              >
                {errorMsg}
              </Text>
            )}
            <Button title={t('cancel')} onPress={() => router.replace('/workspace')} variant="secondary" />
          </>
        )}
      </View>
    </Screen>
  );
}
