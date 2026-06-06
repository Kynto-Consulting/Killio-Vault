import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Calendar as CalendarIcon,
  FileText,
  Folder as FolderIcon,
  GitBranch,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Search,
  User as UserIcon,
  X,
  type LucideIcon,
} from 'lucide-react-native';

import { fonts } from '../theme/fonts';
import { colors } from '../theme/theme';
import { useTranslations } from '../i18n';
import type {
  MentionType,
  PickerActiveBrick,
  PickerBoard,
  PickerCard,
  PickerDocument,
  PickerFolder,
  PickerUser,
  ReferencePickerSelection,
} from '../types/picker';
import { listDocuments } from '../core/api/documents.client';
import { listTeamBoards } from '../core/api/boards.client';
import { listTeamMembers } from '../core/api/teams.client';

/**
 * Mobile-adapted reference picker. Mirrors the web
 * `ReferencePicker` (Killio-Frontend/src/components/documents/reference-picker.tsx)
 * search + categorise + insert flow, but as a full-screen `Modal` driven by
 * native primitives (TextInput + FlatList) instead of a floating popover.
 *
 * Token format matches the web exactly: `@[type:id:Display Name]`. The
 * RichText parser accepts both `@[type:id|Name]` and `@[type:id:Name]` so
 * either shape round-trips.
 *
 * Mobile UX deviations from web (// Mobile: …):
 * - Full-screen Modal instead of a popover next to the cursor (RN doesn't
 *   know where the cursor is positioned on-screen reliably across keyboards).
 * - No keyboard-driven row navigation — tap to pick, swipe / scroll to browse.
 * - Single search box filters across ALL allowed categories at once; the
 *   chip row lets you scope down. Web has a deeper nested mode for "local
 *   bricks / doc bricks / mesh bricks" which is out of scope for v1 — Vault
 *   wires brick-level deep refs separately via the `$[…]` / `#[…]` tokens.
 * - Integrations / extensions section is dropped on mobile until the mobile
 *   integrations surface exists.
 */

type Category = MentionType | 'all';

export interface ReferencePickerProps {
  visible: boolean;
  onClose(): void;
  onPick(sel: ReferencePickerSelection): void;
  /** Allowed mention categories. Defaults to every supported kind. */
  allowed?: MentionType[];
  /** In-memory candidate lists. Empty array = fall through to API fetch. */
  documents?: PickerDocument[];
  boards?: PickerBoard[];
  cards?: PickerCard[];
  users?: PickerUser[];
  folders?: PickerFolder[];
  activeBricks?: PickerActiveBrick[];
  /** When set, empty in-memory lists trigger a lazy backend fetch. */
  teamId?: string;
  /** Optional initial query (e.g. typed after `@`). */
  initialQuery?: string;
}

interface PickerRow {
  key: string;
  mentionType: MentionType;
  id: string;
  name: string;
  /** Secondary line (folder path, board name, email…). */
  sub?: string;
  search: string;
}

const ALL_CATEGORIES: MentionType[] = [
  'doc',
  'board',
  'card',
  'user',
  'folder',
  'mesh',
  'room',
];

const CATEGORY_ICONS: Record<MentionType, LucideIcon> = {
  doc: FileText,
  board: LayoutDashboard,
  mesh: LayoutDashboard,
  card: Hash,
  user: UserIcon,
  folder: FolderIcon,
  room: MessageSquare,
  thread: GitBranch,
  transcript: MessageSquare,
  event: CalendarIcon,
};

const CATEGORY_COLORS: Record<MentionType, string> = {
  doc: '#3b82f6',
  board: '#a855f7',
  mesh: '#6366f1',
  card: '#10b981',
  user: '#f5f5f5',
  folder: '#fbbf24',
  room: '#14b8a6',
  thread: '#06b6d4',
  transcript: '#8b5cf6',
  event: '#f97316',
};

function buildToken(type: MentionType, id: string, label: string): string {
  // Keep the web's `@[type:id:Label]` shape — RichText parser also handles
  // a pipe separator for safety, but colon is the canonical form.
  return `@[${type}:${id}:${label}]`;
}

