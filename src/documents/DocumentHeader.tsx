import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowLeft,
  Copy as CopyIcon,
  Eye,
  Lock,
  MoreVertical,
  Pencil,
  Save,
  Share2,
  Trash2,
  Users as UsersIcon,
  X,
} from 'lucide-react-native';

import { useTranslations } from '@/i18n';
import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import type { FolderSummary } from '@/core/api/documents.client';

/**
 * Top header for the document viewer/editor. Mirrors the web doc page header:
 *   ←  breadcrumb (workspace / folder / …)
 *      title (tap to rename inline)
 *      [edit/view] [⋮ menu]
 *
 * The menu exposes the same actions the web page has on /d/[...]: rename,
 * duplicate, share, delete, and visibility toggles. Each action surfaces a
 * callback the parent screen wires to the backend (or to the local workspace
 * provider for offline-only docs).
 */
export interface DocumentHeaderProps {
  title: string;
  /** Visible breadcrumb segments, leftmost = workspace, rightmost = current. */
  breadcrumb: BreadcrumbSegment[];
  visibility?: 'private' | 'team' | 'public';
  canEdit: boolean;
  onBack(): void;
  onToggleEdit(): void;
  onRename(nextTitle: string): Promise<void> | void;
  onDuplicate?(): Promise<void> | void;
  onShare?(): Promise<void> | void;
  onDelete?(): Promise<void> | void;
  onChangeVisibility?(next: 'private' | 'team' | 'public'): Promise<void> | void;
  /** Shown next to the title (e.g. "guardado hace 1m"). */
  statusLabel?: string;
}

export interface BreadcrumbSegment {
  key: string;
  label: string;
  icon?: string | null;
  onPress?(): void;
}

