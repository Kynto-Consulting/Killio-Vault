import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Screen, Button, Input, RichText } from '@/ui';
import { Mic, Paperclip, X } from 'lucide-react-native';
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
import { speak } from '@/tts/Tts';
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
  const { personalTeam } = useAuth();
  const { setMuted, flushNow } = useCapture();
  const { agentId, conversationId } = useLocalSearchParams<{
    agentId?: string;
    conversationId?: string;
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

  useEffect(() => {
    if (!agentId) return;
    const a = getAgent(agentId);
    if (a) {
      setAgent(a);
      runtime.current = new LocalAgentRuntime(a);
    }
  }, [agentId]);

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
    } = {},
  ) => {
    if (!personalTeam?.id) return;
    setBusy(true);
    draftId.current = `a-${Date.now()}`;
    let finalText = '';
    await streamAgentChat(
      {
        teamId: personalTeam.id,
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
        onClientAction: (e) => void handleClientAction(e),
        onDone: ({ conversationId: cid }) => {
          convId.current = cid;
          setBusy(false);
          if (finalText.trim()) {
            if (opts.remember && runtime.current) {
              void runtime.current.remember(lastUserMsg.current, finalText);
            }
            // Mirror the exchange to the rooms "Vault" group (history).
            if (opts.userTurn && personalTeam?.id && cid) {
              void logConversation({
                teamId: personalTeam.id,
                conversationId: cid,
                title: firstMsg.current || lastUserMsg.current,
                userText: lastUserMsg.current,
                assistantText: finalText,
              });
            }
            setMuted(true);
            void speak(finalText, {
              language: agent?.voice ?? 'es-ES',
              onFinish: () => setMuted(false),
            });
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
      runTurn('(continúa)', { clientActionResult: result });

    const execute = async () => {
      const result = await runClientAction(e.tool, e.input);
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
                error: 'User cancelled the action.',
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
    if (!personalTeam?.id || uploading) return;
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
        ownerScopeId: personalTeam.id,
        usage: 'chat_attachment',
      });
      const url = String(up.url ?? '');
      if (url) {
        const kind = (a.mimeType ?? '').startsWith('image/') ? 'img' : 'document';
        setAttachments((prev) => [...prev, { url, name: a.name ?? 'file', kind }]);
      }
    } catch {
      // ignore — user can retry
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
    if (!firstMsg.current) firstMsg.current = (text || 'Adjunto').slice(0, 60);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: displayText }]);
    setInput('');
    setAttachments([]);
    try {
      await flushNow();
    } catch {
      // offline — agent still answers from what's already on the server
    }
    const base = runtime.current ? await runtime.current.composeMessage(text || '(adjunto)') : text;
    const ctx = recentCtx.current
      ? `Contexto reciente (último minuto de lo que el usuario decía): "${recentCtx.current}"\n\n`
      : '';
    recentCtx.current = '';
    const toSend = ctx + base + (assetTags ? `\n\n${assetTags}` : '');
    await runTurn(toSend, { remember: !!runtime.current, userTurn: true });
  };

  // Push-to-talk: one-shot native recognition → fills the input.
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
      }
    } catch {
      // ignore — user can type
    } finally {
      setListening(false);
    }
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerClassName="p-4 gap-3"
        renderItem={({ item }) =>
          item.role === 'user' ? (
            <View className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5">
              <RichText content={item.text} />
            </View>
          ) : (
            <View className="self-start max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5">
              <RichText content={item.text} />
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