export function ReferencePicker({
  visible,
  onClose,
  onPick,
  allowed,
  documents,
  boards,
  cards,
  users,
  folders,
  activeBricks: _activeBricks,
  teamId,
  initialQuery = '',
}: ReferencePickerProps) {
  const t = useTranslations('referencePicker');
  const tFallback = useTranslations('fallback');
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<Category>('all');

  // Lazy-fetched fallbacks. Only fire when the caller didn't pass anything
  // for that category AND a teamId is available.
  const [remoteDocs, setRemoteDocs] = useState<PickerDocument[] | null>(null);
  const [remoteBoards, setRemoteBoards] = useState<PickerBoard[] | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<PickerUser[] | null>(null);
  const [loading, setLoading] = useState<{
    doc: boolean;
    board: boolean;
    user: boolean;
  }>({ doc: false, board: false, user: false });

  const allowedSet = useMemo(() => {
    const list = allowed ?? ALL_CATEGORIES;
    return new Set<MentionType>(list);
  }, [allowed]);

  useEffect(() => {
    if (visible) {
      setQuery(initialQuery);
      setCategory('all');
    }
  }, [visible, initialQuery]);

  // Lazy fetch documents.
  useEffect(() => {
    if (!visible || !teamId) return;
    if (!allowedSet.has('doc')) return;
    if (documents && documents.length > 0) return;
    if (remoteDocs !== null) return;
    let alive = true;
    setLoading((s) => ({ ...s, doc: true }));
    listDocuments(teamId)
      .then((docs) => {
        if (!alive) return;
        setRemoteDocs(docs.map((d) => ({ id: d.id, title: d.title })));
      })
      .catch(() => {
        if (alive) setRemoteDocs([]);
      })
      .finally(() => {
        if (alive) setLoading((s) => ({ ...s, doc: false }));
      });
    return () => {
      alive = false;
    };
  }, [visible, teamId, documents, allowedSet, remoteDocs]);

  // Lazy fetch boards.
  useEffect(() => {
    if (!visible || !teamId) return;
    if (!allowedSet.has('board') && !allowedSet.has('mesh')) return;
    if (boards && boards.length > 0) return;
    if (remoteBoards !== null) return;
    let alive = true;
    setLoading((s) => ({ ...s, board: true }));
    listTeamBoards(teamId)
      .then((bs) => {
        if (!alive) return;
        setRemoteBoards(
          bs.map((b) => ({ id: b.id, name: b.name, boardType: b.boardType })),
        );
      })
      .catch(() => {
        if (alive) setRemoteBoards([]);
      })
      .finally(() => {
        if (alive) setLoading((s) => ({ ...s, board: false }));
      });
    return () => {
      alive = false;
    };
  }, [visible, teamId, boards, allowedSet, remoteBoards]);

  // Lazy fetch users.
  useEffect(() => {
    if (!visible || !teamId) return;
    if (!allowedSet.has('user')) return;
    if (users && users.length > 0) return;
    if (remoteUsers !== null) return;
    let alive = true;
    setLoading((s) => ({ ...s, user: true }));
    listTeamMembers(teamId)
      .then((ms) => {
        if (!alive) return;
        setRemoteUsers(
          ms.map((m) => ({
            id: m.id,
            name: m.displayName || m.name || m.email,
            alias: m.alias,
            email: m.email || m.primaryEmail,
            avatarUrl: m.avatarUrl,
          })),
        );
      })
      .catch(() => {
        if (alive) setRemoteUsers([]);
      })
      .finally(() => {
        if (alive) setLoading((s) => ({ ...s, user: false }));
      });
    return () => {
      alive = false;
    };
  }, [visible, teamId, users, allowedSet, remoteUsers]);

  const effectiveDocs = documents && documents.length > 0 ? documents : (remoteDocs ?? []);
  const effectiveBoards = boards && boards.length > 0 ? boards : (remoteBoards ?? []);
  const effectiveUsers = users && users.length > 0 ? users : (remoteUsers ?? []);

  const rows: PickerRow[] = useMemo(() => {
    const acc: PickerRow[] = [];
    const q = query.trim().toLowerCase();

    const push = (
      r: PickerRow,
    ) => {
      if (category !== 'all' && r.mentionType !== category) return;
      if (!allowedSet.has(r.mentionType)) return;
      if (q && !r.search.includes(q)) return;
      acc.push(r);
    };

    for (const d of effectiveDocs) {
      push({
        key: `doc:${d.id}`,
        mentionType: 'doc',
        id: d.id,
        name: d.title || tFallback('document'),
        sub: d.folderPath,
        search: `doc document ${d.title} ${d.folderPath ?? ''}`.toLowerCase(),
      });
    }
    for (const b of effectiveBoards) {
      const isMesh = b.boardType === 'mesh';
      push({
        key: `${isMesh ? 'mesh' : 'board'}:${b.id}`,
        mentionType: isMesh ? 'mesh' : 'board',
        id: b.id,
        name: b.name,
        search: `${isMesh ? 'mesh' : 'board'} ${b.name}`.toLowerCase(),
      });
    }
    for (const c of cards ?? []) {
      push({
        key: `card:${c.id}`,
        mentionType: 'card',
        id: c.id,
        name: c.title,
        sub: [c.boardName, c.listName].filter(Boolean).join(' · ') || undefined,
        search: `card ${c.title} ${c.boardName ?? ''} ${c.listName ?? ''}`.toLowerCase(),
      });
    }
    for (const u of effectiveUsers) {
      const display = u.alias || u.name || u.email || 'User';
      push({
        key: `user:${u.id}`,
        mentionType: 'user',
        id: u.id,
        name: display,
        sub: u.email && u.email !== display ? u.email : undefined,
        search: `user ${display} ${u.email ?? ''}`.toLowerCase(),
      });
    }
    for (const f of folders ?? []) {
      push({
        key: `folder:${f.id}`,
        mentionType: 'folder',
        id: f.id,
        name: f.name,
        search: `folder ${f.name}`.toLowerCase(),
      });
    }
    return acc;
  }, [
    effectiveDocs,
    effectiveBoards,
    cards,
    effectiveUsers,
    folders,
    query,
    category,
    allowedSet,
    tFallback,
  ]);

  const visibleCategories = useMemo<MentionType[]>(
    () => ALL_CATEGORIES.filter((c) => allowedSet.has(c)),
    [allowedSet],
  );

  const isLoading = loading.doc || loading.board || loading.user;

  const handlePick = (row: PickerRow) => {
    const sel: ReferencePickerSelection = {
      token: buildToken(row.mentionType, row.id, row.name),
      label: row.name,
      id: row.id,
      mentionType: row.mentionType,
      category: 'mention',
    };
    onPick(sel);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Top bar: search input + close */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              borderRadius: 10,
              backgroundColor: colors.surfaceAlt,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Search size={14} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                fontFamily: fonts.regular,
                fontSize: 14,
                color: colors.foreground,
                paddingVertical: 8,
              }}
            />
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={20} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Category chips. */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <CategoryChip
            label={t('category.all')}
            active={category === 'all'}
            onPress={() => setCategory('all')}
          />
          {visibleCategories.map((c) => (
            <CategoryChip
              key={c}
              label={t(`category.${c}`)}
              active={category === c}
              onPress={() => setCategory(c)}
              icon={CATEGORY_ICONS[c]}
              color={CATEGORY_COLORS[c]}
            />
          ))}
        </View>

        {/* Result list. */}
        {isLoading && rows.length === 0 ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <ActivityIndicator color={colors.cyan} />
          </View>
        ) : rows.length === 0 ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: fonts.regular }}>
              {t('empty')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.4 }} />
            )}
            renderItem={({ item }) => (
              <PickerRowItem row={item} onPress={() => handlePick(item)} />
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function CategoryChip({
  label,
  active,
  onPress,
  icon: Icon,
  color,
}: {
  label: string;
  active: boolean;
  onPress(): void;
  icon?: LucideIcon;
  color?: string;
}) {
  const tint = color ?? colors.cyan;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        backgroundColor: active ? tint + '22' : colors.surfaceAlt,
        borderColor: active ? tint + '66' : colors.border,
      }}
    >
      {Icon ? <Icon size={11} color={active ? tint : colors.mutedForeground} /> : null}
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 11,
          color: active ? tint : colors.mutedForeground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PickerRowItem({ row, onPress }: { row: PickerRow; onPress(): void }) {
  const Icon = CATEGORY_ICONS[row.mentionType] ?? FileText;
  const color = CATEGORY_COLORS[row.mentionType] ?? colors.cyan;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: color + '1a',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={14} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.medium,
            fontSize: 14,
            color: colors.foreground,
          }}
        >
          {row.name}
        </Text>
        {row.sub ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.regular,
              fontSize: 11,
              color: colors.mutedForeground,
            }}
          >
            {row.sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
