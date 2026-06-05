import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, X } from 'lucide-react-native';

import { Screen, Card, H1, Body, Button } from '@/ui';
import { colors } from '@/theme/theme';
import { useCapture } from '@/capture/CaptureContext';
import { hasConsent } from '@/settings/settings-store';
import { useEntitlements } from '@/settings/useEntitlements';
import { CaptureMode } from '@/capture/schedule';
import { useTranslations } from '@/i18n';

/** Default work-hours window: 09:00–18:00. */
const WORK_HOURS: CaptureMode = {
  kind: 'windows',
  windows: [{ startMin: 9 * 60, endMin: 18 * 60 }],
};

export default function SettingsScreen() {
  const router = useRouter();
  const t = useTranslations('capture');
  const { mode, setMode, status, nativeAvailable } = useCapture();
  const { entitlements } = useEntitlements();
  const [consent, setConsent] = useState<boolean | null>(null);

  useEffect(() => {
    void hasConsent().then(setConsent);
  }, []);

  const choose = async (next: CaptureMode) => {
    if (next.kind !== 'off' && !consent) {
      router.push('/consent');
      return;
    }
    await setMode(next);
  };

  const active = mode.kind;

  return (
    <Screen scroll>
      <H1>{t('title')}</H1>
      <Body muted>{t('status', { status })}</Body>
      {!nativeAvailable ? <Body muted>{t('expoGoNote')}</Body> : null}

      <Button
        title={t('schedule')}
        variant="secondary"
        onPress={() => router.push('/schedule')}
      />

      <Card>
        <Body>{t('mode')}</Body>
        <View style={{ gap: 8, marginTop: 8 }}>
          <Button
            title={active === 'always' ? t('active', { label: t('always') }) : t('always')}
            variant={active === 'always' ? 'primary' : 'secondary'}
            onPress={() => choose({ kind: 'always' })}
          />
          <Button
            title={active === 'windows' ? t('active', { label: t('windows') }) : t('windows')}
            variant={active === 'windows' ? 'primary' : 'secondary'}
            onPress={() => choose(WORK_HOURS)}
          />
          <Button
            title={active === 'off' ? t('active', { label: t('off') }) : t('off')}
            variant={active === 'off' ? 'primary' : 'secondary'}
            onPress={() => choose({ kind: 'off' })}
          />
        </View>
      </Card>

      <Card>
        <Body>{t('plan', { tier: entitlements.tier.toUpperCase() })}</Body>
        <Feature label={t('onDeviceDiary')} on={entitlements.policy.onDeviceDiary} />
        <Feature
          label={`${t('cloudStt')}: ${
            entitlements.policy.cloudSttMinutesMonthly > 0
              ? t('cloudSttMinutes', { n: entitlements.policy.cloudSttMinutesMonthly })
              : t('notIncluded')
          }`}
          on={entitlements.policy.cloudSttMinutesMonthly > 0}
        />
        <Feature label={t('screenCapture')} on={entitlements.policy.screenCapture} />
        <Feature label={t('wakeWord')} on={entitlements.policy.wakeWord} />
        <Body muted>{t('localAgents', { n: entitlements.policy.localAgents ?? '∞' })}</Body>
        {entitlements.tier === 'free' ? <Body muted>{t('upsell')}</Body> : null}
      </Card>

      <Card>
        <Body>{t('privacy')}</Body>
        <Body muted>
          {t('consentState', { state: consent ? t('granted') : t('notGranted') })}
        </Body>
        <Button
          title={t('reviewPrivacy')}
          variant="secondary"
          onPress={() => router.push('/consent')}
        />
      </Card>
    </Screen>
  );
}

function Feature({ label, on }: { label: string; on: boolean }) {
  return (
    <View className="flex-row items-center gap-2">
      {on ? <Check size={15} color={colors.success} /> : <X size={15} color={colors.mutedForeground} />}
      <Text className="text-sm text-muted-foreground">{label}</Text>
    </View>
  );
}
