import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Bot, Clock, History, Send, Sparkles, X } from 'lucide-react-native';

import { RichText } from '@/ui/RichText';
import { useTranslations } from '@/i18n';
import {
  getConversationMessages,
  listConversations,
  streamAgentChat,
  type AgentStreamHandle,
  type ConversationMessage,
  type ConversationSummary,
} from '@/core/api/agent.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * CopilotPanel — entity-scoped AI chat with persisted history.
 *
 * Drop-in panel used by both the document and the card sidebars. Streams
 * each turn against `POST /agent/chat/stream` with the entity context so
 * the backend can include the brick contents / card body in the system
 * prompt, then resumes the conversation on tab focus via
 * `listConversations` + `getConversationMessages` (the same store the
 * `/assistant` tab uses).
 *
 * Slash commands open a quick action sheet — picking one drops a curated
 * prompt into the input. The mapping mirrors the web's slash-commands set
 * for the agent UI: summarize / translate / explain / outline / actions
 * (docs); summarize / breakdown / estimate / risks (cards).
 */
export type CopilotEntity = 'document' | 'card';

export interface CopilotPanelProps {
  teamId: string;
  entityType: CopilotEntity;
  entityId: string;
  /** i18n namespace — `docCopilot` for documents, `cardCopilot` for cards. */
  namespace?: 'docCopilot' | 'cardCopilot';
}

interface UiMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}

