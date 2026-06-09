import { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Screen, H1, Body, Button } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { CATALOG, type VaultIntegration } from '@/integrations/catalog';
import { IntegrationIcon } from '@/integrations/Icon';
import {
  getConnectedProviders,
  getConnectUrl,
  saveManualCredential,
} from '@/core/api/integrations.client';
import { requestPermission as requestCalendar } from '@/calendar/Calendar';
import { requestContacts, requestLocation } from '@/integrations/device';
import { getConnectedDeviceProviders } from '@/integrations/device-state';
import { getStatus as getWaStatus } from '@/core/api/whatsapp.client';
import { useTranslations } from '@/i18n';
import { colors, radius, spacing, typography } from '@/theme/theme';

export default function IntegrationsScreen() {
  const t = useTranslations('integrations');
  const router = useRouter();
  const { activeTeam } = useAuth();
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState<VaultIntegration | null>(null);

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      // Server-side OAuth/manual connectors + device-side permissions +
      // pair-based bridges (WhatsApp Personal).
      const [serverProviders, devProviders, wa] = await Promise.all([
        getConnectedProviders(activeTeam.id).catch(() => [] as string[]),
        getConnectedDeviceProviders(),
        getWaStatus(activeTeam.id).catch(() => ({ connected: false, phone: null })),
      ]);
      const pairProviders: string[] = [];
      if (wa.connected) pairProviders.push('whatsapp_personal');
      setConnected(new Set([...serverProviders, ...devProviders, ...pairProviders]));
    } catch {
      // keep previous
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const connectOAuth = async (it: VaultIntegration) => {
    if (!activeTeam?.id || !it.connectPath) return;
    try {
      const url = await getConnectUrl(activeTeam.id, it.connectPath);
      Alert.alert(it.name, t('connectInBrowser'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('connect'), onPress: () => void Linking.openURL(url) },
      ]);
    } catch {
      Alert.alert(it.name, t('error'));
    }
  };

  const connectDevice = async (it: VaultIntegration) => {
    // Permission-less device capabilities (e.g. Spotify: background search via
    // the backend Web API + play/transport via the device) need no connect
    // step — they just work. Acknowledge instead of running a permission flow.
    if (!it.devicePermission) {
      Alert.alert(it.name, t('saved'));
      return;
    }
    try {
      const granted =
        it.devicePermission === 'calendar'
          ? await requestCalendar()
          : it.devicePermission === 'contacts'
            ? await requestContacts()
            : it.devicePermission === 'location'
              ? await requestLocation()
              : false;
      Alert.alert(it.name, granted ? t('saved') : t('error'));
      if (granted) void load(); // refresh "Connected" badge immediately
    } catch {
      Alert.alert(it.name, t('error'));
    }
  };

  const onCardPress = (it: VaultIntegration) => {
    if (it.kind === 'oauth') return connectOAuth(it);
    if (it.kind === 'manual') return setManual(it);
    if (it.kind === 'device') return connectDevice(it);
    if (it.kind === 'pair' && it.id === 'whatsapp_personal') {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      router.push('/whatsapp-pair');
    }
  };

  const available = CATALOG.filter((i) => i.kind !== 'soon');
  const soon = CATALOG.filter((i) => i.kind === 'soon');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.foreground} />
        }
      >
        <H1>{t('title')}</H1>
        <Body muted>{t('subtitle')}</Body>

        <Text style={styles.section}>{t('available')}</Text>
        {available.map((it) => (
          <IntegrationCard
            key={it.id}
            it={it}
            connected={connected.has(it.provider)}
            connectLabel={connected.has(it.provider) ? t('connected') : t('connect')}
            onPress={() => onCardPress(it)}
          />
        ))}

        <Text style={styles.section}>{t('comingSoon')}</Text>
        {soon.map((it) => (
          <IntegrationCard key={it.id} it={it} soonLabel={t('soon')} disabled />
        ))}
      </ScrollView>

      <ManualModal
        integration={manual}
        teamId={activeTeam?.id}
        onClose={() => setManual(null)}
        onSaved={() => {
          setManual(null);
          void load();
          Alert.alert('', t('saved'));
        }}
        labels={{ save: t('save'), cancel: t('cancel'), error: t('error') }}
      />
    </Screen>
  );
}

function IntegrationCard({
  it,
  connected,
  connectLabel,
  soonLabel,
  disabled,
  onPress,
}: {
  it: VaultIntegration;
  connected?: boolean;
  connectLabel?: string;
  soonLabel?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={[styles.card, disabled && styles.cardDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.iconWrap, { backgroundColor: it.color + '22', borderColor: it.color + '55' }]}>
        <IntegrationIcon name={it.icon} color={it.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{it.name}</Text>
        <Text style={styles.cat}>{it.category}</Text>
      </View>
      {soonLabel ? (
        <Text style={styles.soon}>{soonLabel}</Text>
      ) : (
        <Text style={[styles.badge, connected && styles.badgeOn]}>{connectLabel}</Text>
      )}
    </Pressable>
  );
}

function ManualModal({
  integration,
  teamId,
  onClose,
  onSaved,
  labels,
}: {
  integration: VaultIntegration | null;
  teamId?: string;
  onClose: () => void;
  onSaved: () => void;
  labels: { save: string; cancel: string; error: string };
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!integration?.manualPath || !teamId) return;
    setBusy(true);
    try {
      await saveManualCredential(teamId, integration.manualPath, values);
      setValues({});
      onSaved();
    } catch {
      Alert.alert(integration.name, labels.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!integration} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
            {integration ? <IntegrationIcon name={integration.icon} color={integration.color} /> : null}
            <Text style={styles.modalTitle}>{integration?.name}</Text>
          </View>
          {integration?.manualFields?.map((f) => (
            <View key={f.key} style={{ gap: 4, marginBottom: spacing.sm }}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <TextInput
                style={styles.input}
                value={values[f.key] ?? ''}
                onChangeText={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                secureTextEntry={f.secret}
                autoCapitalize="none"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          ))}
          <Button title={labels.save} onPress={save} busy={busy} />
          <Button title={labels.cancel} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: {
    color: colors.mutedForeground,
    fontSize: typography.fontSize.sm,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardDisabled: { opacity: 0.55 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20 },
  name: { color: colors.foreground, fontSize: typography.fontSize.base, fontWeight: typography.weight.semibold },
  cat: { color: colors.mutedForeground, fontSize: typography.fontSize.xs, textTransform: 'capitalize' },
  badge: { color: colors.cyan, fontSize: typography.fontSize.sm, fontWeight: typography.weight.semibold },
  badgeOn: { color: colors.success },
  soon: { color: colors.mutedForeground, fontSize: typography.fontSize.xs },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  modalTitle: { color: colors.foreground, fontSize: typography.fontSize.lg, fontWeight: typography.weight.bold, marginBottom: spacing.md },
  fieldLabel: { color: colors.mutedForeground, fontSize: typography.fontSize.sm },
  input: {
    backgroundColor: colors.background,
    color: colors.foreground,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
  },
});
