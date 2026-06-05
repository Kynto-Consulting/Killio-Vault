import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { requestOtp } from '@/core/api/auth.client';
import { useAuth } from '@/core/auth/AuthContext';
import { useTranslations } from '@/i18n';
import { Button, Input } from '@/ui';
import { LINKS, openLink } from '@/core/links';

type Step = 'password' | 'otp';

export default function LoginScreen() {
  const router = useRouter();
  const t = useTranslations('login');
  const tc = useTranslations('common');
  const { loginWithPassword, verifyOtp } = useAuth();

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPasswordSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      const signedIn = await loginWithPassword(email.trim(), password);
      if (signedIn) {
        router.replace('/home');
      } else {
        const { token } = await requestOtp(email.trim());
        setOtpToken(token);
        setStep('otp');
      }
    } catch (e) {
      setError(readError(e, t('errorLogin')));
    } finally {
      setBusy(false);
    }
  };

  const onOtpSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(email.trim(), code.trim(), otpToken);
      router.replace('/home');
    } catch (e) {
      setError(readError(e, t('errorCode')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 justify-center bg-background p-6"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="rounded-3xl border border-border bg-card p-7">
        <Image
          source={require('../assets/killio_white.webp')}
          className="mb-4 h-8 w-28 self-center"
          resizeMode="contain"
        />
        <Text className="text-center text-2xl font-bold text-foreground">Killio Vault</Text>
        <Text className="mb-6 mt-1 text-center text-sm text-muted-foreground">{t('subtitle')}</Text>

        <View className="gap-3">
          <Input
            placeholder={t('email')}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={step === 'password'}
          />
          {step === 'password' ? (
            <>
              <Input placeholder={t('password')} secureTextEntry value={password} onChangeText={setPassword} />
              <Pressable className="self-end" onPress={() => openLink(LINKS.forgotPassword)}>
                <Text className="text-xs font-medium text-cyan">{t('forgot')}</Text>
              </Pressable>
            </>
          ) : (
            <Input placeholder={t('code')} keyboardType="number-pad" value={code} onChangeText={setCode} />
          )}

          {error ? (
            <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
              <Text className="text-sm text-destructive">{error}</Text>
            </View>
          ) : null}

          <Button
            title={step === 'password' ? tc('enter') : t('verify')}
            onPress={step === 'password' ? onPasswordSubmit : onOtpSubmit}
            busy={busy}
            pill
          />
        </View>

        <View className="mt-6 flex-row justify-center">
          <Text className="text-sm text-muted-foreground">{t('noAccount')} </Text>
          <Pressable onPress={() => router.push('/register')}>
            <Text className="text-sm font-semibold text-cyan">{t('goSignup')}</Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-6 flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Pressable onPress={() => openLink(LINKS.home)}>
          <Text className="text-xs text-muted-foreground">killio.dev</Text>
        </Pressable>
        <Pressable onPress={() => openLink(LINKS.terms)}>
          <Text className="text-xs text-muted-foreground">{t('terms')}</Text>
        </Pressable>
        <Pressable onPress={() => openLink(LINKS.privacy)}>
          <Text className="text-xs text-muted-foreground">{t('privacy')}</Text>
        </Pressable>
        <Pressable onPress={() => openLink(LINKS.help)}>
          <Text className="text-xs text-muted-foreground">{t('help')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function readError(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
}
