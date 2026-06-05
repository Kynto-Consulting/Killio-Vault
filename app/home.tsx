import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen, Card, H1, Body, Button } from '@/ui';
import { colors } from '@/theme/theme';
import { useAuth } from '@/core/auth/AuthContext';
import { useCapture } from '@/capture/CaptureContext';
import { useTranslations } from '@/i18n';

export default function HomeScreen() {
  const router = useRouter();
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const { personalTeam, signOut } = useAuth();
  const { status, pending, nativeAvailable } = useCapture();

  const statusLabel: Record<string, string> = {
    idle: t('statusIdle'),
    listening: t('statusListening'),
    paused: t('statusPaused'),
    error: t('statusError'),
  };

  return (
    <Screen scroll>
      <Image
        source={require('../assets/killio_white.webp')}
        style={{ width: 120, height: 36, resizeMode: 'contain', marginBottom: 8 }}
      />
      <H1>Vault</H1>
      <Body muted>{personalTeam?.name ?? t('workspace')}</Body>

      <Card className="mt-2">
        <View className="flex-row items-center gap-2">
          <View
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: status === 'listening' ? colors.success : status === 'error' ? colors.destructive : colors.mutedForeground }}
          />
          <Body>{t('captureStatus')}: {statusLabel[status] ?? status}</Body>
        </View>
        <Body muted>{t('pending', { n: pending })}</Body>
        {!nativeAvailable ? <Body muted>{t('needDevBuild')}</Body> : null}
      </Card>

      <Button title={t('diary')} onPress={() => router.push('/diary')} />
      <Button title={t('assistant')} variant="secondary" onPress={() => router.push('/assistant')} />
      <Button title={t('history')} variant="secondary" onPress={() => router.push('/history')} />
      <Button title={t('agents')} variant="secondary" onPress={() => router.push('/agents')} />
      <Button title={t('integrations')} variant="secondary" onPress={() => router.push('/integrations')} />
      <Button title={t('settings')} variant="secondary" onPress={() => router.push('/settings')} />

      <Button
        title={tc('signOut')}
        variant="danger"
        onPress={async () => {
          await signOut();
          router.replace('/login');
        }}
      />
    </Screen>
  );
}
