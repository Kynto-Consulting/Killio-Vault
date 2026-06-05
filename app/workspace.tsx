import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, FileText, Kanban, Orbit, Plus, Workflow } from 'lucide-react-native';

import { Screen, Card, H1, Body, Label } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { useDocuments } from '@/documents/DocumentsProvider';
import { getTeamCatalog, type TeamCatalog } from '@/core/api/teams.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Workspace-mode home — a mobile-adapted snapshot of the active Killio
 * workspace. We surface the entities the user is most likely to want to
 * navigate into: documents (deep link to the bricks viewer/editor that
 * already exists at /document/[id]) and boards (kanban + mesh) grouped by
 * type. The full editing surface for boards/scripts is intentionally NOT
 * here yet — only the two views the user asked for ship in this iteration:
 * workspace main + documents.
 */
export default function WorkspaceHomeScreen() {
  const router = useRouter();
  const t = useTranslations('workspaceScreen');
  const { activeTeam } = useAuth();
  const docsApi = useDocuments();
  const [data, setData] = useState<TeamCatalog | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      setData(await getTeamCatalog(activeTeam.id));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const kanban = (data?.boards ?? []).filter((b) => b.boardType !== 'mesh');
  const meshes = (data?.boards ?? []).filter((b) => b.boardType === 'mesh');
  const docs = (data?.documents ?? []).slice(0, 8);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerClassName="px-5 pb-10 pt-4 gap-4"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.foreground}
          />
        }
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <H1>{activeTeam?.name ?? t('workspaceFallback')}</H1>
            <Body muted>
              {activeTeam?.isPersonal
                ? t('personal')
                : activeTeam?.planTier ?? t('workspaceLabel')}
            </Body>
          </View>
          <Pressable
            onPress={() =>
              docsApi.openCreateDocument({
                onCreated: (doc) =>
                  router.push({
                    pathname: '/document/[id]',
                    params: { id: doc.id, title: doc.title },
                  }),
              })
            }
            className="h-9 flex-row items-center gap-1 rounded-md bg-primary px-3"
          >
            <Plus size={13} color={colors.primaryForeground ?? '#171717'} />
            <Text
              style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
              className="text-xs"
            >
              {t('docButton')}
            </Text>
          </Pressable>
        </View>

        {/* Documents — primary entry point in workspace mode */}
        <Card>
          <View className="flex-row items-center justify-between">
            <Label>{t('recentDocs')}</Label>
            <Pressable
              hitSlop={6}
              onPress={() => router.push('/documents')}
              className="flex-row items-center gap-1"
            >
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-xs text-cyan"
              >
                {t('viewAll')}
              </Text>
              <ChevronRight size={12} color={colors.cyan} />
            </Pressable>
          </View>
          {docs.length === 0 ? (
            <Body muted>{t('noDocs')}</Body>
          ) : (
            <View className="gap-1">
              {docs.map((d) => (
                <Pressable
                  key={d.id}
                  onPress={() =>
                    router.push({
                      pathname: '/document/[id]',
                      params: { id: d.id, title: d.title },
                    })
                  }
                  className="flex-row items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 active:opacity-80"
                >
                  <FileText size={14} color={colors.mutedForeground} />
                  <Text
                    style={{ fontFamily: fonts.medium }}
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {d.title}
                  </Text>
                  <ChevronRight size={12} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        {/* Kanban boards — read-only summary for now */}
        <Card>
          <View className="flex-row items-center gap-2">
            <Kanban size={14} color={colors.cyan} />
            <Label>{t('kanban')}</Label>
          </View>
          {kanban.length === 0 ? (
            <Body muted>{t('noKanban')}</Body>
          ) : (
            <View className="gap-1">
              {kanban.slice(0, 6).map((b) => (
                <View
                  key={b.id}
                  className="flex-row items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                >
                  <Kanban size={14} color={colors.mutedForeground} />
                  <Text
                    style={{ fontFamily: fonts.medium }}
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {b.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Mesh canvases — read-only summary for now */}
        <Card>
          <View className="flex-row items-center gap-2">
            <Orbit size={14} color={colors.cyan} />
            <Label>{t('mesh')}</Label>
          </View>
          {meshes.length === 0 ? (
            <Body muted>{t('noMesh')}</Body>
          ) : (
            <View className="gap-1">
              {meshes.slice(0, 6).map((b) => (
                <View
                  key={b.id}
                  className="flex-row items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                >
                  <Orbit size={14} color={colors.mutedForeground} />
                  <Text
                    style={{ fontFamily: fonts.medium }}
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {b.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <View className="flex-row items-center gap-2">
            <Workflow size={14} color={colors.mutedForeground} />
            <Label>{t('comingSoon')}</Label>
          </View>
          <Body muted>{t('comingSoonBody')}</Body>
        </Card>
      </ScrollView>
    </Screen>
  );
}
