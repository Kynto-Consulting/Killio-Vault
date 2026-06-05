import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Phone,
  PhoneOff,
  Send,
  Square,
} from 'lucide-react-native';

import { Screen } from '@/ui';
import { RichText } from '@/ui/RichText';
import { useTranslations } from '@/i18n';
import {
  endRoomCall,
  getActiveCall,
  getRoomNotificationPref,
  listRoomMessages,
  reactRoomMessage,
  sendRoomMessage,
  setRoomNotificationPref,
  startRoomCall,
  type RoomCall,
  type RoomMessage,
  type RoomNotificationPref,
} from '@/core/api/rooms.client';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Full-screen room chat. Supports room and DM channels alike. Live messages
 * stream over the Pulse `room:<id>` channel. Header exposes the call toggle
 * (start/end) and a notification-pref menu (all / mentions / none) matching
 * the web room drawer.
 */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥'];

export default function RoomChatScreen() {
  const router = useRouter();
  const t = useTranslations('roomChat');
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const roomId = String(params.id ?? '');

  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pref, setPref] = useState<RoomNotificationPref>('all');
  const [prefOpen, setPrefOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<RoomCall | null>(null);
  const [callBusy, setCallBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const [msgs, p, call] = await Promise.all([
        listRoomMessages(roomId, 100),
        getRoomNotificationPref(roomId).then((r) => r.pref).catch(() => 'all' as const),
        getActiveCall(roomId).catch(() => null),
      ]);
      setMessages(msgs);
      setPref(p);
      setActiveCall(call);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtimeChannel(roomId ? `room:${roomId}` : null, {
    events: {
      'room.message': (payload) => {
        const m = payload as RoomMessage | undefined;
        if (!m?.id) return;
        setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
      },
      'room.call.started': (payload) => {
        setActiveCall(payload as RoomCall);
      },
      'room.call.ended': () => setActiveCall(null),
    },
  });

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const m = await sendRoomMessage(roomId, text);
      setMessages((cur) => [...cur, m]);
      setInput('');
    } finally {
      setSending(false);
    }
  };

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

  return (
    <Screen padded={false}>
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border/40 px-3 py-2">
        <Pressable hitSlop={10} onPress={() => router.back()} className="p-1">
          <ArrowLeft size={20} color={colors.foreground} />
        </Pressable>
        <Text
          style={{ fontFamily: fonts.bold }}
          className="flex-1 px-3 text-base text-foreground"
          numberOfLines={1}
        >
          {params.name ?? t('untitled')}
        </Text>
        <Pressable
          onPress={() => setPrefOpen(true)}
          hitSlop={6}
          className="h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
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
        >
          {activeCall ? (
            <PhoneOff size={13} color={colors.background} />
          ) : (
            <Phone size={13} color={colors.background} />
          )}
        </Pressable>
      </View>

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
        style={{ flex: 1 }}
        contentContainerClassName="p-3 gap-2"
        data={messages}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={
          loading ? (
            <View className="items-center justify-center py-10">
              <ActivityIndicator color={colors.cyan} />
            </View>
          ) : (
            <View className="items-center justify-center py-10 opacity-60">
              <Text className="text-xs text-muted-foreground">{t('empty')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View className="rounded-lg border border-border/40 bg-background px-3 py-2">
            <View className="flex-row items-center justify-between">
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-[11px] text-foreground"
                numberOfLines={1}
              >
                {item.authorName ?? item.userId.slice(0, 6)}
              </Text>
              <Text className="text-[9px] text-muted-foreground">
                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <View className="mt-1">
              <RichText content={item.content} size={13} />
            </View>
            {item.reactions && item.reactions.length > 0 ? (
              <View className="mt-1 flex-row flex-wrap gap-1">
                {item.reactions.map((r) => (
                  <Pressable
                    key={r.emoji}
                    onPress={() => void reactRoomMessage(roomId, item.id, r.emoji)}
                    className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5"
                  >
                    <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
                    <Text className="text-[9px] text-muted-foreground">{r.userIds.length}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View className="mt-1 flex-row gap-1">
              {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => void reactRoomMessage(roomId, item.id, emoji)}
                  hitSlop={4}
                  className="rounded-md border border-border/40 bg-background px-1.5"
                >
                  <Text style={{ fontSize: 12 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />

      {/* Composer */}
      <View className="flex-row items-center gap-2 border-t border-border/40 p-2">
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t('placeholder')}
          placeholderTextColor={colors.mutedForeground}
          style={{ fontFamily: fonts.regular }}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          multiline
        />
        <Pressable
          onPress={send}
          disabled={sending || !input.trim()}
          className={`rounded-md p-2 ${sending || !input.trim() ? 'bg-secondary' : 'bg-cyan'}`}
        >
          <Send
            size={14}
            color={sending || !input.trim() ? colors.mutedForeground : colors.background}
          />
        </Pressable>
      </View>

      {/* Notification pref modal */}
      <Modal
        visible={prefOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPrefOpen(false)}
      >
        <Pressable onPress={() => setPrefOpen(false)} className="flex-1 items-center justify-center bg-background/80 p-6">
          <View className="w-full max-w-xs rounded-xl border border-border bg-card p-2 gap-1">
            {(['all', 'mentions', 'none'] as const).map((p) => (
              <Pressable
                key={p}
                onPress={() => void togglePref(p)}
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
    </Screen>
  );
}