export function CopilotPanel({ teamId, entityType, entityId, namespace = 'docCopilot' }: CopilotPanelProps) {
  const t = useTranslations(namespace);
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // The conversationId is sticky across turns so the backend keeps the same
  // memory window. Picked from the most recent matching conversation in
  // history (entity-scoped), then re-used on every turn.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const streamRef = useRef<AgentStreamHandle | null>(null);
  const listRef = useRef<FlatList<UiMsg>>(null);

  // Resume the most recent conversation for this entity on mount. Mirrors
  // the web's behaviour: opening the copilot tab on a doc you already chatted
  // about should pick up where you left off, not start fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const convs = await listConversations(teamId);
        if (cancelled || convs.length === 0) return;
        // Pick the most-recently-updated conversation that mentions the entity
        // in its preview/title; fall back to the most recent. The backend may
        // tag conversations with entityType/Id (web does), so we honour that
        // when present.
        const tagged = convs.find((c: any) => c.entityType === entityType && c.entityId === entityId);
        const target = tagged ?? convs[0];
        if (!target?.id) return;
        const past = await getConversationMessages(target.id);
        if (cancelled) return;
        setConversationId(target.id);
        setMessages(
          past.map((m: ConversationMessage) => ({ id: m.id, role: m.role, text: m.content })),
        );
      } catch {
        /* offline / no history — start fresh */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, entityType, entityId]);

  // Mobile: cancel any inflight stream on unmount so EventSource doesn't
  // keep the socket alive after the user backs out.
  useEffect(() => () => streamRef.current?.close(), []);

  const send = useCallback(
    async (prompt?: string) => {
      const text = (prompt ?? input).trim();
      if (!text || busy) return;
      setInput('');
      const userMsg: UiMsg = { id: `u-${Date.now()}`, role: 'user', text };
      const assistantId = `a-${Date.now()}`;
      setMessages((m) => [...m, userMsg, { id: assistantId, role: 'assistant', text: '', pending: true }]);
      setBusy(true);
      // Mobile: scroll-to-end after a tick so FlatList sees the new rows.
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      let acc = '';
      streamRef.current = await streamAgentChat(
        {
          teamId,
          message: text,
          conversationId: conversationId ?? undefined,
          entityType,
          entityId,
        },
        {
          onDelta: (chunk) => {
            acc += chunk;
            setMessages((m) =>
              m.map((x) => (x.id === assistantId ? { ...x, text: acc, pending: false } : x)),
            );
          },
          onDone: (e) => {
            setBusy(false);
            // Sticky conversation id so the next turn resumes the same thread.
            if (e?.conversationId) setConversationId(e.conversationId);
          },
          onError: (msg) => {
            setMessages((m) =>
              m.map((x) =>
                x.id === assistantId ? { ...x, text: msg || 'Error', pending: false } : x,
              ),
            );
            setBusy(false);
          },
        },
      );
    },
    [busy, input, teamId, entityType, entityId, conversationId],
  );

  const newConversation = useCallback(() => {
    streamRef.current?.close();
    setMessages([]);
    setConversationId(null);
    setInput('');
    setBusy(false);
  }, []);

  // The slash command map is intentionally light — picking one drops a
  // curated prompt into the input. Users can edit before pressing send.
  const slashCommands = useMemo(() => {
    if (entityType === 'document') {
      return [
        { id: 'summarize', label: t('slash.summarize'), desc: t('slash.summarizeDesc'), prompt: '/summarize ' },
        { id: 'translate', label: t('slash.translate'), desc: t('slash.translateDesc'), prompt: '/translate ' },
        { id: 'explain', label: t('slash.explain'), desc: t('slash.explainDesc'), prompt: '/explain ' },
        { id: 'outline', label: t('slash.outline'), desc: t('slash.outlineDesc'), prompt: '/outline ' },
        { id: 'action', label: t('slash.action'), desc: t('slash.actionDesc'), prompt: '/actions ' },
      ];
    }
    return [
      { id: 'summarize', label: t('slash.summarize'), desc: t('slash.summarizeDesc'), prompt: '/summarize ' },
      { id: 'breakdown', label: t('slash.breakdown'), desc: t('slash.breakdownDesc'), prompt: '/subtasks ' },
      { id: 'estimate', label: t('slash.estimate'), desc: t('slash.estimateDesc'), prompt: '/estimate ' },
      { id: 'risks', label: t('slash.risks'), desc: t('slash.risksDesc'), prompt: '/risks ' },
    ];
  }, [entityType, t]);

  return (
    <View style={{ flex: 1 }}>
      <View className="flex-row items-center justify-between border-b border-border/30 px-3 py-1.5">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          {t('title')}
        </Text>
        <View className="flex-row items-center gap-1">
          {/* Mobile: tap-friendly header buttons — history + new convo. */}
          <Pressable
            onPress={() => setHistoryOpen(true)}
            hitSlop={6}
            accessibilityLabel={t('historyTitle' as any)}
            className="rounded-md p-1"
          >
            <Clock size={13} color={colors.mutedForeground} />
          </Pressable>
          {messages.length > 0 ? (
            <Pressable
              onPress={newConversation}
              hitSlop={6}
              accessibilityLabel={t('newConversation' as any)}
              className="rounded-md p-1"
            >
              <X size={13} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerClassName="p-3 gap-2"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View className="items-center justify-center gap-2 py-10 opacity-60">
            <Bot size={24} color={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">{t('empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            className={`max-w-[88%] rounded-xl px-3 py-2 ${
              item.role === 'user'
                ? 'bg-cyan/10 border border-cyan/30 self-end'
                : 'bg-secondary border border-border/40 self-start'
            }`}
          >
            {/* RichText renders markdown + @mentions consistently with the
                rest of the app, so the assistant's responses can include
                links to docs/cards/users and they'll resolve. */}
            <RichText content={item.text} size={13} />
            {item.pending ? (
              <View className="mt-1 flex-row items-center gap-1.5 opacity-60">
                <ActivityIndicator color={colors.cyan} size="small" />
                <Text className="text-[10px] text-muted-foreground">{t('thinking')}</Text>
              </View>
            ) : null}
          </View>
        )}
      />

      {/* Composer row — slash menu trigger + input + send. */}
      <View className="border-t border-border/30 p-2 gap-1">
        {slashOpen ? (
          <View className="rounded-xl border border-border bg-background p-2 gap-1">
            {slashCommands.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  setSlashOpen(false);
                  setInput(c.prompt);
                }}
                className="flex-row items-center gap-2 rounded-md px-2 py-2"
              >
                <Sparkles size={12} color={colors.cyan} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="text-xs text-foreground"
                  >
                    {c.label}
                  </Text>
                  <Text className="text-[10px] text-muted-foreground">{c.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-end gap-1">
          <Pressable
            onPress={() => setSlashOpen((v) => !v)}
            hitSlop={6}
            className="rounded-md border border-border bg-background p-2"
          >
            <Sparkles size={14} color={colors.cyan} />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t('placeholder')}
            placeholderTextColor={colors.mutedForeground}
            style={{ fontFamily: fonts.regular, color: colors.foreground }}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            multiline
          />
          <Pressable
            onPress={() => void send()}
            disabled={busy || !input.trim()}
            className={`rounded-md p-2 ${busy || !input.trim() ? 'bg-secondary' : 'bg-cyan'}`}
          >
            <Send
              size={14}
              color={!input.trim() || busy ? colors.mutedForeground : colors.background}
            />
          </Pressable>
        </View>
      </View>

      {historyOpen ? (
        <HistoryModal
          teamId={teamId}
          entityType={entityType}
          entityId={entityId}
          onClose={() => setHistoryOpen(false)}
          onPick={async (conv) => {
            setHistoryOpen(false);
            try {
              const past = await getConversationMessages(conv.id);
              setConversationId(conv.id);
              setMessages(
                past.map((m) => ({ id: m.id, role: m.role, text: m.content })),
              );
            } catch {
              /* swallow — keep current conversation */
            }
          }}
          t={t}
        />
      ) : null}
    </View>
  );
}

// ─── History modal ──────────────────────────────────────────────────────────

function HistoryModal({
  teamId,
  entityType,
  entityId,
  onClose,
  onPick,
  t,
}: {
  teamId: string;
  entityType: CopilotEntity;
  entityId: string;
  onClose(): void;
  onPick(conv: ConversationSummary): void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listConversations(teamId);
        if (cancelled) return;
        // Bias toward conversations tagged to this entity, but show all so
        // users can carry a general convo into the entity panel.
        const ordered = [
          ...all.filter((c: any) => c.entityType === entityType && c.entityId === entityId),
          ...all.filter((c: any) => !(c.entityType === entityType && c.entityId === entityId)),
        ];
        setItems(ordered);
      } catch {
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, entityType, entityId]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background/80">
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        <View className="max-h-[70%] rounded-t-2xl border-t border-border bg-card p-3 gap-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <History size={13} color={colors.foreground} />
              <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
                {t('historyTitle')}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.cyan} />
          ) : items.length === 0 ? (
            <Text className="py-6 text-center text-xs text-muted-foreground">
              {t('empty')}
            </Text>
          ) : (
            <ScrollView>
              {items.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => onPick(c)}
                  className="rounded-md border border-border/30 bg-background p-2 mb-1"
                >
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="text-xs text-foreground"
                    numberOfLines={1}
                  >
                    {(c as any).title ?? c.preview ?? c.id.slice(0, 6)}
                  </Text>
                  {c.preview ? (
                    <Text className="text-[10px] text-muted-foreground" numberOfLines={2}>
                      {c.preview}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
