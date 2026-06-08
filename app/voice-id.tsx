import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Mic, ShieldCheck, Trash2 } from 'lucide-react-native';

import { Screen, Card, H1, Body, Button } from '@/ui';
import { colors } from '@/theme/theme';
import { useTranslations } from '@/i18n';
import { useCapture } from '@/capture/CaptureContext';
import * as Speech from '@/stt/native/KillioSpeech';
import { clear, enroll, hasVoiceprint } from '@/voiceid/voiceprint';

/** How many utterance x-vectors to average into the owner voiceprint. */
const TARGET_SAMPLES = 6;

type Phase = 'idle' | 'recording' | 'saving' | 'done';

/**
 * Owner voice enrollment ("Voice ID"). The user reads a short prompt aloud; we
 * collect a handful of Vosk speaker x-vectors from the live transcripts, average
 * + normalize them into a voiceprint, and store it locally. Once enrolled the
 * wake word only fires for the owner's voice (see CaptureController). Fully
 * offline — no audio or vectors leave the device.
 */
export default function VoiceIdScreen() {
  const t = useTranslations('voiceId');
  const { refreshVoiceprint } = useCapture();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const vectorsRef = useRef<number[][]>([]);
  const subRef = useRef<{ remove(): void } | null>(null);
  const phaseRef = useRef<Phase>('idle');

  useEffect(() => {
    void hasVoiceprint().then(setEnrolled);
    return () => {
      subRef.current?.remove();
      subRef.current = null;
    };
  }, []);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const finishEnroll = async () => {
    subRef.current?.remove();
    subRef.current = null;
    setPhaseBoth('saving');
    try {
      await enroll(vectorsRef.current);
      // Push the new voiceprint into the running capture controller so the wake
      // gate switches to owner-only immediately (no restart needed).
      refreshVoiceprint();
      setEnrolled(true);
      setPhaseBoth('done');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhaseBoth('idle');
    }
  };

  const startEnroll = async () => {
    if (!Speech.isAvailable()) {
      setError(t('unavailable'));
      return;
    }
    setError(null);
    setCount(0);
    vectorsRef.current = [];
    setPhaseBoth('recording');

    subRef.current = Speech.onTranscript((e) => {
      if (phaseRef.current !== 'recording') return;
      if (Array.isArray(e.spk) && e.spk.length > 0) {
        vectorsRef.current.push(e.spk);
        const n = vectorsRef.current.length;
        setCount(n);
        if (n >= TARGET_SAMPLES) void finishEnroll();
      }
    });

    // Ensure the recognizer (with the speaker model) is running so transcripts
    // carry spk vectors. If 24/7 capture is already on this is a no-op.
    try {
      await Speech.start({ language: 'es-ES' });
    } catch (e: any) {
      subRef.current?.remove();
      subRef.current = null;
      setError(e?.message ?? String(e));
      setPhaseBoth('idle');
    }
  };

  const cancel = () => {
    subRef.current?.remove();
    subRef.current = null;
    setPhaseBoth('idle');
    setCount(0);
  };

  const clearVoice = async () => {
    await clear();
    refreshVoiceprint();
    setEnrolled(false);
    setPhaseBoth('idle');
    setCount(0);
  };

  const recording = phase === 'recording';
  const saving = phase === 'saving';

  return (
    <Screen scroll>
      <View className="h-14 w-14 items-center justify-center rounded-2xl border border-cyan/20 bg-cyan/10">
        <ShieldCheck size={26} color={colors.cyan} />
      </View>
      <H1>{t('title')}</H1>

      <Card>
        <Body>{t('intro')}</Body>
        <Body muted>{t('howItWorks')}</Body>
        <Body muted>
          {enrolled ? t('statusEnrolled') : t('statusNotEnrolled')}
        </Body>
      </Card>

      {recording || saving ? (
        <Card>
          <View className="flex-row items-center gap-2">
            <Mic size={18} color={colors.cyan} />
            <Body>{saving ? t('saving') : t('listening')}</Body>
          </View>
          <Body muted>{t('prompt')}</Body>
          <Body muted>{t('progress', { n: count, total: TARGET_SAMPLES })}</Body>
          {recording ? (
            <Button title={t('cancel')} variant="secondary" onPress={cancel} />
          ) : null}
        </Card>
      ) : (
        <Card>
          <Button
            title={enrolled ? t('reenroll') : t('enroll')}
            onPress={() => void startEnroll()}
          />
          {enrolled ? (
            <View className="mt-2 flex-row items-center gap-2">
              <Trash2 size={16} color={colors.mutedForeground} />
              <View className="flex-1">
                <Button
                  title={t('clear')}
                  variant="secondary"
                  onPress={() => void clearVoice()}
                />
              </View>
            </View>
          ) : null}
        </Card>
      )}

      {phase === 'done' ? <Body muted>{t('done')}</Body> : null}
      {error ? <Body muted>{t('error', { message: error })}</Body> : null}

      <Body muted>{t('privacyNote')}</Body>
    </Screen>
  );
}
