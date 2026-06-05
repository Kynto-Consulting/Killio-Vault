import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Clock,
  Edit2,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  Search,
  Trash2,
} from 'lucide-react-native';

import { Screen, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { useDocuments } from '@/documents/DocumentsProvider';
import { useLocalWorkspace } from '@/local-workspace/LocalWorkspaceProvider';
import { useNetworkStatus } from '@/local-workspace/useNetworkStatus';
import {
  listDocuments,
  listFolders,
  type DocSummary,
  type FolderSummary,
} from '@/core/api/documents.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Workspace-mode documents browser. Mirrors the web frontend's /d page
 * (Killio-Frontend/src/app/(dashboard)/d/page.tsx) at ~80% — header with
 * title + search + create CTAs, folder breadcrumb / back, folder cards,
 * document cards grid. Mobile collapses the folder sidebar into a chip row
 * so the visual hierarchy still survives a narrow viewport.
 */
export default function DocumentsScreen() {
  const router = useRouter();
  const t = useTranslations('documentsScreen');
  const tNet = useTranslations('network');
  const { activeTeam } = useAuth();
  const docs = useDocuments();
  const local = useLocalWorkspace();
  const { status: netStatus, retry: retryNet } = useNetworkStatus();

  const useLocal = !!local.active;
  const isOffline = netStatus === 'offline' && !useLocal;

  const [folderStack, setFolderStack] = useState<FolderSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const currentFolder = folderStack[folderStack.length - 1] ?? null;
  const activeFolderId = currentFolder?.id ?? null;

  const load = useCallback(async () => {
    if (useLocal) {
      // Local: derive folders + docs from the on-device file list.
      const parentPath = currentFolder?.id ?? '';
      const localFolders: FolderSummary[] = local.folders
        .filter((f) => (f.parent ?? '') === parentPath)
        .map((f) => ({
          id: f.path,
          name: f.name,
          parentFolderId: f.parent || null,
          icon: f.icon ?? '📁',
          color: f.color ?? null,
        }));
      const localDocs: DocSummary[] = local.files
        .filter((f) => f.kind === 'kd' && (f.folder ?? '') === parentPath)
        .map((f) => ({
          id: `local:${encodeURIComponent(f.path)}`,
          title: f.name.replace(/\.kd$/, ''),
          folderId: f.folder || null,
          updatedAt: new Date(f.lastModified || Date.now()).toISOString(),
        }));
      setFolders(localFolders);
      setDocuments(localDocs);
      setLoading(false);
      return;
    }
    if (!activeTeam?.id) return;
    setLoading(true);
    try {
      const [fs, ds] = await Promise.all([
        listFolders(activeTeam.id, activeFolderId ?? undefined),
        listDocuments(activeTeam.id, activeFolderId ?? undefined),
      ]);
      setFolders(fs);
      setDocuments(ds);
    } catch {
      setFolders([]);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeam?.id, activeFolderId, useLocal, currentFolder?.id, local.folders, local.files]);

  useEffect(() => {
    void load();
  }, [load]);

  const enter = (f: FolderSummary) => setFolderStack((s) => [...s, f]);
  const goUp = () => setFolderStack((s) => s.slice(0, -1));

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.title.toLowerCase().includes(q));
  }, [documents, query]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerClassName="px-4 pb-10 pt-3 gap-4"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.foreground}
          />
        }
      >
        {/* Header */}
        <View className="gap-2">
          <Text
            style={{ fontFamily: fonts.bold }}
            className="text-3xl tracking-tight text-foreground"
          >
            {t('title')}
          </Text>
          <Body muted>{t('subtitle')}</Body>
          {useLocal ? (
            <View className="flex-row items-center gap-2 rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-1.5">
              <Text style={{ fontFamily: fonts.semibold }} className="text-[11px] text-cyan">
                💾 {local.active?.name} · local
              </Text>
            </View>
          ) : null}
        </View>

        {/* Offline banner */}
        {isOffline ? (
          <View className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 gap-2">
            <Text style={{ fontFamily: fonts.bold }} className="text-sm text-destructive">
              {tNet('offline')}
            </Text>
            <Body muted>{tNet('offlineDesc')}</Body>
            <View className="flex-row gap-2 mt-1">
              <Pressable
                onPress={() => void retryNet()}
                className="rounded-md border border-border bg-card px-3 py-1.5"
              >
                <Text style={{ fontFamily: fonts.semibold }} className="text-[11px] text-foreground">
                  {tNet('offlineRetry')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/local-workspaces')}
                className="rounded-md bg-cyan px-3 py-1.5"
              >
                <Text style={{ fontFamily: fonts.semibold }} className="text-[11px] text-background">
                  {tNet('offlineUseLocal')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Search + actions */}
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3">
            <Search size={14} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor="#6f6f78"
              style={{ fontFamily: fonts.regular }}
              className="h-10 flex-1 text-sm text-foreground"
            />
          </View>
          <Pressable
            onPress={async () => {
              if (useLocal) {
                // Inline-create a default .kd under the current folder.
                const slug = `doc-${Date.now().toString(36)}`;
                const relPath = currentFolder?.id ? `${currentFolder.id}/${slug}.kd` : `${slug}.kd`;
                try {
                  await local.writeKillioFile(relPath, {
                    kind: 'kd',
                    schemaVersion: '2026-v1',
                    payload: { id: relPath, title: 'Sin título', bricks: [] },
                  });
                  router.push({
                    pathname: '/document/[id]',
                    params: { id: `local:${encodeURIComponent(relPath)}`, title: 'Sin título' },
                  });
                } catch {
                  /* ignore — provider will surface errors via Body */
                }
                return;
              }
              docs.openCreateDocument({
                folderId: activeFolderId,
                onCreated: (doc) => {
                  router.push({
                    pathname: '/document/[id]',
                    params: { id: doc.id, title: doc.title },
                  });
                },
              });
            }}
            className="h-10 flex-row items-center justify-center gap-1 rounded-xl bg-primary px-3"
          >
            <Plus size={14} color={colors.primaryForeground ?? '#171717'} />
            <Text
              style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
              className="text-xs"
            >
              {t('newDoc')}
            </Text>
          </Pressable>
        </View>

        {/* Folder toolbar */}
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={async () => {
              if (useLocal) {
                await local.createFolder(currentFolder?.id ?? '', {
                  name: `Carpeta ${local.folders.length + 1}`,
                  icon: '📁',
                });
                return;
              }
              docs.openCreateFolder({
                parentFolderId: activeFolderId,
                onCreated: () => void load(),
              });
            }}
            className="h-9 flex-row items-center gap-1 rounded-md border border-border bg-secondary px-3"
          >
            <FolderPlus size={14} color={colors.foreground} />
            <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
              {t('newFolder')}
            </Text>
          </Pressable>
          {currentFolder ? (
            <>
              <Pressable
                onPress={() =>
                  docs.openEditFolder(currentFolder, {
                    onSaved: () => void load(),
                  })
                }
                className="h-9 flex-row items-center gap-1 rounded-md border border-border bg-card px-3"
              >
                <Edit2 size={13} color={colors.foreground} />
                <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
                  Editar
                </Text>
              </Pressable>
              <Pressable
                onPress={goUp}
                className="h-9 flex-row items-center gap-1 rounded-md border border-border bg-card px-3"
              >
                <ChevronLeft size={13} color={colors.foreground} />
                <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground">
                  Subir
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>

        {/* Breadcrumb */}
        <View className="flex-row flex-wrap items-center gap-1">
          <Pressable onPress={() => setFolderStack([])}>
            <Text
              style={{ fontFamily: fonts.medium }}
              className="text-xs text-muted-foreground"
            >
              {activeTeam?.name ?? 'Workspace'}
            </Text>
          </Pressable>
          {folderStack.map((f, i) => (
            <View key={f.id} className="flex-row items-center gap-1">
              <Text className="text-xs text-muted-foreground">/</Text>
              <Pressable onPress={() => setFolderStack((s) => s.slice(0, i + 1))}>
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-xs text-foreground"
                >
                  {f.icon ? `${f.icon} ` : ''}
                  {f.name}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* Folders */}
        {folders.length > 0 ? (
          <View className="gap-2">
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="text-[11px] uppercase tracking-widest text-muted-foreground"
            >
              {t('folders')}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {folders.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => enter(f)}
                  onLongPress={() =>
                    docs.openDeleteFolder(f, {
                      onDeleted: () => void load(),
                    })
                  }
                  className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
                  style={{
                    borderColor: f.color ?? colors.border,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{f.icon ?? '📁'}</Text>
                  <Text
                    style={{ fontFamily: fonts.medium }}
                    className="text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {f.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Documents */}
        <View className="gap-2">
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-[11px] uppercase tracking-widest text-muted-foreground"
          >
            {t('files')}
          </Text>

          {filteredDocs.length === 0 && !loading ? (
            <View className="items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-10">
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-muted/30">
                <FileText size={20} color={colors.mutedForeground} />
              </View>
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-base text-foreground"
              >
                {query ? t('noResults') : t('empty')}
              </Text>
              <Text className="mt-1 text-center text-xs text-muted-foreground">
                {query ? t('noResultsHint', { query }) : t('emptyHint')}
              </Text>
              <Pressable
                onPress={() =>
                  docs.openCreateDocument({
                    folderId: activeFolderId,
                    onCreated: (doc) =>
                      router.push({
                        pathname: '/document/[id]',
                        params: { id: doc.id, title: doc.title },
                      }),
                  })
                }
                className="mt-4 rounded-md bg-cyan/10 px-4 py-2"
              >
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-xs text-cyan"
                >
                  Crear documento
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-3">
              {/* New-doc card placeholder mirrors the web grid */}
              <Pressable
                onPress={() =>
                  docs.openCreateDocument({
                    folderId: activeFolderId,
                    onCreated: (doc) =>
                      router.push({
                        pathname: '/document/[id]',
                        params: { id: doc.id, title: doc.title },
                      }),
                  })
                }
                className="h-[140px] w-[48%] items-center justify-center rounded-xl border border-dashed border-border bg-transparent p-4"
              >
                <View className="mb-2 h-8 w-8 items-center justify-center rounded-full bg-cyan/10">
                  <Plus size={14} color={colors.cyan} />
                </View>
                <Text
                  style={{ fontFamily: fonts.semibold }}
                  className="text-sm text-foreground"
                >
                  Nuevo
                </Text>
                <Text className="text-[11px] text-muted-foreground">empezar a escribir</Text>
              </Pressable>

              {filteredDocs.map((d) => (
                <DocCard
                  key={d.id}
                  doc={d}
                  onOpen={() =>
                    router.push({
                      pathname: '/document/[id]',
                      params: { id: d.id, title: d.title },
                    })
                  }
                  onEdit={() =>
                    docs.openEditDocument(d, {
                      onSaved: (saved) => {
                        setDocuments((prev) =>
                          prev.map((p) => (p.id === saved.id ? { ...p, title: saved.title } : p)),
                        );
                      },
                    })
                  }
                  onDelete={() =>
                    docs.openDeleteDocument(d, {
                      onDeleted: (id) =>
                        setDocuments((prev) => prev.filter((p) => p.id !== id)),
                    })
                  }
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function DocCard({
  doc,
  onOpen,
  onEdit,
  onDelete,
}: {
  doc: DocSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onEdit}
      className="h-[140px] w-[48%] overflow-hidden rounded-xl border border-border bg-card p-3"
    >
      <View className="flex-row items-start justify-between">
        <View className="h-8 w-8 items-center justify-center rounded-md bg-cyan/10">
          <FileText size={14} color={colors.cyan} />
        </View>
        <View className="flex-row gap-1">
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            hitSlop={6}
            className="rounded-md border border-border/50 bg-background p-1"
          >
            <Edit2 size={10} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            hitSlop={6}
            className="rounded-md border border-border/50 bg-background p-1"
          >
            <Trash2 size={10} color={colors.destructive} />
          </Pressable>
        </View>
      </View>
      <Text
        style={{ fontFamily: fonts.semibold }}
        className="mt-2 text-sm text-foreground"
        numberOfLines={3}
      >
        {doc.title}
      </Text>
      {doc.updatedAt ? (
        <View className="mt-auto flex-row items-center gap-1">
          <Clock size={10} color={colors.mutedForeground} />
          <Text className="text-[10px] text-muted-foreground">
            {formatDate(doc.updatedAt)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
