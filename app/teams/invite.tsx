import { useState } from 'react';
import { Pressable, Share, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Mail, Share2 } from 'lucide-react-native';

import { Screen, Card, H1, Body, Label, Button } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { inviteMember, type TeamInvite } from '@/core/api/teams.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

type Role = 'admin' | 'member' | 'viewer' | 'guest';
const ROLES: Role[] = ['admin', 'member', 'viewer', 'guest'];

/**
 * Bottom-pushed invite screen — the mobile counterpart of the web's
 * InviteMemberModal. Validates the email locally, sends it through
 * `POST /teams/:teamId/invites`, then shows a success card with a "Share
 * invite" CTA that opens the native share sheet.
 *
 * The backend does not currently echo the raw invite token back, so the
 * shared message includes only a generic "join workspace" prompt; if/when
 * the backend exposes the token, `invite.token` is appended to the URL.
 */
export default function InviteMemberScreen() {
  const router = useRouter();
  const t = useTranslations('teams');
  const { activeTeam } = useAuth();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<TeamInvite | null>(null);

  const submit = async () => {
    if (!activeTeam?.id || sending) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t('inviteError'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const invite = await inviteMember(activeTeam.id, { email: trimmed, role });
      setSent(invite);
      if (invite.deliveryStatus === 'skipped') setError(t('inviteDeliverySkipped'));
      else if (invite.deliveryStatus === 'failed') setError(t('inviteDeliveryFailed'));
    } catch (e: any) {
      const message = String(e?.response?.data?.message ?? e?.message ?? e);
      if (/already/i.test(message)) setError(t('alreadyMember'));
      else setError(message || t('inviteError'));
    } finally {
      setSending(false);
    }
  };

  const onShare = async () => {
    if (!sent) return;
    const teamName = activeTeam?.name ?? 'Killio';
    // Backend now returns `acceptUrl` (canonical /accept-invite?token=…) and
    // `token` (raw). Prefer the URL the backend hands us — it knows
    // FRONTEND_PUBLIC_URL — and only build one ourselves as a last resort.
    const url =
      sent.acceptUrl ??
      (sent.token
        ? `https://killio.dev/accept-invite?token=${encodeURIComponent(sent.token)}`
        : 'https://killio.dev/accept-invite');
    try {
      await Share.share({ message: `${teamName}: ${url}`, url });
    } catch {
      /* ignore */
    }
  };

  if (sent) {
    return (
      <Screen>
        <Card>
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-full border border-success/40 bg-success/10">
              <Check size={14} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontFamily: fonts.semibold, color: colors.foreground }}
                className="text-base"
              >
                {t('inviteSent')}
              </Text>
              <Body muted>{sent.email}</Body>
            </View>
          </View>
          {error && (
            <View className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              <Text style={{ color: colors.warning }} className="text-xs">
                {error}
              </Text>
            </View>
          )}
          <Button title={t('shareInvite')} onPress={onShare} variant="primary" />
          <Button title={t('cancel')} onPress={() => router.back()} variant="secondary" />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <H1>{t('inviteMember')}</H1>
      <Body muted>{activeTeam?.name ?? ''}</Body>

      <Card>
        <Label>{t('emailPlaceholder')}</Label>
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-background px-3">
          <Mail size={14} color={colors.mutedForeground} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            placeholder={t('emailPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            style={{
              flex: 1,
              fontFamily: fonts.regular,
              color: colors.foreground,
              paddingVertical: 12,
            }}
          />
        </View>

        <Label>{t('selectRole')}</Label>
        <View className="flex-row flex-wrap gap-2">
          {ROLES.map((r) => {
            const active = role === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                className={`rounded-full px-3 py-1.5 border ${active ? 'bg-lime border-lime' : 'border-border bg-secondary'}`}
              >
                <Text
                  style={{
                    fontFamily: fonts.semibold,
                    color: active ? colors.background : colors.mutedForeground,
                  }}
                  className="text-xs uppercase tracking-wider"
                >
                  {t(`role.${r}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error && (
          <View className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            <Text style={{ color: colors.destructive }} className="text-xs">
              {error}
            </Text>
          </View>
        )}

        <Button
          title={sending ? t('sending') : t('send')}
          onPress={submit}
          busy={sending}
          variant="primary"
        />
        <Button title={t('cancel')} onPress={() => router.back()} variant="secondary" />
      </Card>
    </Screen>
  );
}
