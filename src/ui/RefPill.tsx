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

export function RefPill({
  type,
  name,
  onPress,
}: {
  type: RefType;
  name: string;
  onPress?: () => void;
}) {
  const color = COLORS[type] ?? COLORS.ext;
  const Icon = ICONS[type] ?? Puzzle;
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderRadius: 6,
          borderWidth: 1,
          backgroundColor: color + '1a',
          borderColor: color + '33',
        }}
      >
        <Icon size={12} color={color} />
        <Text style={{ color, fontSize: 13, fontWeight: '500' }}>{name}</Text>
      </View>
    </Pressable>
  );
}
