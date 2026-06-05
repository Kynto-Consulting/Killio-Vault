import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, FileText, Kanban, Orbit, Workflow } from 'lucide-react-native';

import { Screen, Card, H1, Body, Label } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { getTeamCatalog, type TeamCatalog } from '@/core/api/teams.client';
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
  const { activeTeam } = useAuth();
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
        <View>
          <H1>{activeTeam?.name ?? 'Workspace'}</H1>
          <Body muted>
            {activeTeam?.isPersonal ? 'Personal workspace' : (activeTeam?.planTier ?? 'workspace')}
          </Body>
        </View>

        {/* Documents — primary entry point in workspace mode */}
        <Card>
          <View className="flex-row items-center justify-between">
            <Label>Documentos recientes</Label>
            <Pressable
              hitSlop={6}
              onPress={() => router.push('/documents')}
              className="flex-row items-center gap-1"
            >
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-xs text-cyan"
              >
                Ver todos
              </Text>
              <ChevronRight size={12} color={colors.cyan} />
            </Pressable>
          </View>
          {docs.length === 0 ? (
            <Body muted>No hay documentos aún.</Body>
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
            <Label>Tableros Kanban</Label>
          </View>
          {kanban.length === 0 ? (
            <Body muted>Sin tableros Kanban.</Body>
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
            <Label>Mesh canvases</Label>
          </View>
          {meshes.length === 0 ? (
            <Body muted>Sin canvases Mesh.</Body>
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
            <Label>Próximamente en Workspace mode</Label>
          </View>
          <Body muted>
            Edición Kanban, Mesh y Scripts llegarán adaptadas a móvil. Por ahora puedes
            navegar los documentos y editar bricks con el modo experimental.
          </Body>
        </Card>
      </ScrollView>
    </Screen>
  );
}
