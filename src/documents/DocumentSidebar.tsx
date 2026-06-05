import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  Bot,
  History,
  MessageSquare,
  Send,
  X,
} from 'lucide-react-native';

import { RichText } from '@/ui/RichText';
import { useTranslations } from '@/i18n';
import { useAuth } from '@/core/auth/AuthContext';
import {
  createRoom,
  findRoomByEntity,
  listRoomMessages,
  sendRoomMessage,
  type Room,
  type RoomMessage,
} from '@/core/api/rooms.client';
import {
  listDocumentActivity,
  type ActivityLogEntry,
} from '@/core/api/activity.client';
import { streamAgentChat } from '@/core/api/agent.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * 1:1 mobile port of the web `DocumentCommentsDrawer` 3-tab side panel:
 *   - copilot   → AI chat scoped to this document (entityType="document")
 *   - comments  → room chat linked to the document via rooms/find
 *   - activity  → activity-log timeline for the document
 *
 * The parent controls visibility + the doc id; everything else loads from the
 * backend on tab focus.
 */
type Tab = 'copilot' | 'comments' | 'activity';

export interface DocumentSidebarProps {
  open: boolean;
  onClose(): void;
  documentId: string;
  documentTitle: string;
  /** Optional pre-selected tab; defaults to "comments". */
  initialTab?: Tab;
}

export function DocumentSidebar({
  open,
  onClose,
  documentId,
  documentTitle,
  initialTab = 'comments',
}: DocumentSidebarProps) {
  const t = useTranslations('docSidebar');
  const { activeTeam } = useAuth();
  const teamId = activeTeam?.id ?? null;
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View
          style={{ width: '88%', maxWidth: 380 }}
          className="bg-card border-l border-border"
        >
          {/* Header */}
          <View className="flex-row items-center justify-between border-b border-border/40 p-3">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="flex-1 text-sm text-foreground"
              numberOfLines={1}
            >
              {documentTitle}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} className="rounded-md p-1">
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          {/* Tab bar */}
          <View className="flex-row border-b border-border/40">
            <TabButton
              icon={Bot}
              label={t('copilot')}
              active={tab === 'copilot'}
              onPress={() => setTab('copilot')}
            />
            <TabButton
              icon={MessageSquare}
              label={t('comments')}
              active={tab === 'comments'}
              onPress={() => setTab('comments')}
            />
            <TabButton
              icon={History}
              label={t('activity')}
              active={tab === 'activity'}
              onPress={() => setTab('activity')}
            />
          </View>

          {/* Tab content */}
          <View style={{ flex: 1 }}>
            {tab === 'copilot' && teamId ? (
              <CopilotPane teamId={teamId} documentId={documentId} />
            ) : null}
            {tab === 'comments' && teamId ? (
              <CommentsPane
                teamId={teamId}
                documentId={documentId}
                documentTitle={documentTitle}
              />
            ) : null}
            {tab === 'activity' ? <ActivityPane documentId={documentId} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Tab button ──────────────────────────────────────────────────────────────

function TabButton({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: typeof Bot;
  label: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center gap-1.5 py-3 ${
        active ? 'border-b-2 border-cyan' : ''
      }`}
    >
      <Icon size={13} color={active ? colors.cyan : colors.mutedForeground} />
      <Text
        style={{ fontFamily: active ? fonts.semibold : fonts.medium }}
        className={`text-xs ${active ? 'text-cyan' : 'text-muted-foreground'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Copilot tab (AI chat scoped to the document) ────────────────────────────

interface CopilotMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function CopilotPane({
  teamId,
  documentId,
}: {
  teamId: string;
  documentId: string;
}) {
  const t = useTranslations('docSidebar');
  const [messages, setMessages] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const userMsg: CopilotMsg = { id: `u-${Date.now()}`, role: 'user', text };
    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: assistantId, role: 'assistant', text: '' }]);
    setBusy(true);
    // Streams the agent turn scoped to this document. Same loop the /assistant
    // screen uses, but rendered inline in the sidebar so users can chat about
    // the doc without leaving the editor.
    let acc = '';
    await streamAgentChat(
      { teamId, message: text, entityType: 'document', entityId: documentId },
      {
        onDelta: (chunk) => {
          acc += chunk;
          setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, text: acc } : x)));
        },
        onDone: () => setBusy(false),
        onError: (msg) => {
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, text: msg || 'Error' } : x)),
          );
          setBusy(false);
        },
      },
    );
  }, [busy, input, teamId, documentId]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerClassName="p-3 gap-2"
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <View className="items-center justify-center py-10 opacity-60 gap-2">
            <Bot size={24} color={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">{t('copilotEmpty')}</Text>
          </View>
        ) : null}
        {messages.map((m) => (
          <View
            key={m.id}
            className={`max-w-[85%] rounded-xl px-3 py-2 ${
              m.role === 'user'
                ? 'bg-cyan/10 border border-cyan/30 self-end'
                : 'bg-secondary border border-border/40 self-start'
            }`}
          >
            <RichText content={m.text} size={13} />
          </View>
        ))}
        {busy ? (
          <View className="flex-row items-center gap-2 self-start opacity-60">
            <ActivityIndicator color={colors.cyan} size="small" />
            <Text className="text-xs text-muted-foreground">{t('thinking')}</Text>
          </View>
        ) : null}
      </ScrollView>
      <Composer value={input} onChange={setInput} onSend={send} disabled={busy} t={t} />
    </View>
  );
}

