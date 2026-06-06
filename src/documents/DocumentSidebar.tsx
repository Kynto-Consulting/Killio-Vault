import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Bot, History, MessageSquare, X } from 'lucide-react-native';

import { useTranslations } from '@/i18n';
import { useAuth } from '@/core/auth/AuthContext';
import { listTeamMembers, type TeamMember } from '@/core/api/teams.client';
import { CopilotPanel } from './panels/CopilotPanel';
import { CommentsPanel } from './panels/CommentsPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * DocumentSidebar — mobile bottom-sheet host for the 3 entity panels.
 *
 * Web parity: the `document-comments-drawer.tsx` side-drawer with 3 tabs
 * (Copilot / Comments / Activity). On mobile we slide it up from the bottom
 * as a 90%-height modal instead of a right-side drawer, since side drawers
 * are awkward on phones. The parent screen owns visibility + the active tab
 * via the `open` + `initialTab` props.
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
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Mobile: prefetch team members once the sheet opens so avatars + display
  // names render in the comments + activity panels without each one fetching.
  useEffect(() => {
    if (!open || !teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await listTeamMembers(teamId);
        if (!cancelled) setMembers(m);
      } catch {
        if (!cancelled) setMembers([]);
      }
      try {
        // Identify the current user so the comments panel can offer edit/delete
        // on own comments. We use the /auth/me endpoint via the existing client.
        const { me: meCall } = await import('@/core/api/auth.client');
        const u = (await meCall()) as { id?: string } | undefined;
        if (!cancelled) setMe(u?.id ?? null);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, teamId]);

  const membersById = useMemo(() => {
    const map: Record<string, { name?: string; avatarUrl?: string | null }> = {};
    for (const m of members) {
      const name = m.alias ?? m.workspaceAlias ?? m.displayName ?? m.name ?? m.email ?? m.id;
      map[m.id] = { name, avatarUrl: m.avatarUrl };
    }
    return map;
  }, [members]);

  if (!open) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Mobile: bottom-sheet — 90% height, slide up. Tap the dimmed top to
          dismiss, X button in header as backup. */}
      <View className="flex-1 bg-black/60">
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        <View
          style={{ height: '90%' }}
          className="rounded-t-2xl border-t border-border bg-card"
        >
          {/* Drag handle (decorative — no actual drag gesture wired yet) */}
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>

          {/* Header with doc title + close */}
          <View className="flex-row items-center justify-between border-b border-border/40 px-3 pb-2">
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

          {/* Panel content. Each panel owns its own scroll container. */}
          <View style={{ flex: 1 }}>
            {tab === 'copilot' && teamId ? (
              <CopilotPanel
                teamId={teamId}
                entityType="document"
                entityId={documentId}
                namespace="docCopilot"
              />
            ) : null}
            {tab === 'comments' ? (
              <CommentsPanel
                entityType="document"
                entityId={documentId}
                currentUserId={me}
                membersById={membersById}
                namespace="docComments"
              />
            ) : null}
            {tab === 'activity' ? (
              <ActivityPanel
                scope="document"
                entityId={documentId}
                membersById={membersById}
                namespace="docActivity"
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

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
