import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLayoutEffect } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';

import { Screen, Button, Input, RichText, AgentMessage } from '@/ui';
import { Mic, Paperclip, X, SquarePen } from 'lucide-react-native';
import { fonts } from '@/theme/fonts';
import * as DocumentPicker from 'expo-document-picker';
import { uploadFile } from '@/core/api/uploads.client';
import { useAuth } from '@/core/auth/AuthContext';
import { useCapture } from '@/capture/CaptureContext';
import {
  streamAgentChat,
  getConversationMessages,
  type ClientActionEvent,
  type AgentChatBody,
} from '@/core/api/agent.client';
import { logConversation } from '@/core/api/vault.client';
import { runClientAction, NEEDS_CONFIRM } from '@/actions/ClientActions';
import { recognizeOnce, isAvailable as sttAvailable } from '@/stt/native/KillioSpeech';
import { recentTranscriptText } from '@/db/outbox';
import { speak, stopSpeaking } from '@/tts/Tts';
import { getAgent, type LocalAgent } from '@/agents/local-agent.model';
import { LocalAgentRuntime } from '@/agents/LocalAgentRuntime';
import { useTranslations } from '@/i18n';
import { colors, radius, spacing, typography } from '@/theme/theme';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export default function AssistantScreen() {
  const t = useTranslations('assistant');
  const tc = useTranslations('common');
  const tFallback = useTranslations('fallback');
  const navigation = useNavigation();
  const { activeTeam } = useAuth();
  const { setMuted, flushNow } = useCapture();
  const { agentId, conversationId, action } = useLocalSearchParams<{
    agentId?: string;
    conversationId?: string;
    /**
     * Set by the home-screen widgets + launcher shortcuts:
     *   - `voice`              → enter voice mode immediately (wake equivalent).
     *   - `screenshot_voice`   → capture screen, attach, then voice mode.
     *   - `chat`               → text-only (no auto-voice).
     */
    action?: string;
  }>();
  const [agent, setAgent] = useState<LocalAgent | null>(null);
  const runtime = useRef<LocalAgentRuntime | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [attachments, setAttachments] = useState<{ url: string; name: string; kind: 'img' | 'document' }[]>([]);
  const [uploading, setUploading] = useState(false);
  const convId = useRef<string | undefined>(undefined);
  const firstMsg = useRef<string>('');
  const lastUserMsg = useRef<string>('');
  const draftId = useRef<string>('');
  // Prior ~1 min of transcript captured when the user speaks (voice/wake), so
  // the agent has context of what was being said before the command.
  const recentCtx = useRef<string>('');
  // True when the pending turn was started by voice (push-to-talk) â†’ speak reply.
  const voiceTurn = useRef<boolean>(false);

  useEffect(() => {
    if (!agentId) return;
    const a = getAgent(agentId);
    if (a) {
      setAgent(a);
      runtime.current = new LocalAgentRuntime(a);
    }
  }, [agentId]);

  const newChat = () => {
    setMessages([]);
    setInput('');
    setAttachments([]);
    convId.current = undefined;
    firstMsg.current = '';
    lastUserMsg.current = '';
  };

  // GPT-style header: agent/Killio title + a "new chat" button on the right.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: agent?.name ?? tFallback('agent'),
      headerRight: () => (
        <Pressable onPress={newChat} hitSlop={12} style={{ paddingHorizontal: 6 }}>
          <SquarePen size={20} color={colors.foreground} />
        </Pressable>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, agent?.name]);

  // Resume an existing conversation from history.
  useEffect(() => {
    if (!conversationId) return;
    convId.current = conversationId;
    void getConversationMessages(conversationId)
      .then((rows) => {
        setMessages(
          rows.map((m) => ({ id: m.id, role: m.role, text: stripTags(m.content) })),
        );
        const firstUser = rows.find((m) => m.role === 'user');
        if (firstUser) firstMsg.current = stripTags(firstUser.content).slice(0, 60);
      })
      .catch(() => {});
  }, [conversationId]);

  const appendAssistantDelta = (text: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.id === draftId.current) {
        copy[copy.length - 1] = { ...last, text: last.text + text };
      } else {
        copy.push({ id: draftId.current, role: 'assistant', text });
      }
      return copy;
    });
  };

  const runTurn = async (
    message: string,
    opts: {
      clientActionResult?: AgentChatBody['clientActionResult'];
      remember?: boolean;
      userTurn?: boolean;
      speakReply?: boolean;
    } = {},
  ) => {
    if (!activeTeam?.id) return;
    setBusy(true);
    draftId.current = `a-${Date.now()}`;
    let finalText = '';
    const toolInputById = new Map<string, { tool: string; input: unknown }>();
    await streamAgentChat(
      {
        teamId: activeTeam.id,
        message,
        conversationId: convId.current,
        entityType: 'vault',
        clientActionResult: opts.clientActionResult,
      },
      {
        onDelta: (t) => {
          finalText += t;
          appendAssistantDelta(t);
        },
        onToolStart: (e) => {
          const id = e.id ?? `tc-${toolInputById.size}`;
          toolInputById.set(id, { tool: e.tool, input: e.input });
          // Synthesize inline markup so AgentMessage renders a live tool chip.
          const invoke = `\n<invoke id="${id}" name="${e.tool}"><parameters>${
            renderParams(e.input)
          }</parameters></invoke>\n<tool_status id="${id}" status="running" />`;
          finalText += invoke;
          appendAssistantDelta(invoke);
        },
        onToolDone: (e) => {
          const id = e.id ?? findIdFor(e.tool, toolInputById);
          if (!id) return;
          const tag = `\n<tool_status id="${id}" status="done" success="${e.success}" />`;
          finalText += tag;
          appendAssistantDelta(tag);
        },
        onClientAction: (e) => void handleClientAction(e),
        onDone: ({ conversationId: cid }) => {
          convId.current = cid;
          setBusy(false);
          if (finalText.trim()) {
            if (opts.remember && runtime.current) {
              void runtime.current.remember(lastUserMsg.current, finalText);
            }
            // Mirror the exchange to the rooms "Vault" group (history).
            if (opts.userTurn && activeTeam?.id && cid) {
              void logConversation({
                teamId: activeTeam.id,
                conversationId: cid,
                title: firstMsg.current || lastUserMsg.current,
                userText: lastUserMsg.current,
                assistantText: finalText,
              });
            }
            // Speak ONLY for voice-initiated turns (push-to-talk / wake), not
            // typed messages.
            if (opts.speakReply) {
              setMuted(true);
              void speak(finalText, {
                language: agent?.voice ?? 'es-ES',
                onFinish: () => setMuted(false),
              });
            }
          }
        },
        onError: (m) => {
          setBusy(false);
          appendAssistantDelta(`\n[error: ${m}]`);
        },
      },
    );
  };

  const handleClientAction = async (e: ClientActionEvent) => {
    const resumeWith = (result: AgentChatBody['clientActionResult']) =>
      runTurn('(continÃºa)', { clientActionResult: result });

    // vault_disconnect: AI explicitly ends the voice conversation. Silence the
    // assistant, clear voice state, and stop the turn. Background wake listener
    // keeps running and will pick up the next "Hey Killio".
    if (e.tool === 'vault_disconnect') {
      try {
        stopSpeaking();
      } catch {
        /* ignore */
      }
      setMuted(false);
      voiceTurn.current = false;
      await resumeWith({ id: e.id, tool: e.tool, success: true, output: { disconnected: true } });
      return;
    }

    const execute = async () => {
      const result = await runClientAction(e.tool, e.input);
      // The AI can opt into ending the conversation when a tool naturally
      // closes the chat (e.g. call_number, spotify_play). Mirror what
      // vault_disconnect does: silence TTS, drop voice mode, then resume the
      // turn so the agent loop can wrap up cleanly. Background wake-word
      // listener stays running for the next "Hey Killio".
      if (result.endConversation) {
        try {
          stopSpeaking();
        } catch {
          /* ignore */
        }
        setMuted(false);
        voiceTurn.current = false;
      }
      await resumeWith({
        id: e.id,
        tool: e.tool,
        success: result.success,
        output: result.output,
        error: result.error,
      });
    };

    if (NEEDS_CONFIRM.has(e.tool)) {
      Alert.alert(
        t('confirmTitle'),
        describeAction(e, t),
        [
          {
            text: tc('cancel'),
            style: 'cancel',
            onPress: () =>
              void resumeWith({
                id: e.id,
                tool: e.tool,
                success: false,
                error: tFallback('userCancelledAction'),
              }),
          },
          { text: t('allow'), onPress: () => void execute() },
        ],
        { cancelable: false },
      );
    } else {
      await execute();
    }
  };

  // Pick + upload a file/image attachment (embedded as an <asset> tag on send).
  const pickAttachment = async () => {
    if (!activeTeam?.id || uploading) return;
    const res = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf', 'text/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const up = await uploadFile({
        uri: a.uri,
        name: a.name ?? 'file',
        type: a.mimeType ?? 'application/octet-stream',
        ownerScopeType: 'team',
        ownerScopeId: activeTeam.id,
        usage: 'chat_attachment',
      });
      const url = String(up.url ?? '');
      if (url) {
        const kind = (a.mimeType ?? '').startsWith('image/') ? 'img' : 'document';
        setAttachments((prev) => [...prev, { url, name: a.name ?? 'file', kind }]);
      }
    } catch {
      // ignore â€” user can retry
    } finally {
      setUploading(false);
    }
  };

  const buildAssetTags = (): string =>
    attachments
      .map((att) =>
        att.kind === 'img'
          ? `<asset type="img" src="${att.url}" />`
          : `<asset type="document" src="${att.url}" title="${att.name}" />`,
      )
      .join('\n');

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    const assetTags = buildAssetTags();
    const displayText = text + (assetTags ? `\n${assetTags}` : '');
    lastUserMsg.current = text;
    if (!firstMsg.current) firstMsg.current = (text || tFallback('attachment')).slice(0, 60);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: displayText }]);
    setInput('');
    setAttachments([]);
    try {
      await flushNow();
    } catch {
      // offline â€” agent still answers from what's already on the server
    }
    const base = runtime.current ? await runtime.current.composeMessage(text || '(adjunto)') : text;
    const ctx = recentCtx.current
      ? `Contexto reciente (Ãºltimo minuto de lo que el usuario decÃ­a): "${recentCtx.current}"\n\n`
      : '';
    recentCtx.current = '';
    const speakReply = voiceTurn.current;
    voiceTurn.current = false;
    const toSend = ctx + base + (assetTags ? `\n\n${assetTags}` : '');
    await runTurn(toSend, { remember: !!runtime.current, userTurn: true, speakReply });
  };

  // ── Widget / launcher-shortcut entry actions ────────────────────────────
  // Triggered when the user opens the assistant via:
  //   - `killiovault://assistant?action=voice`             (Hey Killio widget / shortcut)
  //   - `killiovault://assistant?action=screenshot_voice`  (Screenshot+ask widget)
  //   - `killiovault://assistant?action=chat`              (Ask Killio widget — no-op)
  // The effect is guarded by a one-shot ref so re-renders don't replay it.
  const actionFired = useRef(false);
  useEffect(() => {
    if (actionFired.current) return;
    if (!action) return;
    actionFired.current = true;

    (async () => {
      if (action === 'voice') {
        // Defer one tick so the screen mounts before the mic prompt appears.
        setTimeout(() => void micPress(), 250);
        return;
      }
      if (action === 'screenshot_voice') {
        try {
          // Lazy require so Expo Go (where ScreenCapture is a no-op anyway)
          // doesn't pay the bundle cost on unrelated screens.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const screen = require('@/screen/ScreenCapture') as typeof import('@/screen/ScreenCapture');
          if (!screen.isAvailable()) {
            setTimeout(() => void micPress(), 250);
            return;
          }
          const ok = await screen.requestPermission();
          if (!ok) return;
          const shot = await screen.capture();
          if (shot) {
            // Use the local file URI directly as the attachment — the chat
            // upload pipeline accepts on-device URIs and re-uploads them
            // through the asset multimodal path.
            setAttachments((prev) => [
              ...prev,
              { url: shot.uri, name: `screenshot-${shot.ts}.png`, kind: 'img' },
            ]);
          }
          setTimeout(() => void micPress(), 250);
        } catch {
          /* ignore — user can re-trigger via UI */
        }
      }
      // action === 'chat' → no auto-action.
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  // Push-to-talk: one-shot native recognition â†’ fills the input.
  const micPress = async () => {
    if (busy || listening) return;
    if (!sttAvailable()) {
      setInput((v) => v); // no-op in Expo Go; PTT needs the dev-build
      return;
    }
    setListening(true);
    try {
      const text = await recognizeOnce(agent?.voice === 'cartesia' ? 'es-ES' : agent?.voice ?? 'es-ES');
      if (text.trim()) {
        setInput(text.trim());
        recentCtx.current = recentTranscriptText(60_000); // last minute of diary
        voiceTurn.current = true; // voice â†’ speak the reply
      }
    } catch {
      // ignore â€” user can type
    } finally {
      setListening(false);
    }
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerClassName="p-4 gap-3 flex-grow"
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center gap-4 px-6 py-16">
            <Image
              source={require('../assets/killio_white.webp')}
              style={{ width: 64, height: 64, resizeMode: 'contain', opacity: 0.9 }}
            />
            <Text style={{ fontFamily: fonts.bold }} className="text-xl text-foreground">
              {t('greeting')}
            </Text>
            <Text className="text-center text-sm text-muted-foreground">{t('greetingSub')}</Text>
            <View className="mt-2 w-full gap-2">
              {[t('s1'), t('s2'), t('s3')].map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => setInput(s)}
                  className="rounded-xl border border-border bg-card px-4 py-3 active:opacity-80"
                >
                  <Text className="text-sm text-foreground">{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) =>
          item.role === 'user' ? (
            <View className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5">
              <RichText content={item.text} />
            </View>
          ) : (
            <View className="self-start max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5">
              <AgentMessage content={item.text} />
            </View>
          )
        }
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {attachments.length > 0 ? (
          <View className="flex-row flex-wrap gap-2 border-t border-border bg-background px-4 pt-3">
            {attachments.map((att, i) => (
              <View key={i} className="flex-row items-center gap-1.5 rounded-lg border border-border bg-secondary py-1.5 pl-2.5 pr-1.5">
                <Paperclip size={13} color={colors.mutedForeground} />
                <Text className="max-w-[140px] text-xs text-foreground" numberOfLines={1}>{att.name}</Text>
                <Pressable hitSlop={8} onPress={() => setAttachments((p) => p.filter((_, j) => j !== i))}>
                  <X size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-center gap-2 border-t border-border bg-background px-4 py-3">
          <Pressable
            onPress={pickAttachment}
            className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-80"
          >
            <Paperclip size={18} color={uploading ? colors.cyan : colors.foreground} />
          </Pressable>
          <Pressable
            onPress={micPress}
            className={`h-11 w-11 items-center justify-center rounded-full ${listening ? 'bg-destructive' : 'bg-secondary'}`}
          >
            <Mic size={18} color={colors.foreground} />
          </Pressable>
          <View className="flex-1">
            <Input
              placeholder={listening ? t('listening') : t('placeholder')}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
            />
          </View>
          <Button title={tc('send')} onPress={send} busy={busy} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Strips the inline <invoke>/<tool_*> agent tags for clean history display. */
function stripTags(s: string): string {
  return (s || '')
    .replace(/<tool_output\b[^>]*>[\s\S]*?<\/tool_output>/g, '')
    .replace(/<tool_status\b[^>]*\/?>/g, '')
    .replace(/<invoke\b[\s\S]*?<\/invoke>/g, '')
    .replace(/<batch_invoke>[\s\S]*?<\/batch_invoke>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function renderParams(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `<${k}>${typeof v === 'string' ? v : JSON.stringify(v)}</${k}>`)
    .join('');
}

function findIdFor(
  tool: string,
  map: Map<string, { tool: string; input: unknown }>,
): string | undefined {
  for (const [id, v] of map) if (v.tool === tool) return id;
  return undefined;
}

function describeAction(
  e: ClientActionEvent,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  if (e.tool === 'call_number') return t('call', { target: String(e.input.number ?? '') });
  if (e.tool === 'open_app')
    return t('openApp', { target: String(e.input.package ?? e.input.url ?? '') });
  if (e.tool === 'calendar_create_event')
    return t('createEvent', { target: String(e.input.title ?? '') });
  if (e.tool === 'send_sms')
    return t('sendSms', {
      target: String(
        (e.input.numbers as string[])?.join(', ') ?? e.input.number ?? '',
      ),
    });
  return t('genericAction');
}

const styles = StyleSheet.create({
  bubble: { borderRadius: radius.lg, padding: spacing.md, maxWidth: '85%' },
  user: { alignSelf: 'flex-end', backgroundColor: colors.surfaceAlt },
  assistant: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.foreground, fontSize: typography.fontSize.base, lineHeight: 21 },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingTop: spacing.sm },
  mic: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: { backgroundColor: colors.destructive },
  micIcon: { fontSize: 18, color: colors.foreground },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.foreground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.fontSize.base,
  },
});
