import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FileText, LayoutDashboard, Orbit, Search as SearchIcon, Workflow } from 'lucide-react-native';

import { Screen, H1, Body } from '@/ui';
import { useAuth } from '@/core/auth/AuthContext';
import { workspaceSearch, type SearchHit } from '@/core/api/search.client';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Global workspace search. Streams results from POST /ai/workspace-search
 * (the team RAG index) and lets the user jump straight to the entity by
 * deep-linking into the document / board / mesh viewer.
 */
export default function SearchScreen() {
  const router = useRouter();
  const t = useTranslations('search');
  const { activeTeam } = useAuth();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!activeTeam?.id || !query.trim()) return;
    setBusy(true);
    try {
      setHits(await workspaceSearch({ teamId: activeTeam.id, query: query.trim() }));
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  }, [activeTeam?.id, query]);

  return (
    <Screen padded={false}>
      <View className="px-5 pt-4 gap-3">
        <H1>{t('title')}</H1>
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3">
          <SearchIcon size={14} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('placeholder')}
            placeholderTextColor={colors.mutedForeground}
            onSubmitEditing={run}
            returnKeyType="search"
            style={{ fontFamily: fonts.regular }}
            className="h-10 flex-1 text-sm text-foreground"
          />
          {busy ? <ActivityIndicator color={colors.cyan} size="small" /> : null}
        </View>
      </View>

      <FlatList
        className="mt-3"
        contentContainerClassName="px-5 pb-10 gap-2"
        data={hits}
        keyExtractor={(h, i) => `${h.entityType}:${h.entityId}:${i}`}
        ListEmptyComponent={
          query.trim() && !busy ? (
            <View className="items-center justify-center py-10 opacity-60">
              <Body muted>{t('empty')}</Body>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openEntity(router, item)}
            className="flex-row items-start gap-3 rounded-xl border border-border bg-card p-3"
          >
            <EntityIcon kind={item.entityType} />
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontFamily: fonts.semibold }}
                className="text-sm text-foreground"
                numberOfLines={1}
              >
                {item.sourceLabel ?? item.entityType}
              </Text>
              <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={3}>
                {item.snippet}
              </Text>
              <Text className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                {item.entityType} · {item.score.toFixed(2)}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function EntityIcon({ kind }: { kind: string }) {
  const Icon =
    kind === 'document'
      ? FileText
      : kind === 'board' || kind === 'card'
        ? LayoutDashboard
        : kind === 'mesh'
          ? Orbit
          : Workflow;
  return (
    <View className="h-8 w-8 items-center justify-center rounded-md bg-cyan/10">
      <Icon size={14} color={colors.cyan} />
    </View>
  );
}

function openEntity(
  router: ReturnType<typeof useRouter>,
  hit: SearchHit,
) {
  if (hit.entityType === 'document') {
    router.push({
      pathname: '/document/[id]',
      params: { id: hit.entityId, title: hit.sourceLabel ?? '' },
    });
    return;
  }
  // Boards / mesh / scripts viewers ship in a later pass; fall back to the
  // workspace home so the user at least lands in the right context.
  router.push('/workspace');
}
