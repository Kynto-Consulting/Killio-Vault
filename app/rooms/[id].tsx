import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import {
  GestureHandlerRootView,
  Swipeable,
} from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCheck,
  Copy as CopyIcon,
  CornerUpLeft,
  Edit2,
  File as FileIcon,
  Forward as ForwardIcon,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Search as SearchIcon,
  Send,
  Smile,
  Square,
  Trash2,
  Users as UsersIcon,
  Video as VideoIcon,
  X,
} from 'lucide-react-native';

import { Screen } from '@/ui';
import { RichText } from '@/ui/RichText';
import { ReferencePicker } from '@/ui/ReferencePicker';
import { useTranslations } from '@/i18n';
import { ModelSelector } from '@/ui/ModelSelector';
import { useAuth } from '@/core/auth/AuthContext';
import { useWorkspaceCatalog } from '@/workspace/WorkspaceCatalogContext';
import {
  endRoomCall,
  getActiveCall,
  getRoomNotificationPref,
  listRoomMembers,
  listRoomMessages,
  markRoomMessagesRead,
  reactRoomMessage,
  sendRoomMessage,
  setRoomNotificationPref,
  startRoomCall,
  updateRoomMessageMetadata,
  type RoomCall,
  type RoomMember,
  type RoomMessage,
  type RoomNotificationPref,
} from '@/core/api/rooms.client';
import { uploadFile } from '@/core/api/uploads.client';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Full-screen native-feeling room chat.
 *
 * Major UX upgrades over the original v1 (// Mobile:):
 *  - KeyboardAvoidingView wraps the whole screen so the composer never hides
 *    behind the soft keyboard; FlatList auto-scrolls to bottom on every new
 *    message / send / keyboard show.
 *  - Right-swipe a message → opens "reply to" composer state with a quoted
 *    preview chip above the input. Long-press → action sheet (Reply / React /
 *    Copy / Pin / Delete / Forward / Edit).
 *  - Typing `@` opens the workspace ReferencePicker scoped to users; selection
 *    inserts the canonical `@[user:id:Name]` token (RichText turns these into
 *    RefPills automatically).
 *  - Paperclip → action sheet for Image / Video / Document. Uploads via the
 *    shared /uploads endpoint, embeds `<asset .../>` tags so the existing
 *    RichText asset block renders thumbnails inline.
 *  - Mic → tap-to-record voice memo via expo-av. Releasing uploads the m4a
 *    and sends as an audio attachment.
 *  - Read receipts: own messages with backend `status === 'read'` show a
 *    cyan double-check; "sent" shows a muted double-check.
 *  - Pinned banner: top strip when one or more messages are pinned; tap →
 *    scrolls to the first pin.
 *  - In-room search: header search icon expands an inline filter bar (Vault
 *    pattern: text-substring match).
 *  - Member list: tap the room title to open a bottom-sheet with online /
 *    offline members + role badge (uses the room channel presence we already
 *    subscribe to for messages).
 *  - Perf: row component memoized; renderItem + keyExtractor stabilized via
 *    useCallback so FlatList doesn't re-render every message on every send.
 *  - Accessibility: all icon-only buttons get accessibilityLabel; tab-style
 *    notification picker rows get accessibilityRole="radio".
 */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥'];
const MAX_PREVIEW_CHARS = 80;

// ────────────────────────── Helpers ──────────────────────────

function stripAssetTags(content: string): string {
  return content.replace(/<asset\b[^>]*\/?>/g, '').trim();
}

function buildAssetTag(att: {
  url: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  durationMs?: number;
}): string {
  if (att.kind === 'image') {
    return `<asset type="img" src="${att.url}" />`;
  }
  if (att.kind === 'video') {
    return `<asset type="video" src="${att.url}" title="${att.name}" />`;
  }
  if (att.kind === 'audio') {
    return `<asset type="audio" src="${att.url}" title="${att.name}" durationMs="${att.durationMs ?? 0}" />`;
  }
  return `<asset type="document" src="${att.url}" title="${att.name}" />`;
}

function shortPreview(content: string): string {
  const stripped = stripAssetTags(content).replace(/@\[[^\]]+\]/g, (m) => {
    // Display label fragment for `@[type:id:Label]` / `@[type:id|Label]`.
    const inner = m.slice(2, -1);
    const label = inner.split(/[:|]/).pop() ?? inner;
    return `@${label}`;
  });
  return stripped.length > MAX_PREVIEW_CHARS
    ? stripped.slice(0, MAX_PREVIEW_CHARS) + '…'
    : stripped;
}

