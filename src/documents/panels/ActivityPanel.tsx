import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import {
  Archive,
  CheckCircle2,
  Edit3,
  FilePlus,
  History,
  Layers,
  MessageSquare,
  Move,
  Plus,
  RotateCcw,
  Share2,
  Tag as TagIcon,
  Trash2,
  UserPlus,
  UserMinus,
  type LucideIcon,
} from 'lucide-react-native';

import { useTranslations } from '@/i18n';
import {
  listCardActivity,
  listDocumentActivity,
  type ActivityLogEntry,
} from '@/core/api/activity.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * ActivityPanel — reverse-chronological activity log scoped to a document
 * or a card. Each row renders:
 *
 *   [type icon] [actor avatar] [actor name] [action message] [time]
 *
 * Messages are generated client-side from `(action, payload)` using the same
 * pattern as Vault's teams.client.ts activity messages: an action→i18n-key
 * map with `{{value}}` interpolation. Unknown actions fall back to the
 * action string itself so nothing ever shows blank.
 */
export type ActivityScope = 'document' | 'card';

export interface ActivityPanelProps {
  scope: ActivityScope;
  entityId: string;
  /** Lookup for the actor avatar/display name; falls back to actorName / id. */
  membersById?: Record<string, { name?: string; avatarUrl?: string | null }>;
  /** i18n namespace — docActivity (doc) or cardActivity (card). */
  namespace?: 'docActivity' | 'cardActivity';
}

interface ActionMapEntry {
  icon: LucideIcon;
  i18nKey: string;
  /** When set, the action interpolates `{{value}}` from this payload path. */
  valuePath?: string;
}

/** action.id → icon + i18n key for the doc scope. */
const DOC_ACTION_MAP: Record<string, ActionMapEntry> = {
  'document.created': { icon: FilePlus, i18nKey: 'documentCreated' },
  'document.updated': { icon: Edit3, i18nKey: 'documentUpdated' },
  'document.renamed': { icon: Edit3, i18nKey: 'documentRenamed' },
  'document.moved': { icon: Move, i18nKey: 'documentMoved' },
  'document.archived': { icon: Archive, i18nKey: 'documentArchived' },
  'document.restored': { icon: RotateCcw, i18nKey: 'documentRestored' },
  'document.shared': { icon: Share2, i18nKey: 'shared' },
  'document.commented': { icon: MessageSquare, i18nKey: 'commented' },
  'document.member_added': { icon: UserPlus, i18nKey: 'memberAdded' },
  'document.member_removed': { icon: UserMinus, i18nKey: 'memberRemoved' },
  'brick.created': { icon: Plus, i18nKey: 'brickAdded' },
  'brick.updated': { icon: Edit3, i18nKey: 'brickUpdated' },
  'brick.deleted': { icon: Trash2, i18nKey: 'brickRemoved' },
  'brick.reordered': { icon: Layers, i18nKey: 'brickReordered' },
};

/** action.id → icon + i18n key for the card scope. */
const CARD_ACTION_MAP: Record<string, ActionMapEntry> = {
  'card.created': { icon: FilePlus, i18nKey: 'cardCreated' },
  'card.updated': { icon: Edit3, i18nKey: 'cardUpdated' },
  'card.moved': { icon: Move, i18nKey: 'cardMoved', valuePath: 'toListName' },
  'card.archived': { icon: Archive, i18nKey: 'cardArchived' },
  'card.restored': { icon: RotateCcw, i18nKey: 'cardRestored' },
  'card.commented': { icon: MessageSquare, i18nKey: 'cardCommented' },
  'card.tag_added': { icon: TagIcon, i18nKey: 'tagAdded', valuePath: 'tagName' },
  'card.tag_removed': { icon: TagIcon, i18nKey: 'tagRemoved', valuePath: 'tagName' },
  'card.assignee_added': { icon: UserPlus, i18nKey: 'assigneeAdded', valuePath: 'assigneeName' },
  'card.assignee_removed': { icon: UserMinus, i18nKey: 'assigneeRemoved', valuePath: 'assigneeName' },
  'card.status_changed': { icon: CheckCircle2, i18nKey: 'statusChanged', valuePath: 'status' },
  'card.priority_changed': { icon: CheckCircle2, i18nKey: 'priorityChanged', valuePath: 'priority' },
  'card.due_changed': { icon: CheckCircle2, i18nKey: 'dueDateChanged', valuePath: 'dueAt' },
  'card.start_changed': { icon: CheckCircle2, i18nKey: 'startDateChanged', valuePath: 'startAt' },
};

export function ActivityPanel({ scope, entityId, membersById, namespace }: ActivityPanelProps) {
  const ns = namespace ?? (scope === 'card' ? 'cardActivity' : 'docActivity');
  const t = useTranslations(ns);
  const [items, setItems] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = scope === 'card'
          ? await listCardActivity(entityId)
          : await listDocumentActivity(entityId);
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
  }, [scope, entityId]);

  const actionMap = scope === 'card' ? CARD_ACTION_MAP : DOC_ACTION_MAP;
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
        <Text className="text-xs text-muted-foreground">{t('empty')}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerClassName="p-3 gap-3">
      <View className="border-b border-border/30 pb-1">
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          {t('title')}
        </Text>
      </View>
      {grouped.map((day) => (
        <View key={day.label} className="gap-1.5">
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            {day.label}
          </Text>
          {day.entries.map((a) => (
            <ActivityRow
              key={a.id}
              entry={a}
              actionMap={actionMap}
              membersById={membersById}
              t={t}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ActivityRow({
  entry,
  actionMap,
  membersById,
  t,
}: {
  entry: ActivityLogEntry;
  actionMap: Record<string, ActionMapEntry>;
  membersById?: Record<string, { name?: string; avatarUrl?: string | null }>;
  t: ReturnType<typeof useTranslations>;
}) {
  const mapped = actionMap[entry.action];
  const Icon = mapped?.icon ?? History;
  const actor =
    (entry.actorId && membersById?.[entry.actorId]) ?? undefined;
  const actorName = actor?.name ?? entry.actorName ?? (entry.actorId ?? t('actor'));
  const initial = (actorName || '?').charAt(0).toUpperCase();

  // Message generation: walk the payload for the configured `valuePath` and
  // interpolate it via i18n {{value}}. Falls back to `actions.generic` when
  // the action isn't in the map (so unknown server events still render).
  const message = useMemo(() => {
    if (!mapped) return t('actions.generic');
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    let value: string | undefined;
    if (mapped.valuePath) {
      const v = payload[mapped.valuePath];
      if (typeof v === 'string') value = v;
      else if (v != null) value = String(v);
    }
    return t(`actions.${mapped.i18nKey}` as any, value ? { value } : undefined);
  }, [entry.payload, mapped, t]);

  const timeLabel = useMemo(() => formatTime(entry.createdAt), [entry.createdAt]);

  return (
    <View className="flex-row items-start gap-2 rounded-md border border-border/30 bg-background px-2.5 py-2">
      <View className="mt-0.5">
        <Icon size={13} color={colors.cyan} />
      </View>
      <View className="h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-cyan/20">
        <Text style={{ fontFamily: fonts.semibold }} className="text-[9px] text-cyan">
          {initial}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text className="text-[11px] text-foreground" numberOfLines={2}>
          <Text style={{ fontFamily: fonts.semibold }}>{actorName}</Text>
          <Text className="text-muted-foreground"> {message}</Text>
        </Text>
        <Text className="text-[9px] text-muted-foreground">{timeLabel}</Text>
      </View>
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
