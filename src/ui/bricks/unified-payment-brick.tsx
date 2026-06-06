import React, { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
  Loader2,
  Clock,
  RotateCcw,
  Settings,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react-native';

import { useTranslations } from '@/i18n';
import { useAuth } from '@/core/auth/AuthContext';
import { listScripts, type ScriptSummary } from '@/core/api/scripts.client';
import { createPaymentLink, type CreatePaymentLinkPayload } from '@/core/api/payments.client';
import { API_BASE_URL } from '@/core/api/config';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * React Native port of the web `unified-payment-brick.tsx`.
 *
 * The brick API and content schema match the web file 1:1 — same prop names,
 * same content keys, same i18n namespace (`document-detail`) — so a brick
 * authored on web round-trips through Vault and back unchanged.
 *
 * Web → Native swap notes (key deltas from the source file):
 *   • Mobile: iframe checkout → system browser via Linking. The web brick
 *     embeds the provider checkout in an <iframe>; RN can't do iframes, so we
 *     open `checkoutUrl` in the system browser with `Linking.openURL`.
 *   • `useSession()` → `useAuth()`.
 *   • `lucide-react` → `lucide-react-native`.
 *   • shadcn `Button`/`Input` → inline `<Pressable>` / `<TextInput>`.
 *   • `<select>` → tap-to-cycle / modal picker (currency + provider).
 *   • `<textarea>` → `<TextInput multiline>`.
 *   • `navigator.clipboard` → `expo-clipboard`.
 *   • `toast(msg, kind)` → `Alert.alert(...)`.
 *   • `window.open('/integrations')` → dropped (web-only deep link).
 *   • `process.env.NEXT_PUBLIC_*` → Vault `API_BASE_URL`.
 *   • CSS `hover:`/`group-hover:`/`cursor-*` removed.
 */

interface UnifiedPaymentBrickProps {
  id: string;
  content: {
    title?: string;
    description?: string | null;
    amount?: number;
    currency?: string;
    provider?: 'stripe' | 'paypal' | 'mercadopago';
    connectionId?: string | null;
    externalProductId?: string | null;
    checkoutUrl?: string | null;
    status?: 'pending' | 'paid' | 'failed' | 'refunded';
    paidAt?: string | null;
    payerEmail?: string | null;
    webhookUrl?: string | null;
    scriptId?: string | null;
    credentialsLocked?: boolean;
    credentialsLastUpdatedAt?: string | null;
  };
  canEdit: boolean;
  onUpdate: (content: any) => void;
  readonly?: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
  mercadopago: 'MercadoPago',
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  ARS: '$',
  MXN: '$',
  BRL: 'R$',
};

const CURRENCIES = ['USD', 'EUR', 'ARS', 'MXN', 'BRL'];
const PROVIDERS: Array<'stripe' | 'paypal' | 'mercadopago'> = ['stripe', 'paypal', 'mercadopago'];

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'paid') return <CheckCircle2 size={16} color={colors.success} />;
  if (status === 'failed') return <AlertCircle size={16} color={colors.destructive} />;
  if (status === 'refunded') return <RotateCcw size={16} color={colors.indigo} />;
  return <Clock size={16} color={colors.warning} />;
};

