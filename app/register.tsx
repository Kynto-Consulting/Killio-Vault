import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';

import { useAuth } from '@/core/auth/AuthContext';
import { useTranslations } from '@/i18n';
import { LINKS, openLink } from '@/core/links';
import { colors, radius, spacing, typography } from '@/theme/theme';

type Strength = 'weak' | 'medium' | 'strong' | null;

export default function RegisterScreen() {
  const router = useRouter();
  const t = useTranslations('signup');
  const { registerAccount } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [allowComms, setAllowComms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength: Strength =
    password.length === 0
      ? null
      : password.length < 8
        ? 'weak'
        : password.length < 12
          ? 'medium'
          : 'strong';

  const strengthLabel =
    strength === 'weak'
      ? t('strengthWeak')
      : strength === 'medium'
        ? t('strengthMedium')
        : strength === 'strong'
          ? t('strengthStrong')
          : '';

  const submit = async () => {
    setError(null);
    if (password !== confirm) return setError(t('passwordsMismatch'));
    if (password.length < 8) return setError(t('passwordMinLength'));
    if (!acceptedTerms) return setError(t('termsRequired'));

    setBusy(true);
    try {
      await registerAccount({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        acceptedTerms,
        allowCommunications: allowComms,
      });
      router.replace('/home');
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(typeof msg === 'string' ? msg : t('serverError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Image
            source={require('../assets/killio_white.webp')}
            style={styles.logo}
          />
          <Text style={styles.title}>{t('title')}</Text>
          <Text style={styles.subtitle}>{t('subtitle')}</Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Field label={t('fullName')} value={displayName} onChange={setDisplayName} placeholder="Ronald García" autoComplete="name" />

          <View style={styles.row}>
            <View style={styles.col}>
              <Field label={t('username')} value={username} onChange={setUsername} placeholder="ronald" autoCapitalize="none" />
            </View>
            <View style={styles.col}>
              <Field label={t('email')} value={email} onChange={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>

          <Field
            label={t('password')}
            value={password}
            onChange={setPassword}
            placeholder={t('passwordPlaceholder')}
            secureTextEntry
            autoComplete="new-password"
          />
          {strength ? (
            <View style={styles.strengthRow}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.strengthBar,
                    strength === 'weak' && i === 0 && { backgroundColor: colors.destructive },
                    strength === 'medium' && i <= 1 && { backgroundColor: colors.warning },
                    strength === 'strong' && i <= 2 && { backgroundColor: colors.success },
                  ]}
                />
              ))}
              <Text style={styles.strengthLabel}>{strengthLabel}</Text>
            </View>
          ) : null}

          <Field
            label={t('confirmPassword')}
            value={confirm}
            onChange={setConfirm}
            placeholder={t('confirmPlaceholder')}
            secureTextEntry
            autoComplete="new-password"
            valid={!!confirm && confirm === password}
          />

          <View style={styles.consentBox}>
            <Checkbox checked={acceptedTerms} onToggle={() => setAcceptedTerms((v) => !v)} label={t('acceptTerms')} />
            <Checkbox
              checked={allowComms}
              onToggle={() => setAllowComms((v) => !v)}
              label={t('communicationsOptIn')}
              hint={t('communicationsHint')}
            />
          </View>

          <Pressable style={[styles.submit, busy && styles.disabled]} disabled={busy} onPress={submit}>
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.submitText}>{t('submit')}  →</Text>
            )}
          </Pressable>

          <View style={styles.footerRow}>
            <Text style={styles.muted}>{t('alreadyAccount')} </Text>
            <Pressable onPress={() => router.replace('/login')}>
              <Text style={styles.link}>{t('goLogin')}</Text>
            </Pressable>
          </View>

          <Text style={styles.footerLegal}>{t('footerLegal')}</Text>

          <View style={styles.legalLinks}>
            <Pressable onPress={() => openLink(LINKS.terms)}>
              <Text style={styles.legalLink}>{t('termsLink')}</Text>
            </Pressable>
            <Text style={styles.dot}>·</Text>
            <Pressable onPress={() => openLink(LINKS.privacy)}>
              <Text style={styles.legalLink}>{t('privacyLink')}</Text>
            </Pressable>
            <Text style={styles.dot}>·</Text>
            <Pressable onPress={() => openLink(LINKS.cookies)}>
              <Text style={styles.legalLink}>{t('cookiesLink')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoComplete,
  valid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'default';
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: 'name' | 'email' | 'username' | 'new-password';
  valid?: boolean;
}) {
  return (
    <View style={{ gap: 6, marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          // @ts-ignore RN autoComplete accepts these on Android
          autoComplete={autoComplete}
        />
        {valid ? (
          <View style={styles.check}>
            <Check size={16} color={colors.success} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Checkbox({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <Pressable style={styles.checkRow} onPress={onToggle}>
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Check size={13} color={colors.primaryForeground} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        {hint ? <Text style={styles.checkHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing.xl,
  },
  logo: { width: 110, height: 32, resizeMode: 'contain', alignSelf: 'center', marginBottom: spacing.md },
  title: { color: colors.foreground, fontSize: typography.fontSize['2xl'], fontWeight: typography.weight.bold, textAlign: 'center' },
  subtitle: { color: colors.mutedForeground, fontSize: typography.fontSize.sm, textAlign: 'center', marginTop: 4, marginBottom: spacing.lg },
  errorBox: {
    backgroundColor: 'rgba(220,38,38,0.1)',
    borderColor: 'rgba(220,38,38,0.3)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.destructive, fontSize: typography.fontSize.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  label: { color: colors.foreground, fontSize: typography.fontSize.sm, fontWeight: typography.weight.medium },
  input: {
    height: 44,
    backgroundColor: colors.background,
    color: colors.foreground,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: typography.fontSize.base,
  },
  check: { position: 'absolute', right: 12, top: 12, color: colors.success, fontSize: 16 },
  strengthRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: -spacing.sm, marginBottom: spacing.md },
  strengthBar: { height: 4, flex: 1, borderRadius: radius.pill, backgroundColor: colors.muted },
  strengthLabel: { color: colors.mutedForeground, fontSize: typography.fontSize.xs, marginLeft: 4 },
  consentBox: {
    gap: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  checkRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  box: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  boxCheck: { color: colors.primaryForeground, fontSize: 13, fontWeight: '700' },
  checkLabel: { color: colors.foreground, fontSize: typography.fontSize.sm, lineHeight: 20 },
  checkHint: { color: colors.mutedForeground, fontSize: typography.fontSize.xs },
  submit: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  submitText: { color: colors.primaryForeground, fontSize: typography.fontSize.base, fontWeight: typography.weight.semibold },
  disabled: { opacity: 0.6 },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  muted: { color: colors.mutedForeground, fontSize: typography.fontSize.sm },
  link: { color: colors.cyan, fontSize: typography.fontSize.sm, fontWeight: typography.weight.medium },
  footerLegal: { color: colors.mutedForeground, fontSize: typography.fontSize.xs, textAlign: 'center', marginTop: spacing.md },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 6 },
  legalLink: { color: colors.cyan, fontSize: typography.fontSize.xs },
  dot: { color: colors.mutedForeground, fontSize: typography.fontSize.xs },
});
