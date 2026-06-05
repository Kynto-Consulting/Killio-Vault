import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle2, MessageCircle, Smartphone } from 'lucide-react-native';

import { Screen, Body, Button, Input, H1, H2, Card } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { requestPairCode, getStatus } from '@/core/api/whatsapp.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * WhatsApp Personal pairing — enter your number, get an 8-digit code, type it
 * in WhatsApp → Linked devices → Link with phone number. Worker polls Baileys
 * and the Connected status flips once the link is established.
 */
export default function WhatsappPair() {
  const router = useRouter();
  const { personalTeam } = useAuth();
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
    if (!personalTeam?.id || !phone.trim()) return;
    setBusy(true);
    try {
      const r = await requestPairCode(personalTeam.id, phone.trim());
      setCode(formatCode(r.code));
      // Begin polling status every 5s.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await getStatus(personalTeam.id);
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
          <H1>WhatsApp conectado</H1>
          <Body muted>{pairedPhone ?? ''}</Body>
          <Button title="Listo" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View className="flex-row items-center gap-2">
        <MessageCircle size={22} color={'#128c7e'} />
        <H1>WhatsApp (personal)</H1>
      </View>

      {!code ? (
        <>
          <Body muted>
            Ingresa tu número de WhatsApp en formato internacional (ej. +51999123456).
            Generaremos un código de 8 dígitos para vincular este dispositivo.
          </Body>
          <View className="my-3">
            <Input
              value={phone}
              onChangeText={setPhone}
              placeholder="+51999123456"
              keyboardType="phone-pad"
              autoComplete="tel"
            />
          </View>
          <Button title="Generar código" onPress={startPair} busy={busy} />
        </>
      ) : (
        <>
          <Card>
            <View className="flex-row items-center gap-2">
              <Smartphone size={16} color={colors.cyan} />
              <H2>Código de vinculación</H2>
            </View>
            <Text
              style={{ fontFamily: fonts.mono, fontSize: 36, letterSpacing: 6, color: colors.foreground }}
              className="my-3 text-center"
            >
              {code}
            </Text>
            <Body muted>1. Abre WhatsApp en tu teléfono.</Body>
            <Body muted>2. Ajustes → Dispositivos vinculados → Vincular un dispositivo.</Body>
            <Body muted>3. Toca "Vincular con número de teléfono".</Body>
            <Body muted>4. Escribe el código de 8 dígitos.</Body>
          </Card>
          <Button
            title="Generar otro código"
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