// ────────────────────────── Screen ──────────────────────────

export default function RoomChatScreen() {
  const router = useRouter();
  const t = useTranslations('roomChat');
  const tRooms = useTranslations('rooms');
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const roomId = String(params.id ?? '');
  const { currentUserId, activeTeam } = useAuth();
  const catalog = useWorkspaceCatalog();

  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pref, setPref] = useState<RoomNotificationPref>('all');
  const [prefOpen, setPrefOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<RoomCall | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  // Preferred model for AI replies in this room (carried in message metadata).
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<RoomMessage | null>(null);
  const [reactionTarget, setReactionTarget] = useState<RoomMessage | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [presenceIds, setPresenceIds] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);

  const listRef = useRef<FlatList<RoomMessage>>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Initial load ─────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const [msgs, p, call, mems] = await Promise.all([
        listRoomMessages(roomId, 100),
        getRoomNotificationPref(roomId).then((r) => r.pref).catch(() => 'all' as const),
        getActiveCall(roomId).catch(() => null),
        listRoomMembers(roomId).catch(() => [] as RoomMember[]),
      ]);
      setMessages(msgs);
      setPref(p);
      setActiveCall(call);
      setMembers(mems);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ─── Realtime ─────────────────────────────────────────────────────────────
  useRealtimeChannel(roomId ? `room:${roomId}` : null, {
    events: {
      'room.message': (payload) => {
        const m = payload as RoomMessage | undefined;
        if (!m?.id) return;
        setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
      },
      'room.message.updated': (payload) => {
        const m = payload as RoomMessage | undefined;
        if (!m?.id) return;
        setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
      },
      'room.call.started': (payload) => setActiveCall(payload as RoomCall),
      'room.call.ended': () => setActiveCall(null),
    },
    onPresence: (e) => {
      // Mobile: maintain a Set of online userIds; cheaper than re-rendering
      // every row on each presence tick.
      setPresenceIds((prev) => {
        const next = new Set(prev);
        if (e.event === 'sync' && Array.isArray(e.users)) {
          next.clear();
          for (const u of e.users) if (u.userId) next.add(u.userId);
        } else if (e.event === 'join' && e.userId) {
          next.add(e.userId);
        } else if (e.event === 'leave' && e.userId) {
          next.delete(e.userId);
        }
        return next;
      });
    },
  });

  // ─── Auto-scroll on new message ───────────────────────────────────────────
  useEffect(() => {
    if (messages.length === 0) return;
    const id = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(id);
  }, [messages.length]);

  // ─── Mark unread as read on every batch ───────────────────────────────────
  useEffect(() => {
    if (!currentUserId || messages.length === 0) return;
    const unreadFromOthers = messages
      .filter((m) => m.userId !== currentUserId && m.status !== 'read')
      .map((m) => m.id);
    if (unreadFromOthers.length === 0) return;
    void markRoomMessagesRead(roomId, unreadFromOthers).catch(() => undefined);
  }, [messages, currentUserId, roomId]);

  // ─── Derived: pinned / filtered ───────────────────────────────────────────
  const pinned = useMemo(
    () => messages.filter((m) => !!m.metadata?.pinned),
    [messages],
  );

  const visibleMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.trim().toLowerCase();
    return messages.filter((m) =>
      stripAssetTags(m.content).toLowerCase().includes(q),
    );
  }, [messages, searchQuery]);

  // ─── Composer: send ───────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const metadata = {
        ...(replyTo
          ? {
              replyTo: {
                id: replyTo.id,
                authorName: replyTo.authorName,
                preview: shortPreview(replyTo.content),
              },
            }
          : {}),
        // Preferred model for the AI reply in an AI room. The backend reads it
        // when selecting the model; ignored for human-only rooms.
        ...(selectedModel ? { model: selectedModel } : {}),
      };
      const m = await sendRoomMessage(
        roomId,
        text,
        Object.keys(metadata).length > 0 ? (metadata as RoomMessage['metadata']) : undefined,
      );
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
      setInput('');
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  }, [input, sending, replyTo, roomId, selectedModel]);

  // ─── Composer: mention autocomplete ──────────────────────────────────────
  const onInputChange = useCallback((next: string) => {
    setInput(next);
    // Detect @<query> directly before the cursor → open ReferencePicker.
    const sel = selection.start;
    const before = next.slice(0, sel);
    const at = before.lastIndexOf('@');
    if (at >= 0) {
      const between = before.slice(at + 1);
      // Only trigger while still inside a word (no spaces/newlines).
      if (between.length <= 24 && !/\s/.test(between)) {
        setMentionAnchor(at);
        setMentionQuery(between);
        setMentionOpen(true);
        return;
      }
    }
    if (mentionOpen) {
      setMentionOpen(false);
      setMentionAnchor(null);
      setMentionQuery('');
    }
  }, [selection.start, mentionOpen]);

  const onSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
      setSelection(e.nativeEvent.selection),
    [],
  );

  const onMentionPick = useCallback(
    (sel: { token: string }) => {
      // Replace `@<query>` (from mentionAnchor through current cursor) with the token.
      if (mentionAnchor == null) {
        setMentionOpen(false);
        return;
      }
      const before = input.slice(0, mentionAnchor);
      const after = input.slice(mentionAnchor + 1 + mentionQuery.length);
      setInput(before + sel.token + ' ' + after);
      setMentionOpen(false);
      setMentionAnchor(null);
      setMentionQuery('');
    },
    [input, mentionAnchor, mentionQuery.length],
  );

  // ─── Composer: attachments ────────────────────────────────────────────────
  const sendAttachment = useCallback(
    async (att: {
      url: string;
      name: string;
      kind: 'image' | 'video' | 'audio' | 'document';
      durationMs?: number;
    }) => {
      const m = await sendRoomMessage(roomId, buildAssetTag(att), {
        attachments: [
          { url: att.url, name: att.name, kind: att.kind, durationMs: att.durationMs },
        ],
      });
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
    },
    [roomId],
  );

  const pickImage = useCallback(async () => {
    setAttachMenuOpen(false);
    if (!activeTeam?.id) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const up = await uploadFile({
        uri: a.uri,
        name: a.fileName ?? `image-${Date.now()}.jpg`,
        type: a.mimeType ?? 'image/jpeg',
        ownerScopeType: 'team',
        ownerScopeId: activeTeam.id,
        usage: 'chat_attachment',
      });
      if (up.url) {
        await sendAttachment({
          url: String(up.url),
          name: a.fileName ?? 'image',
          kind: 'image',
        });
      }
    } catch {
      Alert.alert(tRooms('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [activeTeam?.id, sendAttachment, tRooms]);

  const pickVideo = useCallback(async () => {
    setAttachMenuOpen(false);
    if (!activeTeam?.id) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const up = await uploadFile({
        uri: a.uri,
        name: a.fileName ?? `video-${Date.now()}.mp4`,
        type: a.mimeType ?? 'video/mp4',
        ownerScopeType: 'team',
        ownerScopeId: activeTeam.id,
        usage: 'chat_attachment',
      });
      if (up.url) {
        await sendAttachment({
          url: String(up.url),
          name: a.fileName ?? 'video',
          kind: 'video',
        });
      }
    } catch {
      Alert.alert(tRooms('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [activeTeam?.id, sendAttachment, tRooms]);

  const pickDocument = useCallback(async () => {
    setAttachMenuOpen(false);
    if (!activeTeam?.id) return;
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
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
      if (up.url) {
        await sendAttachment({
          url: String(up.url),
          name: a.name ?? 'file',
          kind: 'document',
        });
      }
    } catch {
      Alert.alert(tRooms('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [activeTeam?.id, sendAttachment, tRooms]);

  // ─── Composer: voice ──────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: r } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(r);
      setRecordingMs(0);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      recordingTimer.current = setInterval(() => {
        setRecordingMs((ms) => ms + 100);
      }, 100);
    } catch {
      // Silently ignore — user can tap again.
    }
  }, []);

  const stopRecording = useCallback(
    async (sendIt: boolean) => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      const r = recording;
      setRecording(null);
      const durationMs = recordingMs;
      setRecordingMs(0);
      if (!r) return;
      try {
        await r.stopAndUnloadAsync();
        const uri = r.getURI();
        if (!sendIt || !uri || durationMs < 700 || !activeTeam?.id) return;
        setUploading(true);
        try {
          const up = await uploadFile({
            uri,
            name: `voice-${Date.now()}.m4a`,
            type: 'audio/m4a',
            ownerScopeType: 'team',
            ownerScopeId: activeTeam.id,
            usage: 'chat_attachment',
          });
          if (up.url) {
            await sendAttachment({
              url: String(up.url),
              name: tRooms('attachmentVoice'),
              kind: 'audio',
              durationMs,
            });
          }
        } finally {
          setUploading(false);
        }
      } catch {
        // ignore
      }
    },
    [recording, recordingMs, activeTeam?.id, sendAttachment, tRooms],
  );

  // ─── Per-message actions ──────────────────────────────────────────────────
  const togglePin = useCallback(
    async (m: RoomMessage) => {
      const next = !m.metadata?.pinned;
      setMessages((cur) =>
        cur.map((x) =>
          x.id === m.id
            ? { ...x, metadata: { ...(x.metadata ?? {}), pinned: next } }
            : x,
        ),
      );
      try {
        await updateRoomMessageMetadata(roomId, m.id, { ...(m.metadata ?? {}), pinned: next });
      } catch {
        void reload();
      }
    },
    [roomId, reload],
  );

  const softDelete = useCallback(
    async (m: RoomMessage) => {
      setMessages((cur) =>
        cur.map((x) =>
          x.id === m.id
            ? { ...x, metadata: { ...(x.metadata ?? {}), deleted: true } }
            : x,
        ),
      );
      try {
        await updateRoomMessageMetadata(roomId, m.id, { ...(m.metadata ?? {}), deleted: true });
      } catch {
        void reload();
      }
    },
    [roomId, reload],
  );

  const copyMessage = useCallback(async (m: RoomMessage) => {
    await Clipboard.setStringAsync(stripAssetTags(m.content));
  }, []);

  const togglePref = async (next: RoomNotificationPref) => {
    setPref(next);
    setPrefOpen(false);
    try {
      await setRoomNotificationPref(roomId, next);
    } catch {
      void reload();
    }
  };

  const toggleCall = async () => {
    setCallBusy(true);
    try {
      if (activeCall) {
        await endRoomCall(roomId, activeCall.id);
        setActiveCall(null);
      } else {
        const call = await startRoomCall(roomId);
        setActiveCall(call);
      }
    } finally {
      setCallBusy(false);
    }
  };

  const jumpToPinned = useCallback(() => {
    const first = pinned[0];
    if (!first) return;
    const idx = visibleMessages.findIndex((m) => m.id === first.id);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
    }
  }, [pinned, visibleMessages]);

  // ─── Render row (memoized) ────────────────────────────────────────────────
  const keyExtractor = useCallback((m: RoomMessage) => m.id, []);

  const renderItem = useCallback(
    ({ item }: { item: RoomMessage }) => (
      <MessageRow
        message={item}
        isOwn={item.userId === currentUserId}
        roomId={roomId}
        onSwipeReply={(m) => {
          void Haptics.selectionAsync().catch(() => undefined);
          setReplyTo(m);
        }}
        onLongPress={(m) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          setActionTarget(m);
        }}
        onReact={(m, emoji) => void reactRoomMessage(roomId, m.id, emoji)}
      />
    ),
    [currentUserId, roomId],
  );

  const onScrollToIndexFailed = useCallback(
    (info: { index: number }) => {
      const id = setTimeout(() => {
        listRef.current?.scrollToIndex({ index: info.index, animated: false });
      }, 100);
      return () => clearTimeout(id);
    },
    [],
  );

  const headerName = params.name ?? t('untitled');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Screen padded={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-border/40 px-3 py-2">
            <Pressable
              hitSlop={10}
              onPress={() => router.back()}
              className="p-1"
              accessibilityRole="button"
              accessibilityLabel={tRooms('back')}
            >
              <ArrowLeft size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={() => setMembersOpen(true)}
              className="flex-1 px-3"
              accessibilityRole="button"
              accessibilityLabel={tRooms('openMembers')}
            >
              <Text
                style={{ fontFamily: fonts.bold }}
                className="text-base text-foreground"
                numberOfLines={1}
              >
                {headerName}
              </Text>
              {members.length > 0 ? (
                <Text className="text-[10px] text-muted-foreground">
                  {members.length} · {presenceIds.size} {tRooms('membersOnline')}
                </Text>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => setSearchOpen((v) => !v)}
              hitSlop={6}
              className="h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? tRooms('searchClose') : tRooms('searchOpen')}
            >
              {searchOpen ? (
                <X size={13} color={colors.foreground} />
              ) : (
                <SearchIcon size={13} color={colors.foreground} />
              )}
            </Pressable>
            <Pressable
              onPress={() => setPrefOpen(true)}
              hitSlop={6}
              className="h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
              accessibilityRole="button"
              accessibilityLabel={tRooms('notifications')}
            >
              {pref === 'none' ? (
                <BellOff size={13} color={colors.mutedForeground} />
              ) : (
                <Bell size={13} color={pref === 'mentions' ? colors.cyan : colors.foreground} />
              )}
            </Pressable>
            <Pressable
              onPress={() => void toggleCall()}
              disabled={callBusy}
              hitSlop={6}
              className={`h-8 w-8 items-center justify-center rounded-md ${activeCall ? 'bg-destructive' : 'bg-cyan'}`}
              accessibilityRole="button"
              accessibilityLabel={activeCall ? t('endCall') : tRooms('startCall')}
            >
              {activeCall ? (
                <PhoneOff size={13} color={colors.background} />
              ) : (
                <Phone size={13} color={colors.background} />
              )}
            </Pressable>
          </View>

          {/* Search bar */}
          {searchOpen ? (
            <View className="flex-row items-center gap-2 border-b border-border/40 bg-secondary px-3 py-2">
              <SearchIcon size={13} color={colors.mutedForeground} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={tRooms('searchPlaceholder')}
                placeholderTextColor={colors.mutedForeground}
                style={{ fontFamily: fonts.regular, color: colors.foreground, flex: 1 }}
                autoFocus
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                  <X size={13} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Pinned banner */}
          {pinned.length > 0 ? (
            <Pressable
              onPress={jumpToPinned}
              className="flex-row items-center gap-2 border-b border-cyan/30 bg-cyan/10 px-3 py-1.5"
              accessibilityRole="button"
            >
              <Pin size={11} color={colors.cyan} />
              <Text style={{ fontFamily: fonts.semibold }} className="flex-1 text-[11px] text-cyan">
                {tRooms('pinnedBanner', { count: pinned.length })}
              </Text>
              <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
                {tRooms('pinnedJump')}
              </Text>
            </Pressable>
          ) : null}

          {/* Active call badge */}
          {activeCall ? (
            <View className="bg-cyan/10 border-b border-cyan/40 px-3 py-2 flex-row items-center gap-2">
              <ActivityIndicator color={colors.cyan} size="small" />
              <Text style={{ fontFamily: fonts.semibold }} className="flex-1 text-xs text-cyan">
                {t('callActive')}
              </Text>
              <Pressable
                onPress={() => void toggleCall()}
                className="rounded-md bg-destructive px-2 py-1 flex-row items-center gap-1"
                accessibilityRole="button"
                accessibilityLabel={t('endCall')}
              >
                <Square size={10} color={colors.background} />
                <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-background">
                  {t('endCall')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Messages */}
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            contentContainerClassName="p-3 gap-2"
            data={visibleMessages}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={11}
            removeClippedSubviews
            onScrollToIndexFailed={onScrollToIndexFailed}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              loading ? (
                <View className="items-center justify-center py-10">
                  <ActivityIndicator color={colors.cyan} />
                </View>
              ) : searchQuery ? (
                <View className="items-center justify-center py-10 opacity-60">
                  <Text className="text-xs text-muted-foreground">
                    {tRooms('searchEmpty')}
                  </Text>
                </View>
              ) : (
                <View className="items-center justify-center py-10 opacity-60">
                  <Text className="text-xs text-muted-foreground">{t('empty')}</Text>
                </View>
              )
            }
          />

          {/* Reply preview */}
          {replyTo ? (
            <View className="flex-row items-center gap-2 border-t border-border/40 bg-secondary px-3 py-2">
              <View className="w-0.5 h-9 bg-cyan rounded-full" />
              <View className="flex-1">
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[10px] text-cyan"
                  numberOfLines={1}
                >
                  {tRooms('replyingTo', { name: replyTo.authorName ?? '…' })}
                </Text>
                <Text
                  className="text-[11px] text-muted-foreground"
                  numberOfLines={1}
                >
                  {shortPreview(replyTo.content)}
                </Text>
              </View>
              <Pressable
                onPress={() => setReplyTo(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={tRooms('cancel')}
              >
                <X size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : null}

          {/* Recording strip */}
          {recording ? (
            <View className="flex-row items-center gap-2 border-t border-border/40 bg-destructive/10 px-3 py-2">
              <View className="h-2 w-2 rounded-full bg-destructive" />
              <Text style={{ fontFamily: fonts.semibold }} className="flex-1 text-xs text-destructive">
                {tRooms('recording')} {(recordingMs / 1000).toFixed(1)}s
              </Text>
              <Text className="text-[10px] text-muted-foreground">
                {tRooms('releaseToSend')}
              </Text>
            </View>
          ) : null}

          {/* Model selector — carried in metadata for AI replies. */}
          {activeTeam?.id ? (
            <View className="border-t border-border/40 px-2 pt-2">
              <ModelSelector
                teamId={activeTeam.id}
                value={selectedModel}
                onChange={setSelectedModel}
              />
            </View>
          ) : null}

          {/* Composer */}
          <View className="flex-row items-end gap-2 border-t border-border/40 p-2">
            <Pressable
              onPress={() => setAttachMenuOpen(true)}
              disabled={uploading}
              hitSlop={6}
              className="h-9 w-9 items-center justify-center rounded-full bg-secondary"
              accessibilityRole="button"
              accessibilityLabel={tRooms('attach')}
            >
              <Paperclip size={14} color={uploading ? colors.cyan : colors.foreground} />
            </Pressable>
            <TextInput
              value={input}
              onChangeText={onInputChange}
              onSelectionChange={onSelectionChange}
              placeholder={t('placeholder')}
              placeholderTextColor={colors.mutedForeground}
              style={{ fontFamily: fonts.regular, maxHeight: 120 }}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              multiline
            />
            {input.trim() ? (
              <Pressable
                onPress={send}
                disabled={sending}
                className={`h-9 w-9 items-center justify-center rounded-full ${sending ? 'bg-secondary' : 'bg-cyan'}`}
                accessibilityRole="button"
                accessibilityLabel={tRooms('send')}
              >
                <Send size={14} color={sending ? colors.mutedForeground : colors.background} />
              </Pressable>
            ) : (
              <Pressable
                onPressIn={() => void startRecording()}
                onPressOut={() => void stopRecording(true)}
                onLongPress={() => undefined}
                delayLongPress={150}
                hitSlop={6}
                className={`h-9 w-9 items-center justify-center rounded-full ${recording ? 'bg-destructive' : 'bg-cyan'}`}
                accessibilityRole="button"
                accessibilityLabel={tRooms('record')}
              >
                <Mic size={14} color={colors.background} />
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>

        {/* Notification pref modal */}
        <Modal
          visible={prefOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPrefOpen(false)}
        >
          <Pressable
            onPress={() => setPrefOpen(false)}
            className="flex-1 items-center justify-center bg-background/80 p-6"
          >
            <View className="w-full max-w-xs rounded-xl border border-border bg-card p-2 gap-1">
              {(['all', 'mentions', 'none'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => void togglePref(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: pref === p }}
                  className={`flex-row items-center gap-2 rounded-md px-3 py-2 ${pref === p ? 'bg-secondary' : ''}`}
                >
                  <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground">
                    {t(`pref.${p}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

        {/* Attachment action sheet */}
        <BottomSheet visible={attachMenuOpen} onClose={() => setAttachMenuOpen(false)}>
          <SheetItem
            icon={<ImageIcon size={16} color={colors.cyan} />}
            label={tRooms('attachImage')}
            onPress={() => void pickImage()}
          />
          <SheetItem
            icon={<VideoIcon size={16} color={colors.cyan} />}
            label={tRooms('attachVideo')}
            onPress={() => void pickVideo()}
          />
          <SheetItem
            icon={<FileIcon size={16} color={colors.cyan} />}
            label={tRooms('attachDocument')}
            onPress={() => void pickDocument()}
          />
        </BottomSheet>

        {/* Message action sheet */}
        <BottomSheet visible={!!actionTarget} onClose={() => setActionTarget(null)}>
          {actionTarget ? (
            <>
              <SheetItem
                icon={<CornerUpLeft size={16} color={colors.foreground} />}
                label={tRooms('reply')}
                onPress={() => {
                  setReplyTo(actionTarget);
                  setActionTarget(null);
                }}
              />
              <SheetItem
                icon={<Smile size={16} color={colors.foreground} />}
                label={tRooms('react')}
                onPress={() => {
                  setReactionTarget(actionTarget);
                  setActionTarget(null);
                }}
              />
              <SheetItem
                icon={<CopyIcon size={16} color={colors.foreground} />}
                label={tRooms('copy')}
                onPress={async () => {
                  await copyMessage(actionTarget);
                  setActionTarget(null);
                }}
              />
              <SheetItem
                icon={
                  actionTarget.metadata?.pinned ? (
                    <PinOff size={16} color={colors.foreground} />
                  ) : (
                    <Pin size={16} color={colors.cyan} />
                  )
                }
                label={actionTarget.metadata?.pinned ? tRooms('unpin') : tRooms('pin')}
                onPress={() => {
                  void togglePin(actionTarget);
                  setActionTarget(null);
                }}
              />
              <SheetItem
                icon={<ForwardIcon size={16} color={colors.foreground} />}
                label={tRooms('forward')}
                onPress={() => {
                  // Mobile: forward UI not built yet — copies to clipboard so
                  // user can paste into another room until the dedicated
                  // forward picker ships.
                  void copyMessage(actionTarget);
                  setActionTarget(null);
                }}
              />
              {actionTarget.userId === currentUserId ? (
                <SheetItem
                  icon={<Edit2 size={16} color={colors.foreground} />}
                  label={tRooms('edit')}
                  onPress={() => {
                    setInput(stripAssetTags(actionTarget.content));
                    setActionTarget(null);
                  }}
                />
              ) : null}
              {actionTarget.userId === currentUserId ? (
                <SheetItem
                  icon={<Trash2 size={16} color={colors.destructive} />}
                  label={tRooms('delete')}
                  destructive
                  onPress={() => {
                    void softDelete(actionTarget);
                    setActionTarget(null);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </BottomSheet>

        {/* Reaction picker sheet */}
        <BottomSheet visible={!!reactionTarget} onClose={() => setReactionTarget(null)}>
          <View className="flex-row flex-wrap gap-3 p-3 justify-center">
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => {
                  if (reactionTarget) void reactRoomMessage(roomId, reactionTarget.id, emoji);
                  setReactionTarget(null);
                }}
                className="h-12 w-12 items-center justify-center rounded-full bg-secondary"
                accessibilityRole="button"
                accessibilityLabel={emoji}
              >
                <Text style={{ fontSize: 24 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </BottomSheet>

        {/* Members sheet */}
        <BottomSheet visible={membersOpen} onClose={() => setMembersOpen(false)} tall>
          <View className="px-4 pt-2 pb-3 flex-row items-center gap-2">
            <UsersIcon size={14} color={colors.cyan} />
            <Text style={{ fontFamily: fonts.bold }} className="text-sm text-foreground">
              {tRooms('members')} · {members.length}
            </Text>
          </View>
          <FlatList
            data={members}
            keyExtractor={(m) => m.userId}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const online = presenceIds.has(item.userId);
              return (
                <View className="flex-row items-center gap-3 px-4 py-2">
                  <View className="relative">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-secondary">
                      <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-foreground">
                        {(item.displayName ?? item.userId).charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    {online ? (
                      <View
                        className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card"
                        style={{ backgroundColor: colors.success }}
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontFamily: fonts.medium }}
                      className="text-sm text-foreground"
                      numberOfLines={1}
                    >
                      {item.displayName ?? item.userId.slice(0, 6)}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">
                      {online ? tRooms('membersOnline') : tRooms('membersOffline')}
                    </Text>
                  </View>
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="text-[10px] uppercase tracking-widest text-muted-foreground"
                  >
                    {tRooms(`role.${item.role}` as 'role.admin' | 'role.member' | 'role.readonly')}
                  </Text>
                </View>
              );
            }}
          />
        </BottomSheet>

        {/* Mention picker (reuses workspace ReferencePicker, scoped to users) */}
        <ReferencePicker
          visible={mentionOpen}
          onClose={() => {
            setMentionOpen(false);
            setMentionAnchor(null);
            setMentionQuery('');
          }}
          onPick={onMentionPick}
          allowed={['user']}
          users={catalog.users}
          teamId={activeTeam?.id}
          initialQuery={mentionQuery}
        />
      </Screen>
    </GestureHandlerRootView>
  );
}

// ────────────────────────── Memoized row ──────────────────────────

interface MessageRowProps {
  message: RoomMessage;
  isOwn: boolean;
  roomId: string;
  onSwipeReply(m: RoomMessage): void;
  onLongPress(m: RoomMessage): void;
  onReact(m: RoomMessage, emoji: string): void;
}

const MessageRow = memo(function MessageRow({
  message,
  isOwn,
  onSwipeReply,
  onLongPress,
  onReact,
}: MessageRowProps) {
  const deleted = !!message.metadata?.deleted;
  const replyTo = message.metadata?.replyTo;
  const pinned = !!message.metadata?.pinned;
  const isRead = message.status === 'read';
  // AI/bot messages arrive with userId = null and kind 'ai'. Resolve a safe
  // author label (never .slice() a null userId) and render the AI Copilot name.
  const isAi = message.type === 'ai' || message.userId == null;
  const authorLabel =
    message.authorName ??
    message.user?.displayName ??
    (isAi ? 'AI Copilot' : (message.userId ?? '').slice(0, 6));

  // Mobile: swipe-right to reply. We render a thin cyan reveal so users get
  // visual feedback while swiping; releasing past ~60px triggers the callback.
  const renderLeftActions = () => (
    <View
      style={{
        width: 60,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.7,
      }}
    >
      <CornerUpLeft size={18} color={colors.cyan} />
    </View>
  );

  return (
    <Swipeable
      friction={2}
      leftThreshold={50}
      renderLeftActions={renderLeftActions}
      onSwipeableOpen={(direction) => {
        if (direction === 'left' && !deleted) onSwipeReply(message);
      }}
    >
      <Pressable
        onLongPress={() => !deleted && onLongPress(message)}
        delayLongPress={250}
        className={`rounded-lg border ${pinned ? 'border-cyan/40 bg-cyan/5' : 'border-border/40 bg-background'} px-3 py-2`}
      >
        <View className="flex-row items-center justify-between">
          <Text
            style={{ fontFamily: fonts.semibold }}
            className={`text-[11px] ${isAi ? 'text-cyan' : 'text-foreground'}`}
            numberOfLines={1}
          >
            {isAi ? '🤖 ' : ''}{authorLabel}
            {pinned ? '  📌' : ''}
          </Text>
          <Text className="text-[9px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {message.editedAt ? ' · ✎' : ''}
          </Text>
        </View>

        {replyTo ? (
          <View className="mt-1 flex-row items-stretch gap-2 rounded-md bg-secondary/50 px-2 py-1">
            <View className="w-0.5 bg-cyan rounded-full" />
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-[9px] text-cyan"
                numberOfLines={1}
              >
                {replyTo.authorName ?? '…'}
              </Text>
              <Text className="text-[10px] text-muted-foreground" numberOfLines={2}>
                {replyTo.preview}
              </Text>
            </View>
          </View>
        ) : null}

        {deleted ? (
          <Text className="mt-1 text-[12px] italic text-muted-foreground">
            {/* Renderer hides body — keeps the row anchor for reactions. */}
            🗑️
          </Text>
        ) : (
          <View className="mt-1">
            <RichText content={message.content} size={13} />
          </View>
        )}

        {message.reactions && message.reactions.length > 0 ? (
          <View className="mt-1 flex-row flex-wrap gap-1">
            {message.reactions.map((r) => (
              <Pressable
                key={r.emoji}
                onPress={() => onReact(message, r.emoji)}
                className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5"
                accessibilityRole="button"
                accessibilityLabel={`${r.emoji} ${r.userIds.length}`}
              >
                <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
                <Text className="text-[9px] text-muted-foreground">{r.userIds.length}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!deleted ? (
          <View className="mt-1 flex-row items-center justify-between">
            <View className="flex-row gap-1">
              {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => onReact(message, emoji)}
                  hitSlop={4}
                  className="rounded-md border border-border/40 bg-background px-1.5"
                  accessibilityRole="button"
                  accessibilityLabel={emoji}
                >
                  <Text style={{ fontSize: 12 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {isOwn ? (
              <CheckCheck
                size={11}
                color={isRead ? colors.cyan : colors.mutedForeground}
                accessibilityLabel={isRead ? 'read' : 'sent'}
              />
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Swipeable>
  );
});

// ────────────────────────── Bottom sheet primitive ──────────────────────────

function BottomSheet({
  visible,
  onClose,
  children,
  tall = false,
}: {
  visible: boolean;
  onClose(): void;
  children: React.ReactNode;
  tall?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-background/70 justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className={`rounded-t-2xl border-t border-border bg-card ${tall ? 'max-h-[80%]' : ''}`}
        >
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          {children}
          <View style={{ height: 12 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetItem({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress(): void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text
        style={{ fontFamily: fonts.medium, color: destructive ? colors.destructive : colors.foreground }}
        className="flex-1 text-sm"
      >
        {label}
      </Text>
    </Pressable>
  );
}
