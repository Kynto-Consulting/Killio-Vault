import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Image as ImageIcon, X } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { JS_LOG_DIR, JS_LOG_PATH, readJsLog } from '@/core/filelog';

import { Screen, Card, H1, Body, Button } from '@/ui';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { useCapture } from '@/capture/CaptureContext';
import {
  getAssistantVoice,
  hasConsent,
  isWakeWordEnabled,
  setAssistantVoice,
  setWakeWordEnabled,
} from '@/settings/settings-store';
import { useEntitlements } from '@/settings/useEntitlements';
import { CaptureMode } from '@/capture/schedule';
import { speak } from '@/tts/Tts';
import { isCustomVoiceAvailable } from '@/tts/cartesia';
import {
  capture as captureScreen,
  isAccessibilityEnabled as isDirectScreenshotEnabled,
  isAvailable as screenCaptureAvailable,
  openAccessibilitySettings as openDirectScreenshotSettings,
  requestPermission as requestScreenCapturePermission,
} from '@/screen/ScreenCapture';
import { useTranslations } from '@/i18n';
import { STT_LANGUAGES, type SttLanguage } from '@/settings/settings-store';

/** Default work-hours window: 09:00–18:00. */
const WORK_HOURS: CaptureMode = {
  kind: 'windows',
  windows: [{ startMin: 9 * 60, endMin: 18 * 60 }],
};

