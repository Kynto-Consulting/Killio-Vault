import { useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  FolderPlus,
  HardDriveDownload,
  Plus,
  Trash2,
} from 'lucide-react-native';

import { Screen, Card, H1, Body } from '@/ui';
import {
  useLocalWorkspace,
  type LocalWorkspaceMeta,
} from '@/local-workspace/LocalWorkspaceProvider';
import { useAppMode } from '@/nav/AppModeContext';
import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';

/**
 * Lists the local workspaces saved on the device and lets the user create a
 * new one. Selecting a workspace flips Vault into "workspace mode" pointed at
 * the local backend, so /documents reads .kd files from the device instead
 * of hitting the cloud API.
 */
export default function LocalWorkspacesScreen() {
  const router = useRouter();
  const t = useTranslations('localWs');
  const { setMode } = useAppMode();
  const local = useLocalWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<LocalWorkspaceMeta | null>(
    null,
  );

  const openWorkspace = async (id: string) => {
    await local.selectLocalWorkspace(id);
    await setMode('workspace');
    router.replace('/workspace');
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerClassName="px-5 pb-10 pt-3 gap-4"
        refreshControl={
          <RefreshControl
            refreshing={local.busy}
            onRefresh={() => void local.refresh()}
            tintColor={colors.foreground}
          />
        }
      >
        <H1>{t('title')}</H1>
        <Body muted>{t('sub')}</Body>

        {!local.supported ? (
          <Card>
            <Body muted>
              Tu dispositivo no permite acceso al sistema de archivos para esta
              función.
            </Body>
          </Card>
        ) : null}

        <Pressable
          onPress={() => setCreateOpen(true)}
          className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40"
        >
          <Plus size={14} color={colors.cyan} />
          <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
            {t('create')}
          </Text>
        </Pressable>

        {local.workspaces.length === 0 ? (
          <Card>
            <Body muted>{t('none')}</Body>
          </Card>
        ) : (
          <View className="gap-2">
            {local.workspaces.map((ws) => (
              <Pressable
                key={ws.id}
                onPress={() => void openWorkspace(ws.id)}
                className={`flex-row items-center gap-3 rounded-xl border bg-card p-3 ${
                  local.activeId === ws.id ? 'border-cyan' : 'border-border'
                }`}
              >
                <View className="h-9 w-9 items-center justify-center rounded-md border border-border bg-background">
                  <HardDriveDownload size={14} color={colors.cyan} />
                </View>
                <View className="flex-1">
                  <Text
                    style={{ fontFamily: fonts.semibold }}
                    className="text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {ws.name}
                  </Text>
                  <Text className="text-[10px] text-muted-foreground">
                    {t('createdAt')}: {new Date(ws.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    setConfirmRemove(ws);
                  }}
                  hitSlop={6}
                  className="rounded-md border border-border/60 bg-background p-1"
                >
                  <Trash2 size={12} color={colors.destructive} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <CreateLocalModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name) => {
          try {
            const ws = await local.createLocalWorkspace(name);
            setCreateOpen(false);
            await setMode('workspace');
            router.replace('/workspace');
            return ws;
          } catch {
            setCreateOpen(false);
            return null;
          }
        }}
      />

      <ConfirmRemoveModal
        target={confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (!confirmRemove) return;
          await local.removeLocalWorkspace(confirmRemove.id);
          setConfirmRemove(null);
        }}
      />
    </Screen>
  );
}

function CreateLocalModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose(): void;
  onCreate(name: string): Promise<unknown>;
}) {
  const t = useTranslations('localWs');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-background/80 p-6">
        <View className="w-full max-w-md rounded-2xl border border-border bg-card p-5 gap-3">
          <Text style={{ fontFamily: fonts.bold }} className="text-lg text-foreground">
            {t('create')}
          </Text>
          <Text className="text-xs text-muted-foreground">{t('sub')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('name')}
            placeholderTextColor="#6f6f78"
            autoFocus
            style={{ fontFamily: fonts.regular }}
            className="h-12 rounded-xl border border-border bg-background px-3 text-foreground"
          />
          <View className="flex-row justify-end gap-2 mt-2">
            <Pressable
              onPress={onClose}
              className="rounded-md border border-border bg-secondary px-4 py-2"
            >
              <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                Cancelar
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!name.trim()) return;
                setBusy(true);
                try {
                  await onCreate(name.trim());
                } finally {
                  setBusy(false);
                  setName('');
                }
              }}
              disabled={busy || !name.trim()}
              className={`flex-row items-center gap-1 rounded-md bg-primary px-4 py-2 ${busy || !name.trim() ? 'opacity-60' : ''}`}
            >
              <FolderPlus size={13} color={colors.primaryForeground ?? '#171717'} />
              <Text
                style={{ fontFamily: fonts.semibold, color: colors.primaryForeground ?? '#171717' }}
                className="text-sm"
              >
                {busy ? '…' : t('create')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmRemoveModal({
  target,
  onClose,
  onConfirm,
}: {
  target: LocalWorkspaceMeta | null;
  onClose(): void;
  onConfirm(): Promise<void>;
}) {
  const t = useTranslations('localWs');
  if (!target) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-background/80 p-6">
        <View className="w-full max-w-md rounded-2xl border border-border bg-card p-5 gap-3">
          <Text style={{ fontFamily: fonts.bold }} className="text-lg text-destructive">
            {t('remove')}
          </Text>
          <Text className="text-sm text-foreground/80">{t('removeConfirm')}</Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {target.name}
          </Text>
          <View className="flex-row justify-end gap-2 mt-2">
            <Pressable
              onPress={onClose}
              className="rounded-md border border-border bg-secondary px-4 py-2"
            >
              <Text style={{ fontFamily: fonts.medium }} className="text-sm text-foreground">
                Cancelar
              </Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              className="rounded-md bg-destructive px-4 py-2"
            >
              <Text
                style={{ fontFamily: fonts.semibold, color: '#fff' }}
                className="text-sm"
              >
                {t('remove')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
