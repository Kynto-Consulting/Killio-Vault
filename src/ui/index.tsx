import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts } from '../theme/fonts';

export { RichText } from './RichText';
export { RefPill } from './RefPill';

/**
 * Vault UI kit — nativewind (tailwind for RN) using the same dark tokens as the
 * Killio web frontend (see tailwind.config.js). Mirrors the web component look:
 * bg-card/border-border cards, primary/secondary/outline buttons, rounded-md
 * inputs.
 */

export function Screen({
  children,
  scroll,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  if (scroll) {
    return (
      <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
        <ScrollView
          contentContainerClassName={padded ? 'p-5 gap-3' : 'gap-3'}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={['bottom']} className={`flex-1 bg-background ${padded ? 'p-5' : ''}`}>
      {children}
    </SafeAreaView>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`rounded-2xl border border-border bg-card p-4 gap-2 ${className}`}>
      {children}
    </View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.bold }} className="text-2xl text-foreground mb-1">
      {children}
    </Text>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.semibold }} className="text-lg text-foreground">
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  className = '',
}: {
  children: React.ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <Text
      className={`text-base leading-6 ${muted ? 'text-muted-foreground' : 'text-foreground'} ${className}`}
    >
      {children}
    </Text>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.medium }} className="text-sm text-muted-foreground">
      {children}
    </Text>
  );
}

export function Divider() {
  return <View className="h-px bg-border my-1" />;
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  pill,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  pill?: boolean;
}) {
  const base = `h-12 items-center justify-center px-4 ${pill ? 'rounded-full' : 'rounded-xl'}`;
  const byVariant: Record<ButtonVariant, string> = {
    primary: 'bg-primary',
    secondary: 'bg-secondary border border-border',
    outline: 'border border-border bg-transparent',
    ghost: 'bg-transparent',
    danger: 'bg-transparent',
  };
  const textByVariant: Record<ButtonVariant, string> = {
    primary: 'text-primary-foreground',
    secondary: 'text-foreground',
    outline: 'text-foreground',
    ghost: 'text-foreground',
    danger: 'text-destructive',
  };
  const spinner = variant === 'primary' ? '#171717' : '#ededed';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      className={`${base} ${byVariant[variant]} active:opacity-80 ${busy || disabled ? 'opacity-60' : ''}`}
    >
      {busy ? (
        <ActivityIndicator color={spinner} />
      ) : (
        <Text style={{ fontFamily: fonts.semibold }} className={`text-base ${textByVariant[variant]}`}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="#6f6f78"
      style={{ fontFamily: fonts.regular }}
      className="h-12 rounded-xl border border-border bg-secondary px-4 text-base text-foreground"
      {...props}
    />
  );
}

/** Small status/category chip. */
export function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'muted' | 'success' | 'cyan' | 'danger';
}) {
  const toneCls: Record<string, string> = {
    muted: 'text-muted-foreground',
    success: 'text-success',
    cyan: 'text-cyan',
    danger: 'text-destructive',
  };
  return <Text className={`text-sm font-semibold ${toneCls[tone]}`}>{label}</Text>;
}