export default function SettingsScreen() {
  const router = useRouter();
  const t = useTranslations('capture');
  const tStt = useTranslations('sttLanguage');
  const tVoice = useTranslations('voicePicker');
  const tWake = useTranslations('wakeWordSettings');
  const tShot = useTranslations('screenCapture');
  const tVid = useTranslations('voiceId');
  const { mode, setMode, status, sttLanguage, setSttLang } = useCapture();
  const { entitlements } = useEntitlements();
  const [consent, setConsent] = useState<boolean | null>(null);
  const [voice, setVoice] = useState<string>('es-ES');
  const [wakeOn, setWakeOn] = useState<boolean>(true);
  const [cartesia, setCartesia] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [shotBusy, setShotBusy] = useState<boolean>(false);
  const [directShot, setDirectShot] = useState<boolean>(false);
  const [logBusy, setLogBusy] = useState<boolean>(false);

  useEffect(() => {
    void hasConsent().then(setConsent);
    void getAssistantVoice().then(setVoice);
    void isWakeWordEnabled().then(setWakeOn);
    void isCustomVoiceAvailable().then(setCartesia);
    void isDirectScreenshotEnabled().then(setDirectShot);
  }, []);

  const pickVoice = async (next: string) => {
    setVoice(next);
    await setAssistantVoice(next);
  };

  const testVoice = async () => {
    setTesting(true);
    let failed = false;
    try {
      await new Promise<void>((resolve) =>
        void speak(tVoice('testText'), {
          language: voice,
          onError: () => {
            failed = true;
          },
          onFinish: () => resolve(),
        }),
      );
    } catch {
      failed = true;
    } finally {
      setTesting(false);
      if (failed) Alert.alert(tVoice('testError'));
    }
  };

  const toggleWake = async (next: boolean) => {
    setWakeOn(next);
    await setWakeWordEnabled(next);
  };

  const grabScreenshot = async () => {
    setShotBusy(true);
    try {
      const ok = await requestScreenCapturePermission();
      if (!ok) return;
      await captureScreen();
    } finally {
      setShotBusy(false);
    }
  };

  // Export / share the on-device diagnostic logs (no adb needed). The NATIVE
  // KWS/capture log lives in the app's adb-pullable external dir
  // (/sdcard/Android/data/dev.killio.vault/files/logs/killio.log) which JS can't
  // read directly; the JS-side log (killio-js.log) is shared here, and the
  // native log's pull path is shown so it can be `adb pull`ed without root.
  const exportLogs = async () => {
    setLogBusy(true);
    try {
      const body = await readJsLog();
      // Write a snapshot file to share (so even an in-progress log exports cleanly).
      const out = `${FileSystem.cacheDirectory ?? JS_LOG_DIR}killio-js-export.log`;
      await FileSystem.writeAsStringAsync(
        out,
        body && body.length > 0 ? body : '(no JS log entries yet)\n',
        { encoding: FileSystem.EncodingType.UTF8 },
      );
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(out, {
          mimeType: 'text/plain',
          dialogTitle: 'Killio Vault logs',
        });
      } else {
        Alert.alert('Logs', `JS log: ${JS_LOG_PATH}`);
      }
    } catch (e) {
      Alert.alert('Logs', `No se pudieron exportar los logs: ${String(e)}`);
    } finally {
      setLogBusy(false);
    }
  };

  const openDirectShot = async () => {
    await openDirectScreenshotSettings();
    // Re-check shortly after returning from the accessibility settings screen.
    setTimeout(() => void isDirectScreenshotEnabled().then(setDirectShot), 1200);
  };

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
      {/* Expo Go gating removed — capture starts in any build flavor. */}

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
            title={active === 'on_screen' ? t('active', { label: t('onScreen') }) : t('onScreen')}
            variant={active === 'on_screen' ? 'primary' : 'secondary'}
            onPress={() => choose({ kind: 'on_screen' })}
          />
          {active === 'on_screen' ? <Body muted>{t('onScreenHint')}</Body> : null}
          <Button
            title={active === 'off' ? t('active', { label: t('off') }) : t('off')}
            variant={active === 'off' ? 'primary' : 'secondary'}
            onPress={() => choose({ kind: 'off' })}
          />
        </View>
      </Card>

      {/* Diagnostics / logs export ──────────────────────────────────────── */}
      <Card>
        <Body>Diagnóstico</Body>
        <Body muted>
          Exporta el registro de la captura y la palabra de activación (wake-word)
          para depurar sin adb.
        </Body>
        <Button
          title={logBusy ? 'Exportando…' : 'Exportar logs'}
          variant="secondary"
          onPress={() => void exportLogs()}
          busy={logBusy}
        />
        <Body muted>{`Log nativo (adb pull): /sdcard/Android/data/dev.killio.vault/files/logs/killio.log`}</Body>
        <Body muted>{`Log JS: ${JS_LOG_PATH}`}</Body>
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

      {/* STT recognition language ──────────────────────────────────────── */}
      <Card>
        <Body>{tStt('title')}</Body>
        <Body muted>{tStt('sub')}</Body>
        <View style={{ gap: 8, marginTop: 8 }}>
          {STT_LANGUAGES.map((code: SttLanguage) => {
            const on = sttLanguage === code;
            const label = code === 'en-US' ? tStt('en') : tStt('es');
            return (
              <Button
                key={code}
                title={label}
                variant={on ? 'primary' : 'secondary'}
                onPress={() => void setSttLang(code)}
              />
            );
          })}
        </View>
      </Card>

      {/* Voice picker ───────────────────────────────────────────────────── */}
      <Card>
        <Body>{tVoice('title')}</Body>
        <Body muted>{tVoice('sub')}</Body>
        <View style={{ gap: 8, marginTop: 8 }}>
          {(['es-ES', 'en-US', 'pt-BR', 'fr-FR'] as const).map((code) => {
            const on = voice === code;
            const labelKey =
              code === 'es-ES'
                ? 'langEs'
                : code === 'en-US'
                  ? 'langEn'
                  : code === 'pt-BR'
                    ? 'langPt'
                    : 'langFr';
            return (
              <Button
                key={code}
                title={tVoice(labelKey)}
                variant={on ? 'primary' : 'secondary'}
                onPress={() => void pickVoice(code)}
              />
            );
          })}
          {cartesia ? (
            <Button
              title={tVoice('cartesia')}
              variant={voice === 'cartesia' ? 'primary' : 'secondary'}
              onPress={() => void pickVoice('cartesia')}
            />
          ) : null}
        </View>
        <Button
          title={testing ? tVoice('testing') : tVoice('test')}
          variant="secondary"
          onPress={() => void testVoice()}
          busy={testing}
        />
      </Card>

      {/* Wake word ─────────────────────────────────────────────────────── */}
      <Card>
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Body>{tWake('title')}</Body>
            <Body muted>{tWake('sub')}</Body>
          </View>
          <Pressable
            onPress={() => void toggleWake(!wakeOn)}
            className={`h-7 w-12 rounded-full p-0.5 ${wakeOn ? 'bg-cyan' : 'bg-secondary'}`}
          >
            <View
              className={`h-6 w-6 rounded-full bg-card ${wakeOn ? 'self-end' : 'self-start'}`}
            />
          </Pressable>
        </View>
        <Text
          style={{ fontFamily: fonts.semibold }}
          className={`text-[10px] uppercase tracking-widest ${wakeOn ? 'text-cyan' : 'text-muted-foreground'}`}
        >
          {wakeOn ? tWake('enabled') : tWake('disabled')}
        </Text>
      </Card>

      {/* Voice ID (owner verification) ──────────────────────────────────── */}
      <Card>
        <Body>{tVid('cardTitle')}</Body>
        <Body muted>{tVid('cardSub')}</Body>
        <Button
          title={tVid('open')}
          variant="secondary"
          onPress={() => router.push('/voice-id')}
        />
      </Card>

      {/* Screen capture ────────────────────────────────────────────────── */}
      {entitlements.policy.screenCapture && screenCaptureAvailable() ? (
        <Card>
          <Body>{tShot('title')}</Body>
          <Body muted>{tShot('sub')}</Body>
          <Button
            title={tShot('capture')}
            variant="secondary"
            onPress={() => void grabScreenshot()}
            busy={shotBusy}
          />

          {/* Direct screenshot (AccessibilityService — no recording/cast prompt) */}
          <View style={{ marginTop: 12, gap: 6 }}>
            <Body>{tShot('directTitle')}</Body>
            <Text
              style={{ fontFamily: fonts.semibold }}
              className={`text-[10px] uppercase tracking-widest ${
                directShot ? 'text-cyan' : 'text-muted-foreground'
              }`}
            >
              {directShot ? tShot('directEnabled') : tShot('directDisabled')}
            </Text>
            <Body muted>{tShot('directHint')}</Body>
            <Button
              title={tShot('directEnable')}
              variant="secondary"
              onPress={() => void openDirectShot()}
            />
          </View>
        </Card>
      ) : null}

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