// ─── Comments tab (linked room chat) ─────────────────────────────────────────

function CommentsPane({
  teamId,
  documentId,
  documentTitle,
}: {
  teamId: string;
  documentId: string;
  documentTitle: string;
}) {
  const t = useTranslations('docSidebar');
  const { activeTeam } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      let r = await findRoomByEntity(teamId, 'document', documentId);
      setRoom(r);
      if (r) {
        const msgs = await listRoomMessages(r.id, 100);
        setMessages(msgs);
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, documentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      let target = room;
      if (!target) {
        target = await createRoom(teamId, {
          name: documentTitle || 'Documento',
          type: 'channel',
          linkedEntityType: 'document',
          linkedEntityId: documentId,
          emoji: '💬',
        });
        setRoom(target);
      }
      const msg = await sendRoomMessage(target.id, text);
      setMessages((m) => [...m, msg]);
      setInput('');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : messages.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 opacity-60">
          <MessageSquare size={24} color={colors.mutedForeground} />
          <Text className="text-xs text-muted-foreground">{t('commentsEmpty')}</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerClassName="p-3 gap-2"
          renderItem={({ item }) => (
            <RoomMessageRow message={item} ownUserId={activeTeam?.id ? undefined : undefined} />
          )}
        />
      )}
      <Composer value={input} onChange={setInput} onSend={send} disabled={sending} t={t} />
    </View>
  );
}

function RoomMessageRow({ message }: { message: RoomMessage; ownUserId?: string }) {
  return (
    <View className="rounded-lg border border-border/40 bg-background px-3 py-2">
      <View className="flex-row items-center justify-between">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[11px] text-foreground"
          numberOfLines={1}
        >
          {message.authorName ?? message.userId.slice(0, 6)}
        </Text>
        <Text className="text-[9px] text-muted-foreground">
          {formatTime(message.createdAt)}
        </Text>
      </View>
      <View className="mt-1">
        <RichText content={message.content} size={13} />
      </View>
    </View>
  );
}

// ─── Activity tab (document activity log) ────────────────────────────────────

function ActivityPane({ documentId }: { documentId: string }) {
  const t = useTranslations('docSidebar');
  const [items, setItems] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await listDocumentActivity(documentId);
        if (!cancelled) setItems(rows);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const grouped = useMemo(() => groupByDay(items), [items]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-2 opacity-60">
        <History size={24} color={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">{t('activityEmpty')}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerClassName="p-3 gap-3">
      {grouped.map((day) => (
        <View key={day.label} className="gap-1">
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            {day.label}
          </Text>
          {day.entries.map((a) => (
            <View
              key={a.id}
              className="rounded-md border border-border/40 bg-background px-3 py-2 gap-0.5"
            >
              <View className="flex-row items-center justify-between">
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-[11px] text-foreground"
                >
                  {prettifyAction(a.action)}
                </Text>
                <Text className="text-[9px] text-muted-foreground">
                  {formatTime(a.createdAt)}
                </Text>
              </View>
              {a.actorName ? (
                <Text className="text-[10px] text-muted-foreground">{a.actorName}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Composer (shared) ───────────────────────────────────────────────────────

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  t,
}: {
  value: string;
  onChange(v: string): void;
  onSend(): void;
  disabled?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <View className="flex-row items-center gap-2 border-t border-border/40 p-2">
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={t('composerPlaceholder')}
        placeholderTextColor={colors.mutedForeground}
        style={{ fontFamily: fonts.regular }}
        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        multiline
      />
      <Pressable
        onPress={onSend}
        disabled={disabled || !value.trim()}
        className={`rounded-md p-2 ${
          disabled || !value.trim() ? 'bg-secondary' : 'bg-cyan'
        }`}
      >
        <Send size={14} color={!value.trim() || disabled ? colors.mutedForeground : colors.background} />
      </Pressable>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function groupByDay(entries: ActivityLogEntry[]): { label: string; entries: ActivityLogEntry[] }[] {
  const byDay = new Map<string, ActivityLogEntry[]>();
  for (const e of entries) {
    const date = new Date(e.createdAt);
    const key = isNaN(date.getTime()) ? 'other' : date.toDateString();
    const bucket = byDay.get(key) ?? [];
    bucket.push(e);
    byDay.set(key, bucket);
  }
  return Array.from(byDay.entries()).map(([label, items]) => ({ label, entries: items }));
}

function prettifyAction(action: string): string {
  const lower = action.toLowerCase();
  if (lower === 'document.updated') return 'Actualizó el documento';
  if (lower === 'document.created') return 'Creó el documento';
  if (lower === 'brick.created') return 'Añadió un bloque';
  if (lower === 'brick.updated') return 'Actualizó un bloque';
  if (lower === 'brick.deleted') return 'Eliminó un bloque';
  if (lower === 'document.commented') return 'Comentó';
  return action.replace(/\./g, ' ').replace(/_/g, ' ');
}
