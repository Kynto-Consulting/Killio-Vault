import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Screen, Card, H1, Body, Button } from '@/ui';
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  type LocalAgent,
} from '@/agents/local-agent.model';
import { useEntitlements } from '@/settings/useEntitlements';
import { useAuth } from '@/core/auth/AuthContext';
import { listDocuments, type DocSummary } from '@/core/api/documents.client';
import { isCustomVoiceAvailable } from '@/tts/cartesia';
import { speak } from '@/tts/Tts';
import { useTranslations } from '@/i18n';
import { colors, radius, spacing, typography } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/** Voice presets — labels are looked up via i18n at render time so the picker
 *  renders in the user's current locale. */
const VOICE_PRESETS = [
  { value: 'es-ES', labelKey: 'langEs' },
  { value: 'en-US', labelKey: 'langEn' },
] as const;

interface Draft {
  id?: string;
  name: string;
  personality: string;
  systemPrompt: string;
  voice: string;
  wakePhrase: string;
  assignedDocIds: string[];
}

const EMPTY: Draft = {
  name: '',
  personality: '',
  systemPrompt: '',
  voice: 'es-ES',
  wakePhrase: '',
  assignedDocIds: [],
};

export default function AgentsScreen() {
  const router = useRouter();
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const tAgents = useTranslations('agentsScreen');
  const { entitlements } = useEntitlements();
  const { activeTeam } = useAuth();
  const [agents, setAgents] = useState<LocalAgent[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [customVoice, setCustomVoice] = useState(false);

  const refresh = () => setAgents(listAgents());
  useEffect(refresh, []);

  useEffect(() => {
    void isCustomVoiceAvailable().then(setCustomVoice);
  }, []);

  // Load workspace documents (for assignment) when the editor opens.
  useEffect(() => {
    if (!draft || !activeTeam?.id) return;
    void listDocuments(activeTeam.id)
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [draft, activeTeam?.id]);

  const openCreate = () => {
    const limit = entitlements.policy.localAgents;
    if (limit !== null && agents.length >= limit) {
      Alert.alert(
        t('limitTitle'),
        t('limitBody', { tier: entitlements.tier, limit }),
      );
      return;
    }
    setDraft({ ...EMPTY });
  };

  const openEdit = (a: LocalAgent) =>
    setDraft({
      id: a.id,
      name: a.name,
      personality: a.personality,
      systemPrompt: a.systemPrompt,
      voice: a.voice ?? 'es-ES',
      wakePhrase: a.wakePhrase ?? '',
      assignedDocIds: a.assignedDocIds,
    });

  const save = () => {
    if (!draft?.name.trim()) return;
    if (draft.id) {
      updateAgent(draft.id, {
        name: draft.name.trim(),
        personality: draft.personality.trim(),
        systemPrompt: draft.systemPrompt.trim(),
        voice: draft.voice.trim() || null,
        wakePhrase: draft.wakePhrase.trim() || null,
        assignedDocIds: draft.assignedDocIds,
      });
    } else {
      createAgent({
        name: draft.name.trim(),
        personality: draft.personality.trim(),
        systemPrompt: draft.systemPrompt.trim(),
        voice: draft.voice.trim() || undefined,
        wakePhrase: draft.wakePhrase.trim() || undefined,
        assignedDocIds: draft.assignedDocIds,
      });
    }
    setDraft(null);
    refresh();
  };

  const remove = (a: LocalAgent) => {
    Alert.alert(t('deleteTitle'), t('deleteBody', { name: a.name }), [
      { text: tc('cancel'), style: 'cancel' },
      {
        text: tc('delete'),
        style: 'destructive',
        onPress: () => {
          deleteAgent(a.id);
          refresh();
        },
      },
    ]);
  };

  const toggleDoc = (id: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            assignedDocIds: d.assignedDocIds.includes(id)
              ? d.assignedDocIds.filter((x) => x !== id)
              : [...d.assignedDocIds, id],
          }
        : d,
    );

  if (draft) {
    return (
      <Screen scroll>
        <H1>{draft.id ? t('editTitle') : t('createTitle')}</H1>
        <Field label={t('name')} value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
        <Field label={t('personality')} value={draft.personality} onChange={(v) => setDraft({ ...draft, personality: v })} multiline />
        <Field label={t('systemPrompt')} value={draft.systemPrompt} onChange={(v) => setDraft({ ...draft, systemPrompt: v })} multiline tall />
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>{t('voice')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {VOICE_PRESETS.map((v) => {
              const on = draft.voice === v.value;
              return (
                <Pressable
                  key={v.value}
                  onPress={() => setDraft({ ...draft, voice: v.value })}
                  style={[styles.voiceChip, on && styles.voiceChipOn]}
                >
                  <Text style={[styles.voiceChipText, on && styles.voiceChipTextOn]}>{tAgents(v.labelKey)}</Text>
                </Pressable>
              );
            })}
            {customVoice ? (
              <Pressable
                onPress={() => setDraft({ ...draft, voice: 'cartesia' })}
                style={[styles.voiceChip, draft.voice === 'cartesia' && styles.voiceChipOn]}
              >
                <Text style={[styles.voiceChipText, draft.voice === 'cartesia' && styles.voiceChipTextOn]}>
                  {t('customVoice')}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() =>
                void speak(`Hola, soy ${draft.name || 'Killio'}. ${draft.personality || ''}`.trim(), {
                  language: draft.voice ?? 'es-ES',
                })
              }
              style={styles.voiceChip}
            >
              <Text style={styles.voiceChipText}>🔊 {tAgents('testVoice')}</Text>
            </Pressable>
          </View>
        </View>
        <Field label={t('wakePhrase')} value={draft.wakePhrase} onChange={(v) => setDraft({ ...draft, wakePhrase: v })} />

        <Card>
          <Body>{t('assignedDocs')}</Body>
          <Body muted>{t('assignedDocsHint')}</Body>
          {docs.length === 0 ? (
            <Body muted>{t('noDocs')}</Body>
          ) : (
            docs.map((d) => {
              const on = draft.assignedDocIds.includes(d.id);
              return (
                <Pressable key={d.id} style={styles.docRow} onPress={() => toggleDoc(d.id)}>
                  <Text style={[styles.check, on && styles.checkOn]}>{on ? 'â˜‘' : 'â˜'}</Text>
                  <Text style={styles.docTitle} numberOfLines={1}>{d.title || tAgents('untitled')}</Text>
                </Pressable>
              );
            })
          )}
        </Card>

        <Button title={draft.id ? t('saveChanges') : t('create')} onPress={save} />
        <Button title={tc('cancel')} variant="secondary" onPress={() => setDraft(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>{t('title')}</H1>
      <Body muted>{t('subtitle')}</Body>

      <Button title={t('new')} onPress={openCreate} />

      <FlatList
        style={{ marginTop: spacing.md }}
        data={agents}
        keyExtractor={(a) => a.id}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={<Body muted>{t('empty')}</Body>}
        renderItem={({ item }) => (
          <View style={styles.agent}>
            <Pressable onPress={() => router.push({ pathname: '/assistant', params: { agentId: item.id } })}>
              <Text style={styles.agentName}>{item.name}</Text>
              {item.personality ? <Text style={styles.agentMeta} numberOfLines={1}>{item.personality}</Text> : null}
              <Text style={styles.agentMeta}>
                {item.assignedDocIds.length} doc Â· voz {item.voice ?? 'es-ES'}
                {item.wakePhrase ? ` · "${tAgents('wakeHey')} ${item.wakePhrase}"` : ''}
              </Text>
            </Pressable>
            <View style={styles.agentActions}>
              <Pressable onPress={() => openEdit(item)}><Text style={styles.action}>{tc('edit')}</Text></Pressable>
              <Pressable onPress={() => remove(item)}><Text style={[styles.action, styles.danger]}>{tc('delete')}</Text></Pressable>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  tall,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  tall?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, tall && { minHeight: 90 }]}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.mutedForeground, fontSize: typography.fontSize.sm },
  voiceChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  voiceChipOn: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  voiceChipText: { color: colors.foreground, fontSize: typography.fontSize.sm, fontFamily: fonts.medium },
  voiceChipTextOn: { color: colors.primaryForeground, fontFamily: fonts.semibold },
  input: {
    backgroundColor: colors.surface,
    color: colors.foreground,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
  },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  check: { color: colors.mutedForeground, fontSize: 18 },
  checkOn: { color: colors.lime },
  docTitle: { color: colors.foreground, fontSize: typography.fontSize.base, flex: 1 },
  agent: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  agentName: { color: colors.foreground, fontSize: typography.fontSize.lg, fontWeight: typography.weight.semibold },
  agentMeta: { color: colors.mutedForeground, fontSize: typography.fontSize.sm },
  agentActions: { flexDirection: 'row', gap: spacing.lg },
  action: { color: colors.foreground, fontSize: typography.fontSize.sm, fontWeight: typography.weight.medium },
  danger: { color: colors.destructive },
});