/** Inline label/value picker row that cycles a small option set on tap. */
function PickerRow({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  renderLabel?: (v: string) => string;
}) {
  const cycle = () => {
    const idx = options.indexOf(value);
    const next = options[(idx + 1) % options.length];
    onChange(next);
  };
  return (
    <Pressable
      onPress={cycle}
      className="h-10 flex-row items-center justify-between rounded-md border border-border bg-background px-3"
    >
      <Text style={{ fontFamily: fonts.regular }} className="text-sm text-foreground">
        {renderLabel ? renderLabel(value) : value}
      </Text>
      <ChevronDown size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

export function UnifiedPaymentBrick({
  id,
  content,
  canEdit,
  onUpdate,
  readonly = false,
}: UnifiedPaymentBrickProps) {
  const t = useTranslations('document-detail');
  const { activeTeam } = useAuth();
  const activeTeamId = activeTeam?.id ?? null;
  // accessToken is injected by the axios interceptor (token-store); kept as a
  // truthy stub so the web `if (accessToken)` guards keep working.
  const accessToken = activeTeamId ? 'managed-by-axios' : null;

  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [teamScripts, setTeamScripts] = useState<ScriptSummary[]>([]);
  const [isLoadingScripts, setIsLoadingScripts] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [scriptPickerOpen, setScriptPickerOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: content.title || '',
    description: content.description || '',
    amount: content.amount || 0,
    currency: content.currency || 'USD',
    provider: content.provider || 'stripe',
    connectionId: content.connectionId || '',
    checkoutUrl: content.checkoutUrl || '',
  });

  // Mobile: web reads NEXT_PUBLIC_* env vars; Vault uses the shared API base.
  const webhookBase = useMemo(() => API_BASE_URL.replace(/\/+$/, ''), []);

  const webhookScripts = useMemo(() => {
    return teamScripts.filter((script) => {
      const publicToken = script.triggerConfig?.publicToken;
      return (
        script.triggerType === 'webhook' &&
        script.isActive &&
        typeof publicToken === 'string' &&
        publicToken.length > 0
      );
    });
  }, [teamScripts]);

  useEffect(() => {
    if (isEditing && activeTeamId && accessToken) {
      setIsLoadingScripts(true);
      listScripts(activeTeamId, accessToken)
        .then(setTeamScripts)
        .catch((err: unknown) => {
          console.error('Error loading scripts:', err);
        })
        .finally(() => setIsLoadingScripts(false));
    }
  }, [isEditing, activeTeamId, accessToken]);

  const handleSave = async () => {
    setIsSaving(true);

    let checkoutUrl = formData.checkoutUrl.trim();
    let externalProductId = content.externalProductId ?? null;

    if (!checkoutUrl && formData.amount > 0 && accessToken) {
      try {
        const payload: CreatePaymentLinkPayload = {
          cardId: id,
          brickId: id,
          title: formData.title,
          description: formData.description || undefined,
          amount: formData.amount,
          currency: formData.currency,
          provider: formData.provider,
          connectionId: formData.connectionId || undefined,
        };

        const paymentLink = await createPaymentLink(payload, accessToken);
        checkoutUrl = paymentLink.checkoutUrl;
        externalProductId = paymentLink.externalProductId ?? null;
      } catch (error) {
        console.error('Error generating payment link:', error);
        Alert.alert(t('payment.form.linkError') || 'Error', t('payment.form.linkError') || '');
      }
    }

    onUpdate({
      ...content,
      title: formData.title,
      description: formData.description,
      amount: formData.amount,
      currency: formData.currency,
      provider: formData.provider,
      connectionId: formData.connectionId,
      checkoutUrl: checkoutUrl || content.checkoutUrl || null,
      externalProductId,
      status: content.status || 'pending',
      credentialsLocked: true,
      credentialsLastUpdatedAt: new Date().toISOString(),
    });
    setIsEditing(false);
    setIsSaving(false);
  };

  const handleCopyUrl = async () => {
    if (content.checkoutUrl) {
      await Clipboard.setStringAsync(content.checkoutUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const formatAmount = (amount: number, currency: string) => {
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    return `${symbol}${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const status = content.status || 'pending';
  const checkoutUrl = content.checkoutUrl;
  const isConfigured = !!(content.amount && content.amount > 0);

  const statusConfig = {
    pending: { color: colors.warning, label: t('payment.status.pending') || 'Pendiente' },
    paid: { color: colors.success, label: t('payment.status.paid') || 'Pagado' },
    failed: { color: colors.destructive, label: t('payment.status.failed') || 'Fallido' },
    refunded: { color: colors.indigo, label: t('payment.status.refunded') || 'Reembolsado' },
  };

  const currentStatus = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
  const providerLabels: Record<string, string> = {
    stripe: t('payment.form.providerStripe') || 'Stripe',
    paypal: t('payment.form.providerPaypal') || 'PayPal',
    mercadopago: t('payment.form.providerMercadoPago') || 'MercadoPago',
  };

  const selectedScriptName =
    webhookScripts.find((s) => s.id === content.scriptId)?.name ||
    (content.scriptId ? content.scriptId : t('payment.form.noScript') || 'Sin script de notificación');

  // ── EDIT MODE ────────────────────────────────────────────────────────────────
  if (isEditing && canEdit && !readonly) {
    return (
      <View className="rounded-lg border border-border bg-card p-5" style={{ gap: 16 }}>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            {t('payment.title') || 'Pago'}
          </Text>
          <Pressable onPress={() => setIsEditing(false)} className="rounded-md px-2 py-1">
            <Text className="text-xs text-foreground">{t('payment.form.cancel') || 'Cancelar'}</Text>
          </Pressable>
        </View>

        <View style={{ gap: 12 }}>
          <TextInput
            value={formData.title}
            onChangeText={(text) => setFormData({ ...formData, title: text })}
            placeholder={t('payment.form.titlePlaceholder') || 'Título del pago'}
            placeholderTextColor={colors.mutedForeground}
            style={{ fontFamily: fonts.regular }}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
          <TextInput
            value={formData.description || ''}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            placeholder={t('payment.form.descriptionPlaceholder') || 'Descripción opcional'}
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={2}
            style={{ fontFamily: fonts.regular, textAlignVertical: 'top' }}
            className="min-h-[56px] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </View>

        <View className="flex-row" style={{ gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text className="text-xs text-muted-foreground">{t('payment.form.amount') || 'Monto'}</Text>
            <TextInput
              keyboardType="decimal-pad"
              value={String(formData.amount)}
              onChangeText={(text) => setFormData({ ...formData, amount: parseFloat(text) || 0 })}
              placeholder="0.00"
              placeholderTextColor={colors.mutedForeground}
              style={{ fontFamily: fonts.regular }}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text className="text-xs text-muted-foreground">{t('payment.form.currency') || 'Moneda'}</Text>
            <PickerRow
              options={CURRENCIES}
              value={formData.currency}
              onChange={(next) => setFormData({ ...formData, currency: next })}
            />
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text className="text-xs text-muted-foreground">{t('payment.form.provider') || 'Proveedor'}</Text>
          <PickerRow
            options={PROVIDERS}
            value={formData.provider}
            onChange={(next) => setFormData({ ...formData, provider: next as typeof formData.provider })}
            renderLabel={(v) => providerLabels[v] || v}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text className="text-xs text-muted-foreground">
            {t('payment.form.checkoutUrl') || 'URL de pago (opcional)'}
          </Text>
          <TextInput
            value={formData.checkoutUrl}
            onChangeText={(text) => setFormData({ ...formData, checkoutUrl: text })}
            placeholder={t('payment.form.checkoutUrlPlaceholder') || 'https://...'}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={{ fontFamily: fonts.regular }}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
          <Text className="text-[10px] text-muted-foreground">
            {t('payment.form.checkoutUrlHint') ||
              'Si está vacío se generará automáticamente con las credenciales del workspace.'}
          </Text>
        </View>

        <View className="rounded-md border border-border/60 bg-muted/20 p-3" style={{ gap: 8 }}>
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              {t('payment.form.notifyTitle') || 'Notificación post-pago'}
            </Text>
            <Pressable
              onPress={() => {
                if (activeTeamId && accessToken) {
                  setIsLoadingScripts(true);
                  listScripts(activeTeamId, accessToken)
                    .then(setTeamScripts)
                    .finally(() => setIsLoadingScripts(false));
                }
              }}
              disabled={isLoadingScripts || !activeTeamId || !accessToken}
              className={isLoadingScripts || !activeTeamId || !accessToken ? 'opacity-50' : ''}
            >
              {isLoadingScripts ? (
                <Loader2 size={14} color={colors.mutedForeground} />
              ) : (
                <RefreshCw size={14} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>
          <Pressable
            onPress={() => setScriptPickerOpen(true)}
            disabled={isLoadingScripts}
            className="h-9 flex-row items-center justify-between rounded-md border border-border bg-background px-3"
          >
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {isLoadingScripts ? t('payment.form.loading') || 'Cargando...' : selectedScriptName}
            </Text>
            <ChevronDown size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View className="flex-row items-start rounded-md border border-border bg-success/10 p-3" style={{ gap: 8 }}>
          <Lock size={14} color={colors.success} style={{ marginTop: 2 }} />
          <Text style={{ flex: 1 }} className="text-xs text-success">
            {t('payment.form.credentialsHint') ||
              'Las credenciales del proveedor se gestionan en Integrations del workspace.'}
          </Text>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          className={`h-11 flex-row items-center justify-center rounded-lg bg-primary ${
            isSaving ? 'opacity-60' : ''
          }`}
        >
          {isSaving ? <Loader2 size={16} color={colors.primaryForeground} /> : null}
          <Text
            style={{ fontFamily: fonts.semibold, marginLeft: isSaving ? 8 : 0 }}
            className="text-sm text-primary-foreground"
          >
            {isSaving ? t('payment.form.saving') || 'Guardando...' : t('payment.form.save') || 'Guardar'}
          </Text>
        </Pressable>

        <Modal
          visible={scriptPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setScriptPickerOpen(false)}
        >
          <Pressable
            onPress={() => setScriptPickerOpen(false)}
            className="flex-1 items-center justify-center bg-background/80 p-4"
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl border border-border bg-card p-3"
            >
              <ScrollView style={{ maxHeight: 320 }}>
                <Pressable
                  onPress={() => {
                    onUpdate({ ...content, scriptId: undefined, webhookUrl: undefined });
                    setScriptPickerOpen(false);
                  }}
                  className="rounded-md px-3 py-2 active:bg-secondary"
                >
                  <Text className="text-sm text-foreground">
                    {t('payment.form.noScript') || 'Sin script de notificación'}
                  </Text>
                </Pressable>
                {webhookScripts.map((script) => (
                  <Pressable
                    key={script.id}
                    onPress={() => {
                      const publicToken = script.triggerConfig?.publicToken;
                      const webhookUrl = `${webhookBase}/w/${activeTeamId}/webhook/${script.id}/${publicToken}`;
                      onUpdate({ ...content, scriptId: script.id, webhookUrl });
                      setScriptPickerOpen(false);
                    }}
                    className="rounded-md px-3 py-2 active:bg-secondary"
                  >
                    <Text className="text-sm text-foreground">{script.name || script.id}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  // ── NOT CONFIGURED (editor only) ─────────────────────────────────────────────
  if (!isConfigured && canEdit) {
    return (
      <View className="items-center rounded-lg border border-dashed border-border bg-muted/10 p-6" style={{ gap: 12 }}>
        <CreditCard size={32} color={colors.mutedForeground} />
        <View className="items-center">
          <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
            {t('payment.notConfigured') || 'Pago no configurado'}
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {t('payment.notConfiguredHint') || 'Configura el monto y el proveedor para activar este brick.'}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setFormData({
              title: '',
              description: '',
              amount: 0,
              currency: 'USD',
              provider: 'stripe',
              connectionId: '',
              checkoutUrl: '',
            });
            setIsEditing(true);
          }}
          className="flex-row items-center rounded-md border border-border bg-card px-3 py-2"
        >
          <Settings size={14} color={colors.foreground} />
          <Text style={{ fontFamily: fonts.medium, marginLeft: 8 }} className="text-sm text-foreground">
            {t('payment.configure') || 'Configurar pago'}
          </Text>
        </Pressable>
      </View>
    );
  }

  // ── DISPLAY MODE ─────────────────────────────────────────────────────────────
  return (
    <View className="overflow-hidden rounded-lg border border-border bg-card">
      <View className="flex-row items-center justify-between bg-muted/40 px-4 py-3" style={{ gap: 8 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <CreditCard size={16} color={colors.mutedForeground} />
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {PROVIDER_LABELS[content.provider || 'stripe']}
          </Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ gap: 6 }}>
            <StatusIcon status={status} />
            <Text style={{ fontFamily: fonts.medium, color: currentStatus.color }} className="text-xs">
              {currentStatus.label}
            </Text>
          </View>
          {canEdit && (
            <Pressable
              onPress={() => {
                setFormData({
                  title: content.title || '',
                  description: content.description || '',
                  amount: content.amount || 0,
                  currency: content.currency || 'USD',
                  provider: content.provider || 'stripe',
                  connectionId: content.connectionId || '',
                  checkoutUrl: content.checkoutUrl || '',
                });
                setIsEditing(true);
              }}
              className="rounded-md p-1.5"
            >
              <Settings size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      <View className="p-5" style={{ gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.semibold }} className="text-lg text-foreground">
            {content.title || t('payment.untitled') || 'Pago'}
          </Text>
          {content.description ? (
            <Text className="text-sm text-muted-foreground">{content.description}</Text>
          ) : null}
        </View>

        <View className="items-center rounded-lg bg-muted/30 p-4">
          <Text className="mb-1 text-xs text-muted-foreground">{t('payment.amountLabel') || 'Total'}</Text>
          <Text style={{ fontFamily: fonts.bold }} className="text-4xl tracking-tight text-foreground">
            {formatAmount(content.amount || 0, content.currency || 'USD')}
          </Text>
        </View>

        {status === 'paid' && content.paidAt && (
          <View className="rounded-lg border border-border bg-success/10 p-3">
            <View className="flex-row items-start" style={{ gap: 8 }}>
              <CheckCircle2 size={16} color={colors.success} style={{ marginTop: 2 }} />
              <View>
                <Text style={{ fontFamily: fonts.medium }} className="text-sm text-success">
                  {t('payment.state.paidConfirmed') || 'Pago confirmado'}
                </Text>
                <Text className="text-xs text-success/80">
                  {new Date(content.paidAt).toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
                {content.payerEmail ? (
                  <Text className="mt-0.5 text-xs text-success/70">{content.payerEmail}</Text>
                ) : null}
              </View>
            </View>
          </View>
        )}

        {status === 'failed' && (
          <View className="rounded-lg border border-border bg-destructive/10 p-3">
            <View className="flex-row items-start" style={{ gap: 8 }}>
              <AlertCircle size={16} color={colors.destructive} style={{ marginTop: 2 }} />
              <View>
                <Text style={{ fontFamily: fonts.medium }} className="text-sm text-destructive">
                  {t('payment.state.failed') || 'Pago fallido'}
                </Text>
                <Text className="text-xs text-destructive/80">
                  {t('payment.state.failedRetry') || 'Puedes intentarlo de nuevo.'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {status === 'pending' && (
          <View style={{ gap: 8 }}>
            {checkoutUrl ? (
              <>
                {/* Mobile: iframe checkout → system browser via Linking */}
                <Pressable
                  onPress={() => Linking.openURL(checkoutUrl)}
                  className="h-11 w-full flex-row items-center justify-center rounded-lg bg-primary"
                  style={{ gap: 8 }}
                >
                  <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-primary-foreground">
                    {t('payment.payWithProvider', {
                      provider: PROVIDER_LABELS[content.provider || 'stripe'],
                    }) || `Pagar con ${PROVIDER_LABELS[content.provider || 'stripe']}`}
                  </Text>
                  <ExternalLink size={16} color={colors.primaryForeground} />
                </Pressable>
                <Pressable
                  onPress={handleCopyUrl}
                  className="h-10 w-full flex-row items-center justify-center rounded-lg border border-border"
                  style={{ gap: 8 }}
                >
                  <Copy size={14} color={colors.mutedForeground} />
                  <Text className="text-sm text-muted-foreground">
                    {isCopied
                      ? t('payment.copied') || 'Copiado'
                      : t('payment.copyLink') || 'Copiar enlace'}
                  </Text>
                </Pressable>
              </>
            ) : canEdit ? (
              <Text className="py-1 text-center text-xs text-muted-foreground">
                {t('payment.noCheckoutUrlHint') ||
                  'Genera un link de pago configurando las credenciales del proveedor.'}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
