import { Pressable, Text, View } from 'react-native';
import {
  Calendar,
  Database,
  FileText,
  GitBranch,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Puzzle,
  User,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * RN port of the frontend RefPill — same type→color/icon palette
 * (Killio-Frontend src/components/ui/ref-pill.tsx) so inline references render
 * identically in chat.
 *
 * Prop parity with web:
 *   - type, id, name, label, onPress (web: onClick)
 *   - workspaceUsers, workspaceName, teamId, provider, extKind are accepted
 *     for signature compat but only `provider`/`extKind` are read on mobile —
 *     the web user-card popover is too heavy for the inline RN cell. Tap a
 *     user pill and the parent's onReferencePress decides where to go.
 */
export type RefType =
  | 'doc'
  | 'board'
  | 'mesh'
  | 'card'
  | 'user'
  | 'deep'
  | 'mention'
  | 'room'
  | 'thread'
  | 'transcript'
  | 'event'
  | 'ext';

const COLORS: Record<string, string> = {
  doc: '#3b82f6',
  board: '#a855f7',
  mesh: '#6366f1',
  card: '#10b981',
  user: '#f5f5f5',
  deep: '#f59e0b',
  mention: '#22d3ee',
  room: '#14b8a6',
  thread: '#06b6d4',
  transcript: '#8b5cf6',
  event: '#f97316',
  ext: '#a1a1a1',
};

const ICONS: Record<string, LucideIcon> = {
  doc: FileText,
  board: LayoutDashboard,
  mesh: LayoutDashboard,
  card: Hash,
  user: User,
  deep: Database,
  mention: Hash,
  room: MessageSquare,
  thread: GitBranch,
  transcript: MessageSquare,
  event: Calendar,
  ext: Puzzle,
};

export interface RefPillProps {
  type: RefType;
  name: string;
  /** Underlying id of the entity. Surfaced to onPress consumers. */
  id?: string;
  /** Optional secondary line under the name (web parity — e.g. folder path). */
  label?: string;
  onPress?: () => void;
  // Mobile: accepted for signature parity with web `RefPill`, currently unused
  // because the RN popover isn't worth the cost inline. Parents read `id` and
  // route to `/d/<id>` etc. themselves.
  workspaceUsers?: unknown[];
  workspaceName?: string;
  teamId?: string;
  /** Extension refs only. */
  provider?: string;
  extKind?: string;
}

export function RefPill({
  type,
  name,
  id: _id,
  label,
  onPress,
  workspaceUsers: _workspaceUsers,
  workspaceName: _workspaceName,
  teamId: _teamId,
  provider: _provider,
  extKind: _extKind,
}: RefPillProps) {
  const color = COLORS[type] ?? COLORS.ext;
  const Icon = ICONS[type] ?? Puzzle;
  // When the caller supplies a `label`, render a two-line pill so the
  // secondary context (folder path, board name) shows up just like the web
  // hover state — but inline so it's visible without a hover gesture.
  const hasLabel = !!label && label.trim().length > 0 && label !== name;
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 7,
          paddingVertical: hasLabel ? 3 : 2,
          borderRadius: 6,
          borderWidth: 1,
          backgroundColor: color + '1a',
          borderColor: color + '33',
        }}
      >
        <Icon size={12} color={color} />
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color, fontSize: 13, fontWeight: '500' }} numberOfLines={1}>
            {name}
          </Text>
          {hasLabel ? (
            <Text
              style={{ color: color, opacity: 0.7, fontSize: 10 }}
              numberOfLines={1}
            >
              {label}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
