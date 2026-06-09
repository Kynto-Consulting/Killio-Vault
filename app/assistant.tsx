/*
 * ── Assistant → rooms persistence: end-to-end flow ──────────────────────────
 *
 * One Vault assistant conversation = ONE room, reused for every turn. The bot
 * reply is stored as an AI message (kind 'ai', userId null), not as the user's
 * own message.
 *
 *  1. User sends `send()` → runTurn(message, { userTurn: true }).
 *  2. streamAgentChat posts /agent/chat/stream with conversationId =
 *     convId.current (undefined on the very first turn). The backend agent loop
 *     resolves/creates the conversation and returns its id in the `done` event.
 *  3. onDone sets convId.current = cid (STABLE id, reused for every later turn).
 *  4. Mirror to rooms: logConversation({ conversationId: cid, userText,
 *     assistantText, title }) → POST /vault/conversation/log →
 *     VaultService.logConversationTurn:
 *       a. findRoomByEntity('vault_conversation', cid) — looks up the room by
 *          conversation id. Created as kind 'thread' so the lookup (which
 *          filters kind='thread') matches on every subsequent turn → exactly
 *          ONE room per conversation (was a NEW room per message when it was
 *          created as 'channel' and never re-found).
 *       b. userText  → rooms.sendMessage   (kind 'text', userId = me)  → right side.
 *       c. assistantText → rooms.sendAiMessage (kind 'ai', userId null,
 *          author 'AI Copilot') → left / bot side (was sendMessage with my id,
 *          so the bot reply showed as mine).
 *  5. Render: app/rooms/[id].tsx — isOwn = (userId === currentUserId); an AI
 *     message has userId null so isOwn is false and isAi is true → bot styling,
 *     "🤖 AI Copilot" author. Plain text messages keep the user side.
 *  6. Reload / resume: getConversationMessages(cid) repopulates this screen;
 *     opening the linked room calls findRoomByEntity → same single room, full
 *     history (alternating user + AI Copilot messages).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLayoutEffect } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';

import { Screen, RichText, AgentMessage } from '@/ui';
import {
  Mic,
  Paperclip,
  X,
  SquarePen,
  Copy,
  Pencil,
  RotateCcw,
  Check,
  Plus,
  Send,
  Image as ImageIcon,
  Camera as CameraIcon,
  File as FileIcon,
} from 'lucide-react-native';
import { write as clipboardWrite } from '@/integrations/clipboard';
import { fonts } from '@/theme/fonts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { uploadFile } from '@/core/api/uploads.client';
import { useAuth } from '@/core/auth/AuthContext';
import { useCapture } from '@/capture/CaptureContext';
import { ModelStatusBanner } from '@/capture/ModelStatusBanner';
import {
  streamAgentChat,
  getConversationMessages,
  truncateConversation,
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
  const tWake = useTranslations('wakeListener');
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
  // Gemini-style "+" attach sheet (Fotos / Cámara / Archivos).
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Per-message "Copiado" feedback: the id of the message whose Copy button was
  // just tapped (checkmark shown for ~1.4s).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // When the user taps Edit on one of their messages we drop that message + the
  // tail locally and stash its server id here; the next send() truncates the
  // persisted conversation at that point before re-sending the edited turn so
  // history matches on reload (same conversation, regenerated in place).
  const truncateAfterId = useRef<string | undefined>(undefined);
  const convId = useRef<string | undefined>(undefined);
  const firstMsg = useRef<string>('');
  const lastUserMsg = useRef<string>('');
  const draftId = useRef<string>('');
  // messageId of the last turn's saved message. When a turn pauses on a
  // client-action it's the "waiting" message the backend updates in place on
  // resume — passed back as clientActionResult.pendingMessageId so the flow is
  // one coherent bubble, not two.
  const pendingClientMsgId = useRef<string | undefined>(undefined);
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
    truncateAfterId.current = undefined;
  };

  // ── Gemini-style per-message actions ──────────────────────────────────────
  // Copy the message's PLAIN text (markup/tool/asset tags stripped) to the OS
  // clipboard, then flash a checkmark for ~1.4s.
  const copyMessage = async (m: Msg) => {
    const plain = stripTags(m.text);
    try {
      await clipboardWrite(plain);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1400);
    } catch {
      // clipboard unavailable — silently ignore
    }
  };

  // Edit a USER message (Gemini "edit & regenerate"): drop that message + every
  // message after it locally, put its plain text back in the composer, and mark
  // the server-side truncation point so the next send() removes the persisted
  // tail before re-sending — keeping convId.current (same conversation).
  const editMessage = (index: number) => {
    if (busy) return;
    const target = messages[index];
    if (!target || target.role !== 'user') return;
    truncateAfterId.current =
      target.id && !target.id.startsWith('u-') ? target.id : undefined;
    setMessages((prev) => prev.slice(0, index));
    setInput(stripTags(target.text));
    setAttachments([]);
  };

  // Regenerate the LAST assistant reply: drop it locally, truncate the server
  // tail from that assistant message, and re-run the previous user turn.
  const regenerateLast = async () => {
    if (busy) return;
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0) return;
    // The user turn that produced it is the nearest preceding user message.
    let userIdx = -1;
    for (let i = lastAssistant - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;
    const userMsg = messages[userIdx];
    const assistantMsg = messages[lastAssistant];
    // Server: remove the assistant reply (and anything after) so the regenerated
    // answer is clean on reload. Best-effort.
    if (
      convId.current &&
      activeTeam?.id &&
      assistantMsg.id &&
      !assistantMsg.id.startsWith('a-')
    ) {
      try {
        await truncateConversation({
          conversationId: convId.current,
          teamId: activeTeam.id,
          afterMessageId: assistantMsg.id,
        });
      } catch {
        // offline / old backend — local regenerate still works
      }
    }
    setMessages((prev) => prev.slice(0, lastAssistant));
    const text = stripTags(userMsg.text);
    lastUserMsg.current = text;
    await runTurn(text, { userTurn: true });
  };

  // GPT-style header: agent/Killio title + a "new chat" button on the right.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: agent?.name ?? tFallback('agent'),
      headerRight: () => (
        <Pressable onPressIn={newChat} hitSlop={12} style={{ paddingHorizontal: 6 }}>
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
    // On a client-action RESUME, keep the SAME assistant bubble so the resolved
    // tool + the final answer continue the original message (no second bubble,
    // and the waiting chip in this bubble flips to done). Fresh turns get a new
    // bubble.
    if (!opts.clientActionResult) draftId.current = `a-${Date.now()}`;
    let finalText = '';
    // Ordered registry of started tool calls, keyed by the backend tool_use_id
    // (falls back to a synthetic id only when the backend omits one). Mirrors
    // the web's `toolEvts` array so a finished event matches the started chip.
    const started: { id: string; tool: string; resolved: boolean }[] = [];
    const idFor = (e: { id?: string; tool: string }): string | undefined => {
      if (e.id) return e.id;
      // No id on the finished event → match the most-recent unresolved start of
      // the same tool (same heuristic the frontend uses for repeated tools).
      for (let i = started.length - 1; i >= 0; i--) {
        if (started[i].tool === e.tool && !started[i].resolved) return started[i].id;
      }
      return undefined;
    };
    const emit = (markup: string) => {
      finalText += markup;
      appendAssistantDelta(markup);
    };
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
          const id = e.id ?? `tc-${started.length}`;
          started.push({ id, tool: e.tool, resolved: false });
          // Synthesize inline markup so AgentMessage renders a live tool chip,
          // keyed by the SAME id the finished event will carry.
          emit(
            `\n<invoke id="${id}" name="${e.tool}"><parameters>${renderParams(
              e.input,
            )}</parameters></invoke>\n<tool_status id="${id}" status="running" />`,
          );
        },
        onToolDone: (e) => {
          const id = idFor(e);
          if (!id) return;
          const entry = started.find((s) => s.id === id);
          if (entry) entry.resolved = true;
          // Flip the chip to done/error AND attach the result so the chip can
          // show its output line (was dropped → chip never completed).
          emit(
            `\n<tool_status id="${id}" status="${e.success ? 'done' : 'error'}" success="${
              e.success
            }"${e.durationMs != null ? ` duration_ms="${e.durationMs}"` : ''} />`,
          );
          if (e.output !== undefined) {
            emit(
              `\n<tool_output id="${id}" success="${e.success}">${escapeOutput(
                e.output,
              )}</tool_output>`,
            );
          }
        },
        onToolResult: (e) => {
          // Separate result event (same tool_use_id). Only emit if tool_done
          // didn't already carry the output, so the chip isn't duplicated.
          const id = idFor(e);
          if (!id || e.data === undefined) return;
          if (finalText.includes(`<tool_output id="${id}"`)) return;
          emit(
            `\n<tool_output id="${id}" success="${e.success}">${escapeOutput(
              e.data,
            )}</tool_output>`,
          );
        },
        onToolApproval: (e) => {
          const id = e.id ?? `tc-${started.length}`;
          if (!started.some((s) => s.id === id)) {
            started.push({ id, tool: e.tool, resolved: false });
            emit(
              `\n<invoke id="${id}" name="${e.tool}"><parameters>${renderParams(
                e.input,
              )}</parameters></invoke>`,
            );
          }
          emit(`\n<tool_status id="${id}" status="waiting_for_approval" />`);
        },
        onClientAction: (e) => void handleClientAction(e),
        onDone: ({ conversationId: cid, messageId }) => {
          convId.current = cid;
          // Remember the message this turn saved. If the turn paused on a
          // client-action, the resume passes this back so the backend UPDATES
          // it (resolved tool + answer) instead of inserting a 2nd message.
          pendingClientMsgId.current = messageId;
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
      runTurn('(continÃºa)', {
        clientActionResult: result
          ? { ...result, pendingMessageId: pendingClientMsgId.current ?? undefined }
          : result,
      });

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

  // Shared uploader: pushes one local asset (image OR document) through the chat
  // upload pipeline and appends it as an attachment chip (embedded as an <asset>
  // tag on send). Used by all three "+" sheet options below.
  const uploadAttachment = async (a: {
    uri: string;
    name: string;
    mimeType?: string | null;
    kind: 'img' | 'document';
  }) => {
    if (!activeTeam?.id || uploading) return;
    setUploading(true);
    try {
      const up = await uploadFile({
        uri: a.uri,
        name: a.name,
        type: a.mimeType ?? (a.kind === 'img' ? 'image/jpeg' : 'application/octet-stream'),
        ownerScopeType: 'team',
        ownerScopeId: activeTeam.id,
        usage: 'chat_attachment',
      });
      const url = String(up.url ?? '');
      if (url) setAttachments((prev) => [...prev, { url, name: a.name, kind: a.kind }]);
    } catch {
      // ignore — user can retry
    } finally {
      setUploading(false);
    }
  };

  // ── "+" attach sheet actions (Gemini bottom bar) ──────────────────────────
  // Fotos → image library picker.
  const pickPhoto = async () => {
    setAttachMenuOpen(false);
    if (!activeTeam?.id || uploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAttachment({
      uri: a.uri,
      name: a.fileName ?? `image-${Date.now()}.jpg`,
      mimeType: a.mimeType,
      kind: 'img',
    });
  };

  // Cámara → take a photo.
  const takePhoto = async () => {
    setAttachMenuOpen(false);
    if (!activeTeam?.id || uploading) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAttachment({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: a.mimeType,
      kind: 'img',
    });
  };

  // Archivos → document picker (images, PDFs, text).
  const pickDocument = async () => {
    setAttachMenuOpen(false);
    if (!activeTeam?.id || uploading) return;
    const res = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf', 'text/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAttachment({
      uri: a.uri,
      name: a.name ?? 'file',
      mimeType: a.mimeType,
      kind: (a.mimeType ?? '').startsWith('image/') ? 'img' : 'document',
    });
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
    // If this send is an edited-message regenerate, truncate the persisted
    // conversation at the original message BEFORE re-sending so reload-from-
    // server matches the locally-dropped tail. Same conversation (convId
    // unchanged). Best-effort: an offline/old-backend failure still re-sends.
    const truncId = truncateAfterId.current;
    truncateAfterId.current = undefined;
    if (truncId && convId.current && activeTeam?.id) {
      try {
        await truncateConversation({
          conversationId: convId.current,
          teamId: activeTeam.id,
          afterMessageId: truncId,
        });
      } catch {
        // offline / old backend — local regenerate still works
      }
    }
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
    // Use the user's locale for both the empty-message fallback (when the
    // turn is purely an attachment) and the wake-context prefix that goes
    // INTO the model prompt — otherwise an English account would see
    // Spanish system text inside its own message history.
    const attachmentFallback = `(${tFallback('attachment').toLowerCase()})`;
    const base = runtime.current
      ? await runtime.current.composeMessage(text || attachmentFallback)
      : text;
    const ctx = recentCtx.current
      ? `${tWake('recentContext', { text: recentCtx.current })}\n\n`
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
      <ModelStatusBanner />
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
        renderItem={({ item, index }) =>
          item.role === 'user' ? (
            <View className="self-end max-w-[85%] items-end">
              <View className="rounded-2xl rounded-br-md bg-secondary px-4 py-2.5">
                <RichText content={item.text} selectable />
              </View>
              <MessageActions
                copied={copiedId === item.id}
                onCopy={() => void copyMessage(item)}
                onEdit={busy ? undefined : () => editMessage(index)}
                align="end"
                t={t}
              />
            </View>
          ) : (
            <View className="self-start max-w-[88%] items-start">
              <View className="rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5">
                <AgentMessage content={item.text} selectable />
              </View>
              <MessageActions
                copied={copiedId === item.id}
                onCopy={() => void copyMessage(item)}
                onRegenerate={
                  !busy && index === messages.length - 1 ? () => void regenerateLast() : undefined
                }
                align="start"
                t={t}
              />
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
        {/* Gemini-style composer: rounded pill with a "+" attach button on the
            left, the text field in the middle, and a right button that toggles
            between Mic (empty input → push-to-talk) and Send (has text). */}
        <View className="border-t border-border bg-background px-4 py-3">
          <View className="flex-row items-center gap-1.5 rounded-full border border-border bg-card pl-1.5 pr-1.5 py-1">
            <Pressable
              onPress={() => setAttachMenuOpen(true)}
              hitSlop={6}
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel={t('attachAdd')}
            >
              <Plus size={22} color={uploading ? colors.cyan : colors.foreground} />
            </Pressable>
            <TextInput
              placeholder={listening ? t('listening') : t('placeholder')}
              placeholderTextColor={colors.mutedForeground}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline
              style={{ fontFamily: fonts.regular, color: colors.foreground, maxHeight: 120 }}
              className="flex-1 px-2 text-base"
            />
            {input.trim().length > 0 ? (
              <Pressable
                onPress={send}
                disabled={busy}
                className={`h-9 w-9 items-center justify-center rounded-full bg-primary active:opacity-80 ${
                  busy ? 'opacity-50' : ''
                }`}
                accessibilityRole="button"
                accessibilityLabel={tc('send')}
              >
                <Send size={18} color={colors.primaryForeground} />
              </Pressable>
            ) : (
              <Pressable
                onPress={micPress}
                className={`h-9 w-9 items-center justify-center rounded-full ${
                  listening ? 'bg-destructive' : 'bg-secondary'
                } active:opacity-80`}
                accessibilityRole="button"
                accessibilityLabel={t('listening')}
              >
                <Mic size={18} color={colors.foreground} />
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* "+" attach options sheet: Fotos / Cámara / Archivos */}
      <AttachSheet
        visible={attachMenuOpen}
        onClose={() => setAttachMenuOpen(false)}
        onPhotos={() => void pickPhoto()}
        onCamera={() => void takePhoto()}
        onFiles={() => void pickDocument()}
        t={t}
      />
    </Screen>
  );
}

