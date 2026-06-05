import { useState } from 'react';
import { useRouter } from 'expo-router';

import { View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';

import { Screen, Card, H1, Body, Button } from '@/ui';
import { requestCapturePermissions } from '@/capture/permissions';
import { grantConsent } from '@/settings/settings-store';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';

/**
 * Privacy gate for 24/7 recording. Must be explicit + timestamped before any
 * capture can start. Also requests the runtime mic/notification permissions.
 */
export default function ConsentScreen() {
  const router = useRouter();
  const t = useTranslations('consent');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const accept = async () => {
    setBusy(true);
    setDenied(false);
    try {
      const perms = await requestCapturePermissions();
      if (!perms.microphone) {
        setDenied(true);
        return;
      }
      await grantConsent();
      router.replace('/settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View className="h-14 w-14 items-center justify-center rounded-2xl border border-cyan/20 bg-cyan/10">
        <ShieldCheck size={26} color={colors.cyan} />
      </View>
      <H1>{t('title')}</H1>
      <Card>
        <Body>{t('body')}</Body>
        <Body muted>{t('b1')}</Body>
        <Body muted>{t('b2')}</Body>
        <Body muted>{t('b3')}</Body>
        <Body muted>{t('b4')}</Body>
      </Card>

      {denied ? <Body muted>{t('denied')}</Body> : null}

      <Button title={t('accept')} onPress={accept} busy={busy} />
      <Button title={t('later')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
