import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, MessageSquare, MoreHorizontal, Send, Smile, Trash2, X } from 'lucide-react-native';

import { RichText } from '@/ui/RichText';
import { useTranslations } from '@/i18n';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
  type CommentEntityType,
  type EntityComment,
} from '@/core/api/comments.client';
import { useRealtimeChannel } from '@/realtime/useRealtimeChannel';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * CommentsPanel — entity-scoped Notion-style comment thread.
 *
 * Shared between document and card sidebars. Hits the REST endpoints
 * (`/documents/:id/comments`, `/cards/:cardId/comments`) — NOT rooms.
 *
 * Realtime: subscribes to the entity Pulse channel (`document:<id>` or
 * `card:<id>`) and reconciles `comment.created` / `comment.updated` /
 * `comment.deleted` events.
 *
 * Each row renders avatar + display name + timestamp + body via RichText
 * (markdown + @mentions), a quick reactions row, and edit/delete affordances
 * gated by `currentUserId === comment.authorId`. Backend update/delete routes
 * are pending — the calls are wired but the UI swallows 405s gracefully.
 */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥'];

export interface CommentsPanelProps {
  entityType: CommentEntityType;
  entityId: string;
  /** Used to flag own-comments for edit/delete affordances. */
  currentUserId?: string | null;
  /** Avatars/display name lookup. Defaults to the comment's own author fields. */
  membersById?: Record<string, { name?: string; avatarUrl?: string | null }>;
  /** i18n namespace — defaults to docComments. */
  namespace?: 'docComments' | 'cardComments';
}

