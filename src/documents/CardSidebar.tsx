import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Bot, FileText, History, MessageSquare } from 'lucide-react-native';

import { useTranslations } from '@/i18n';
import { useAuth } from '@/core/auth/AuthContext';
import { listTeamMembers, type TeamMember } from '@/core/api/teams.client';
import { CopilotPanel } from './panels/CopilotPanel';
import { CommentsPanel } from './panels/CommentsPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * CardSidebar — 4-tab content host for the card detail bottom-sheet.
 *
 * Mirrors the web `card-detail-panel` 3-pane right column. On mobile the card
 * detail itself is already a bottom-sheet so we expose this as an inline tab
 * switcher embedded into the same sheet:
 *
 *   Detail  |  Copilot  |  Comments  |  Activity
 *
 * The `Detail` tab is owned by the caller (existing CardDetailModal form);
 * this component renders the other 3 and exposes its tab state through
 * `activeTab` + `setActiveTab` controlled props so the parent can avoid
 * remounting the form when the user switches away and back.
 */
export type CardSidebarTab = 'detail' | 'copilot' | 'comments' | 'activity';

export interface CardSidebarProps {
  cardId: string;
  /** Currently-active tab (controlled). */
  activeTab: CardSidebarTab;
  onChangeTab(next: CardSidebarTab): void;
  /** Content rendered when `activeTab === 'detail'` — the existing form. */
  detailContent: React.ReactNode;
}

export function CardSidebar({ cardId, activeTab, onChangeTab, detailContent }: CardSidebarProps) {
  const t = useTranslations('cardSidebar');
  const { activeTeam } = useAuth();
  const teamId = activeTeam?.id ?? null;
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [me, setMe] = useState<string | null>(null);

  // Mobile: load team context lazily once any tab other than `detail` is
  // selected. Avoids the cost on cards that the user only glances at.
  useEffect(() => {
    if (activeTab === 'detail' || !teamId) return;
    let cancelled = false;
    (async () => {
      if (members.length === 0) {
        try {
          const m = await listTeamMembers(teamId);
          if (!cancelled) setMembers(m);
        } catch {
          if (!cancelled) setMembers([]);
        }
      }
      if (me == null) {
        try {
          const { me: meCall } = await import('@/core/api/auth.client');
          const u = (await meCall()) as { id?: string } | undefined;
          if (!cancelled) setMe(u?.id ?? null);
        } catch {
          if (!cancelled) setMe(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, teamId, members.length, me]);

  const membersById = useMemo(() => {
    const map: Record<string, { name?: string; avatarUrl?: string | null }> = {};
    for (const m of members) {
      const name = m.alias ?? m.workspaceAlias ?? m.displayName ?? m.name ?? m.email ?? m.id;
      map[m.id] = { name, avatarUrl: m.avatarUrl };
    }
    return map;
  }, [members]);

  return (
    <View style={{ flex: 1 }}>
      {/* Tab bar — pinned at top so the user can flip between detail and
          collaboration without scrolling. */}
      <View className="flex-row border-b border-border/40">
        <CardTabButton icon={FileText} label={t('tabDetail')} active={activeTab === 'detail'} onPress={() => onChangeTab('detail')} />
        <CardTabButton icon={Bot} label={t('tabCopilot')} active={activeTab === 'copilot'} onPress={() => onChangeTab('copilot')} />
        <CardTabButton icon={MessageSquare} label={t('tabComments')} active={activeTab === 'comments'} onPress={() => onChangeTab('comments')} />
        <CardTabButton icon={History} label={t('tabActivity')} active={activeTab === 'activity'} onPress={() => onChangeTab('activity')} />
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'detail' ? detailContent : null}
        {activeTab === 'copilot' && teamId ? (
          <CopilotPanel
            teamId={teamId}
            entityType="card"
            entityId={cardId}
            namespace="cardCopilot"
          />
        ) : null}
        {activeTab === 'comments' ? (
          <CommentsPanel
            entityType="card"
            entityId={cardId}
            currentUserId={me}
            membersById={membersById}
            namespace="cardComments"
          />
        ) : null}
        {activeTab === 'activity' ? (
          <ActivityPanel
            scope="card"
            entityId={cardId}
            membersById={membersById}
            namespace="cardActivity"
          />
        ) : null}
      </View>
    </View>
  );
}

function CardTabButton({
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
      className={`flex-1 flex-row items-center justify-center gap-1 py-2.5 ${
        active ? 'border-b-2 border-cyan' : ''
      }`}
    >
      <Icon size={11} color={active ? colors.cyan : colors.mutedForeground} />
      <Text
        style={{ fontFamily: active ? fonts.semibold : fonts.medium }}
        className={`text-[10px] ${active ? 'text-cyan' : 'text-muted-foreground'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
