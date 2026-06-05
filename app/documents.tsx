import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, FileText, Folder } from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import {
  listDocuments,
  listFolders,
  type DocSummary,
  type FolderSummary,
} from '@/core/api/documents.client';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Documents browser — mirrors the web frontend's workspace document list.
 * Folder hierarchy is navigated in-place: tapping a folder pushes its
 * children into the same screen via a folder-stack. Selecting a document
 * opens it in /documents/[id] where the BrickRenderer takes over.
 */
export default function DocumentsScreen() {
  const router = useRouter();
  const { activeTeam } = useAuth();
  const [folderStack, setFolderStack] = useState<FolderSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const currentFolder = folderStack[folderStack.length - 1];

  const load = useCallback(async () => {
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      const [fs, ds] = await Promise.all([
        listFolders(activeTeam.id, currentFolder?.id),
        listDocuments(activeTeam.id, currentFolder?.id),
      ]);
      setFolders(fs);
      setDocs(ds);
    } catch {
      setFolders([]);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id, currentFolder?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const enterFolder = (f: FolderSummary) =>
    setFolderStack((s) => [...s, f]);
  const goUp = () => setFolderStack((s) => s.slice(0, -1));

  const crumb = folderStack.length
    ? folderStack.map((f) => f.name).join(' / ')
    : activeTeam?.name ?? 'Workspace';

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4">
        <H1>Documentos</H1>
        <Body muted>{crumb}</Body>
      </View>

      <FlatList
        className="mt-2"
        contentContainerClassName="px-5 pb-6 gap-2"
        data={[
          ...(folderStack.length
            ? [{ kind: 'up' as const }]
            : []),
          ...folders.map((f) => ({ kind: 'folder' as const, folder: f })),
          ...docs.map((d) => ({ kind: 'doc' as const, doc: d })),
        ]}
        keyExtractor={(row, i) =>
          row.kind === 'up'
            ? 'up'
            : row.kind === 'folder'
              ? `f:${row.folder.id}`
              : `d:${row.doc.id}-${i}`
        }
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.foreground}
          />
        }
        ListEmptyComponent={
          <Card>
            <Body muted>No hay documentos en esta carpeta.</Body>
          </Card>
        }
        renderItem={({ item }) => {
          if (item.kind === 'up') {
            return (
              <Pressable
                onPress={goUp}
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 active:opacity-80"
              >
                <Folder size={16} color={colors.mutedForeground} />
                <Text
                  style={{ fontFamily: fonts.medium }}
                  className="flex-1 text-base text-foreground"
                >
                  ..
                </Text>
              </Pressable>
            );
          }
          if (item.kind === 'folder') {
            return (
              <Pressable
                onPress={() => enterFolder(item.folder)}
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 active:opacity-80"
              >
                <Folder size={16} color={colors.cyan} />
                <Text
                  style={{ fontFamily: fonts.medium }}
                  className="flex-1 text-base text-foreground"
                  numberOfLines={1}
                >
                  {item.folder.icon ? `${item.folder.icon} ` : ''}
                  {item.folder.name}
                </Text>
                <ChevronRight size={16} color={colors.mutedForeground} />
              </Pressable>
            );
          }
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/document/[id]',
                  params: { id: item.doc.id, title: item.doc.title },
                })
              }
              className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 active:opacity-80"
            >
              <FileText size={16} color={colors.mutedForeground} />
              <Text
                style={{ fontFamily: fonts.medium }}
                className="flex-1 text-base text-foreground"
                numberOfLines={1}
              >
                {item.doc.title}
              </Text>
              <ChevronRight size={16} color={colors.mutedForeground} />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