export function DocumentHeader({
  title,
  breadcrumb,
  visibility,
  canEdit,
  onBack,
  onToggleEdit,
  onRename,
  onDuplicate,
  onShare,
  onDelete,
  onChangeVisibility,
  statusLabel,
}: DocumentHeaderProps) {
  const t = useTranslations('docHeader');
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!renaming) setDraft(title);
  }, [title, renaming]);

  const commitRename = async () => {
    const next = draft.trim();
    if (!next || next === title) {
      setRenaming(false);
      setDraft(title);
      return;
    }
    try {
      await onRename(next);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <View className="border-b border-border/40 bg-background px-3 pt-3 pb-2 gap-2">
      {/* Row 1 — back · title · actions */}
      <View className="flex-row items-center gap-2">
        <Pressable hitSlop={10} onPress={onBack} className="p-1">
          <ArrowLeft size={20} color={colors.foreground} />
        </Pressable>

        <View className="flex-1">
          {renaming ? (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={commitRename}
                autoFocus
                style={{ fontFamily: fonts.bold, fontSize: 18 }}
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-foreground"
              />
              <Pressable onPress={commitRename} hitSlop={6} className="rounded-md bg-primary px-2 py-1">
                <Save size={14} color={colors.primaryForeground ?? '#171717'} />
              </Pressable>
              <Pressable
                onPress={() => {
                  setRenaming(false);
                  setDraft(title);
                }}
                hitSlop={6}
                className="rounded-md border border-border bg-card p-1"
              >
                <X size={14} color={colors.foreground} />
              </Pressable>
            </View>
          ) : (
            <Pressable onLongPress={() => setRenaming(true)} onPress={() => setRenaming(true)}>
              <Text
                style={{ fontFamily: fonts.bold }}
                className="text-lg text-foreground"
                numberOfLines={1}
              >
                {title || t('untitled')}
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={onToggleEdit}
          className="h-9 flex-row items-center gap-1 rounded-md border border-border bg-secondary px-2"
        >
          {canEdit ? (
            <Eye size={13} color={colors.foreground} />
          ) : (
            <Pencil size={13} color={colors.foreground} />
          )}
          <Text
            style={{ fontFamily: fonts.semibold }}
            className="text-xs text-foreground"
          >
            {canEdit ? t('view') : t('edit')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMenuOpen(true)}
          className="h-9 w-9 items-center justify-center rounded-md border border-border bg-card"
        >
          <MoreVertical size={14} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Row 2 — breadcrumb + status */}
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row flex-wrap items-center gap-1">
          {breadcrumb.map((seg, i) => (
            <View key={seg.key} className="flex-row items-center gap-1">
              {i > 0 ? (
                <Text className="text-[11px] text-muted-foreground">/</Text>
              ) : null}
              <Pressable onPress={seg.onPress} hitSlop={6}>
                <Text
                  style={{
                    fontFamily: i === breadcrumb.length - 1 ? fonts.semibold : fonts.medium,
                  }}
                  className={`text-[11px] ${
                    i === breadcrumb.length - 1
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }`}
                  numberOfLines={1}
                >
                  {seg.icon ? `${seg.icon} ` : ''}
                  {seg.label}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
        <View className="flex-row items-center gap-2">
          {visibility ? <VisibilityChip visibility={visibility} t={t} /> : null}
          {statusLabel ? (
            <Text className="text-[10px] text-muted-foreground">{statusLabel}</Text>
          ) : null}
        </View>
      </View>

      {/* Action menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          onPress={() => setMenuOpen(false)}
          className="flex-1 items-end justify-start bg-background/60 p-3 pt-16"
        >
          <View className="w-56 rounded-xl border border-border bg-card p-2 gap-1">
            <MenuItem
              icon={Pencil}
              label={t('actions.rename')}
              onPress={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
            />
            {onDuplicate ? (
              <MenuItem
                icon={CopyIcon}
                label={t('actions.duplicate')}
                onPress={async () => {
                  setMenuOpen(false);
                  await onDuplicate();
                }}
              />
            ) : null}
            {onShare ? (
              <MenuItem
                icon={Share2}
                label={t('actions.share')}
                onPress={async () => {
                  setMenuOpen(false);
                  await onShare();
                }}
              />
            ) : null}
            {onChangeVisibility ? (
              <>
                <View className="h-px bg-border/40 my-1" />
                <VisibilityRow
                  current={visibility ?? 'private'}
                  onChange={async (v) => {
                    setMenuOpen(false);
                    await onChangeVisibility(v);
                  }}
                  t={t}
                />
              </>
            ) : null}
            {onDelete ? (
              <>
                <View className="h-px bg-border/40 my-1" />
                <MenuItem
                  icon={Trash2}
                  label={t('actions.delete')}
                  tone="danger"
                  onPress={async () => {
                    setMenuOpen(false);
                    await onDelete();
                  }}
                />
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  tone,
}: {
  icon: typeof Pencil;
  label: string;
  onPress(): void;
  tone?: 'danger';
}) {
  const color = tone === 'danger' ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-md px-2 py-2 active:bg-secondary"
    >
      <Icon size={14} color={color} />
      <Text style={{ fontFamily: fonts.medium, color }} className="text-sm">
        {label}
      </Text>
    </Pressable>
  );
}

function VisibilityChip({
  visibility,
  t,
}: {
  visibility: 'private' | 'team' | 'public';
  t: ReturnType<typeof useTranslations>;
}) {
  const map: Record<string, { Icon: typeof Lock; label: string; cls: string }> = {
    private: { Icon: Lock, label: t('visibility.private'), cls: 'bg-muted/30 border-border text-muted-foreground' },
    team: { Icon: UsersIcon, label: t('visibility.team'), cls: 'bg-cyan/10 border-cyan/30 text-cyan' },
    public: { Icon: Share2, label: t('visibility.public'), cls: 'bg-success/10 border-success/30 text-success' },
  };
  const { Icon, label, cls } = map[visibility] ?? map.private;
  return (
    <View className={`flex-row items-center gap-1 rounded-md border px-1.5 py-0.5 ${cls}`}>
      <Icon size={10} color={colors.foreground} />
      <Text style={{ fontFamily: fonts.semibold }} className={`text-[10px] ${cls}`}>
        {label}
      </Text>
    </View>
  );
}

function VisibilityRow({
  current,
  onChange,
  t,
}: {
  current: 'private' | 'team' | 'public';
  onChange(v: 'private' | 'team' | 'public'): void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <View className="gap-1">
      <Text className="text-[10px] uppercase tracking-wide text-muted-foreground px-2">
        {t('visibility.label')}
      </Text>
      {(['private', 'team', 'public'] as const).map((v) => {
        const active = v === current;
        const Icon = v === 'private' ? Lock : v === 'team' ? UsersIcon : Share2;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            className={`flex-row items-center gap-2 rounded-md px-2 py-2 ${active ? 'bg-secondary' : ''}`}
          >
            <Icon size={13} color={colors.foreground} />
            <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground">
              {t(`visibility.${v}`)}
            </Text>
            {active ? (
              <View className="h-1.5 w-1.5 rounded-full bg-cyan" />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Convenience: triggers the native share sheet with the doc text payload. */
export async function shareDocumentText(opts: {
  title: string;
  body?: string;
}): Promise<void> {
  try {
    await Share.share({
      title: opts.title,
      message: `${opts.title}\n\n${opts.body ?? ''}`,
    });
  } catch {
    /* user cancelled */
  }
}
