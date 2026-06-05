import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle2, MessageCircle, Smartphone } from 'lucide-react-native';

import { Screen, Body, Button, Input, H1, H2, Card } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { requestPairCode, getStatus } from '@/core/api/whatsapp.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * WhatsApp Personal pairing â€” enter your number, get an 8-digit code, type it
 * in WhatsApp â†’ Linked devices â†’ Link with phone number. Worker polls Baileys
 * and the Connected status flips once the link is established.
 */
export default function WhatsappPair() {
  const router = useRouter();
  const t = useTranslations('whatsappPair');
  const { activeTeam } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pairedPhone, setPairedPhone] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPair = async () => {
    if (!activeTeam?.id || !phone.trim()) return;
    setBusy(true);
    try {
      const r = await requestPairCode(activeTeam.id, phone.trim());
      setCode(formatCode(r.code));
      // Begin polling status every 5s.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await getStatus(activeTeam.id);
          if (s.connected) {
            setConnected(true);
            setPairedPhone(s.phone);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          /* ignore */
        }
      }, 5000);
    } catch (e) {
      setCode(null);
    } finally {
      setBusy(false);
    }
  };

  if (connected) {
    return (
      <Screen scroll>
        <View className="items-center gap-3 py-10">
          <CheckCircle2 size={48} color={colors.success} />
          <H1>{t('connectedTitle')}</H1>
          <Body muted>{pairedPhone ?? ''}</Body>
          <Button title={t('done')} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View className="flex-row items-center gap-2">
        <MessageCircle size={22} color={'#128c7e'} />
        <H1>{t('headerTitle')}</H1>
      </View>

      {!code ? (
        <>
          <Body muted>{t('intro')}</Body>
          <View className="my-3">
            <Input
              value={phone}
              onChangeText={setPhone}
              placeholder={t('phonePlaceholder')}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
          </View>
          <Button title={t('generate')} onPress={startPair} busy={busy} />
        </>
      ) : (
        <>
          <Card>
            <View className="flex-row items-center gap-2">
              <Smartphone size={16} color={colors.cyan} />
              <H2>{t('pairTitle')}</H2>
            </View>
            <Text
              style={{ fontFamily: fonts.mono, fontSize: 36, letterSpacing: 6, color: colors.foreground }}
              className="my-3 text-center"
            >
              {code}
            </Text>
            <Body muted>{t('step1')}</Body>
            <Body muted>{t('step2')}</Body>
            <Body muted>{t('step3')}</Body>
            <Body muted>{t('step4')}</Body>
          </Card>
          <Button
            title={t('generateAnother')}
            variant="secondary"
            onPress={() => {
              setCode(null);
              if (pollRef.current) clearInterval(pollRef.current);
            }}
          />
        </>
      )}
    </Screen>
  );
}

function formatCode(raw: string): string {
  const s = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return raw;
}