/**
 * Gemini-style bottom-sheet that the composer "+" opens. Three attach options:
 * Fotos (image library), Cámara (camera), Archivos (document picker).
 */
function AttachSheet({
  visible,
  onClose,
  onPhotos,
  onCamera,
  onFiles,
  t,
}: {
  visible: boolean;
  onClose(): void;
  onPhotos(): void;
  onCamera(): void;
  onFiles(): void;
  t: (k: string) => string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-background/70 justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-2xl border-t border-border bg-card"
        >
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          <AttachItem icon={<ImageIcon size={18} color={colors.cyan} />} label={t('attachPhotos')} onPress={onPhotos} />
          <AttachItem icon={<CameraIcon size={18} color={colors.cyan} />} label={t('attachCamera')} onPress={onCamera} />
          <AttachItem icon={<FileIcon size={18} color={colors.cyan} />} label={t('attachFiles')} onPress={onFiles} />
          <View style={{ height: 12 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AttachItem({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Subtle Gemini-style action row shown under each bubble: a Copy button (both
 * roles), an Edit button (user messages), and an optional Regenerate button
 * (last assistant message). Muted icon buttons; Copy flashes a checkmark +
 * "Copiado" label briefly after a successful copy.
 */
function MessageActions({
  copied,
  onCopy,
  onEdit,
  onRegenerate,
  align,
  t,
}: {
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  align: 'start' | 'end';
  t: (k: string) => string;
}) {
  return (
    <View
      className={`mt-1 flex-row items-center gap-3 px-1 ${
        align === 'end' ? 'self-end' : 'self-start'
      }`}
    >
      <Pressable onPress={onCopy} hitSlop={8} className="flex-row items-center gap-1 active:opacity-60">
        {copied ? (
          <>
            <Check size={14} color={colors.success} />
            <Text className="text-[11px] text-muted-foreground">{t('copied')}</Text>
          </>
        ) : (
          <Copy size={14} color={colors.mutedForeground} />
        )}
      </Pressable>
      {onEdit ? (
        <Pressable onPress={onEdit} hitSlop={8} className="active:opacity-60">
          <Pencil size={14} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      {onRegenerate ? (
        <Pressable onPress={onRegenerate} hitSlop={8} className="active:opacity-60">
          <RotateCcw size={14} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
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

/**
 * Serialises a tool result for inline `<tool_output>` markup. JSON so the
 * markup parser (ai-markup.ts OUTPUT_RE) can JSON.parse it back; HTML-escaped
 * so embedded `<`/`>`/`&` don't break the surrounding tag soup. Capped to keep
 * a giant payload from bloating the persisted message.
 */
function escapeOutput(output: unknown): string {
  let s: string;
  try {
    s = typeof output === 'string' ? output : JSON.stringify(output);
  } catch {
    s = String(output);
  }
  if (s.length > 4000) s = s.slice(0, 4000);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