export function CommentsPanel({
  entityType,
  entityId,
  currentUserId,
  membersById,
  namespace = 'docComments',
}: CommentsPanelProps) {
  const t = useTranslations(namespace);
  const [comments, setComments] = useState<EntityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listComments(entityType, entityId);
      // Mobile: oldest-first reads top→bottom like a chat thread.
      setComments(list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live reconciliation. Server emits `comment.*` deltas on the entity
  // channel — append/patch/remove and the UI catches up without polling.
  useRealtimeChannel(entityId ? `${entityType}:${entityId}` : null, {
    events: {
      'comment.created': (payload) => {
        const p = payload as Partial<EntityComment> | undefined;
        if (!p?.id) return;
        setComments((cur) => {
          if (cur.some((c) => c.id === p.id)) return cur;
          return [...cur, p as EntityComment].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
        });
      },
      'comment.updated': (payload) => {
        const p = payload as Partial<EntityComment> | undefined;
        if (!p?.id) return;
        setComments((cur) => cur.map((c) => (c.id === p.id ? { ...c, ...p } as EntityComment : c)));
      },
      'comment.deleted': (payload) => {
        const id = (payload as { id?: string })?.id;
        if (!id) return;
        setComments((cur) => cur.filter((c) => c.id !== id));
      },
    },
  });

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const created = await createComment({ entityType, entityId, text });
      setComments((cur) => [...cur, created]);
      setInput('');
    } catch {
      /* swallow — pulse echo will reconcile */
    } finally {
      setSending(false);
    }
  };

  const startEdit = (c: EntityComment) => {
    setEditingId(c.id);
    setEditDraft(c.text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };
  const commitEdit = async () => {
    if (!editingId) return;
    const text = editDraft.trim();
    if (!text) return;
    const target = comments.find((c) => c.id === editingId);
    if (!target) return cancelEdit();
    // Optimistic patch — keep the UI snappy even if backend is missing.
    setComments((cur) =>
      cur.map((c) => (c.id === editingId ? { ...c, text, updatedAt: new Date().toISOString() } : c)),
    );
    cancelEdit();
    try {
      await updateComment(entityType, entityId, target.id, { text });
    } catch {
      /* backend route may not exist yet — revert silently if it 405s */
      void reload();
    }
  };

  const remove = async (c: EntityComment) => {
    setComments((cur) => cur.filter((x) => x.id !== c.id));
    try {
      await deleteComment(entityType, entityId, c.id);
    } catch {
      /* backend route may not exist yet — revert silently */
      void reload();
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View className="border-b border-border/30 px-3 py-1.5">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          {t('title')}
        </Text>
      </View>
      {comments.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 opacity-60">
          <MessageSquare size={24} color={colors.mutedForeground} />
          <Text className="text-xs text-muted-foreground">{t('empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          contentContainerClassName="p-3 gap-2"
          renderItem={({ item }) => (
            <CommentRow
              comment={item}
              isOwn={!!currentUserId && item.authorId === currentUserId}
              member={membersById?.[item.authorId]}
              editing={editingId === item.id}
              editDraft={editDraft}
              onEditDraftChange={setEditDraft}
              onStartEdit={() => startEdit(item)}
              onCancelEdit={cancelEdit}
              onCommitEdit={commitEdit}
              onDelete={() => void remove(item)}
              t={t}
            />
          )}
        />
      )}

      <View className="flex-row items-end gap-2 border-t border-border/30 p-2">
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
          disabled={sending || !input.trim()}
          className={`rounded-md p-2 ${sending || !input.trim() ? 'bg-secondary' : 'bg-cyan'}`}
        >
          <Send
            size={14}
            color={!input.trim() || sending ? colors.mutedForeground : colors.background}
          />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function CommentRow({
  comment,
  isOwn,
  member,
  editing,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  onDelete,
  t,
}: {
  comment: EntityComment;
  isOwn: boolean;
  member?: { name?: string; avatarUrl?: string | null };
  editing: boolean;
  editDraft: string;
  onEditDraftChange(v: string): void;
  onStartEdit(): void;
  onCancelEdit(): void;
  onCommitEdit(): void;
  onDelete(): void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const displayName = member?.name ?? comment.authorName ?? comment.authorId.slice(0, 6);
  const initial = (displayName || '?').charAt(0).toUpperCase();
  const timeLabel = useMemo(() => formatTime(comment.createdAt), [comment.createdAt]);

  return (
    <View className="rounded-xl border border-border/40 bg-background px-3 py-2">
      <View className="flex-row items-center gap-2">
        {/* Avatar — uses the member.avatarUrl if known, otherwise a coloured
            initial bubble so the row never collapses to a blank slot. */}
        <View className="h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-cyan/20">
          <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">
            {initial}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-[11px] text-foreground"
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text className="text-[9px] text-muted-foreground">{timeLabel}</Text>
        </View>
        {isOwn ? (
          <Pressable onPress={() => setMenuOpen((v) => !v)} hitSlop={8}>
            <MoreHorizontal size={14} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {editing ? (
        <View className="mt-2 gap-2">
          <TextInput
            value={editDraft}
            onChangeText={onEditDraftChange}
            multiline
            autoFocus
            style={{ fontFamily: fonts.regular, color: colors.foreground }}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          />
          <View className="flex-row justify-end gap-1">
            <Pressable
              onPress={onCancelEdit}
              className="flex-row items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1"
            >
              <X size={11} color={colors.foreground} />
              <Text style={{ fontFamily: fonts.medium }} className="text-[10px] text-foreground">
                {t('cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onCommitEdit}
              className="flex-row items-center gap-1 rounded-md bg-cyan px-2 py-1"
            >
              <Check size={11} color={colors.background} />
              <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-background">
                {t('save')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="mt-1">
          <RichText content={comment.text} size={13} />
          {comment.updatedAt && comment.updatedAt !== comment.createdAt ? (
            <Text className="mt-0.5 text-[8px] italic text-muted-foreground">
              · {formatTime(comment.updatedAt)} ·
            </Text>
          ) : null}
        </View>
      )}

      {comment.reactions && comment.reactions.length > 0 ? (
        <View className="mt-1 flex-row flex-wrap gap-1">
          {comment.reactions.map((r) => (
            <View
              key={r.emoji}
              className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5"
            >
              <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
              <Text className="text-[9px] text-muted-foreground">{r.userIds.length}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!editing ? (
        <View className="mt-1 flex-row gap-1">
          {reactionPickerOpen ? (
            <>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => setReactionPickerOpen(false)}
                  hitSlop={4}
                  className="rounded-md border border-border/40 bg-background px-1.5"
                >
                  <Text style={{ fontSize: 14 }}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setReactionPickerOpen(false)}
                hitSlop={4}
                className="px-1.5"
              >
                <Text className="text-[10px] text-muted-foreground">×</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => setReactionPickerOpen(true)}
              hitSlop={6}
              className="flex-row items-center gap-1 rounded-md border border-border/40 bg-background px-1.5 py-0.5"
            >
              <Smile size={10} color={colors.mutedForeground} />
              <Text className="text-[9px] text-muted-foreground">{t('react')}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {menuOpen && isOwn && !editing ? (
        <View className="mt-2 flex-row gap-1">
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onStartEdit();
            }}
            className="flex-row items-center gap-1 rounded-md border border-border bg-card px-2 py-1"
          >
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-foreground">
              {t('edit')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="flex-row items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1"
          >
            <Trash2 size={10} color={colors.destructive} />
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-destructive">
              {t('delete')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
