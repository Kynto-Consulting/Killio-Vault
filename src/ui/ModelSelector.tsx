import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDown, Lock, Sparkles, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { colors } from '@/theme/theme';
import { fonts } from '@/theme/fonts';
import { useTranslations } from '@/i18n';
import {
  getAgentModels,
  type AgentModelOption,
  type AgentModelOptions,
} from '@/core/api/agent.client';

interface ModelSelectorProps {
  teamId: string;
  /** When set, reflects the conversation's pinned model + once-only lock. */
  conversationId?: string;
  /** Currently selected model id. */
  value?: string | null;
  /** Fired when the user picks an allowed model. */
  onChange: (modelId: string) => void;
  /**
   * 'full' (default): chip + bottom-sheet in one place (rooms/settings).
   * 'chip': only the chip — opens via onOpenChange. Use in a NATIVE header.
   * 'sheet': only the bottom-sheet Modal — controlled by `open`. Render this in
   *   the SCREEN BODY (a Modal mounted inside a native-stack header never opens).
   * Pair a header 'chip' with a body 'sheet' sharing `open`/`onOpenChange`.
   */
  variant?: 'full' | 'chip' | 'sheet';
  /** Controlled open state (for the chip+sheet split). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Route shown by the "Upgrade" action — the plan/entitlements screen. */
const UPGRADE_ROUTE = '/usage';

/**
 * Compact chip that opens a bottom-sheet list of models. Locked (allowed:false)
 * models show a 🔒 + an Upgrade action that navigates to the plan screen.
 * When the conversation already spent its once-only change the chip is disabled.
 * Shared by the rooms composer, the assistant composer, and settings.
 */
export function ModelSelector({
  teamId,
  conversationId,
  value,
  onChange,
  variant = 'full',
  open: openProp,
  onOpenChange,
}: ModelSelectorProps) {
  const t = useTranslations('agentModel');
  const router = useRouter();

  const [data, setData] = useState<AgentModelOptions | null>(null);
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOpenInternal(v));

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    getAgentModels({ teamId, conversationId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, conversationId]);

  const locked = data?.conversation?.locked ?? false;
  const models = data?.models ?? [];

  const selectedId = useMemo(() => {
    if (value) return value;
    if (data?.conversation?.model) return data.conversation.model;
    if (data?.defaultModel) return data.defaultModel;
    return models.find((m) => m.allowed)?.id ?? null;
  }, [value, data, models]);

  const selected = models.find((m) => m.id === selectedId) ?? null;

  if (!data || models.length === 0) return null;

  const pick = (m: AgentModelOption) => {
    if (!m.allowed || locked) return;
    onChange(m.id);
    setOpen(false);
  };

  return (
    <>
      {variant !== 'sheet' ? (
      <Pressable
        // onPressIn (not onPress): a JS Pressable child of a native-stack header
        // doesn't fire onPress reliably (same reason the new-chat button uses it).
        onPressIn={() => !locked && setOpen(true)}
        disabled={locked}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('select')}
        className={`flex-row items-center gap-1 self-start rounded-full border border-border bg-card px-2.5 py-1 ${
          locked ? 'opacity-50' : 'active:opacity-70'
        }`}
      >
        {locked ? (
          <Lock size={12} color={colors.mutedForeground} />
        ) : (
          <Sparkles size={12} color={colors.cyan} />
        )}
        <Text style={{ fontFamily: fonts.medium }} className="text-xs text-foreground" numberOfLines={1}>
          {selected?.label ?? t('select')}
        </Text>
        <ChevronDown size={12} color={colors.mutedForeground} />
      </Pressable>
      ) : null}

      {variant !== 'chip' ? (
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-background/70" onPress={() => setOpen(false)}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-2xl border-t border-border bg-card"
          >
            <View className="items-center pt-2 pb-1">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>
            <Text
              style={{ fontFamily: fonts.semibold }}
              className="px-4 pb-2 pt-1 text-sm text-foreground"
            >
              {t('select')}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {models.map((m) => {
                const isSelected = m.id === selectedId;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => pick(m)}
                    disabled={!m.allowed}
                    className={`px-4 py-3 ${m.allowed ? 'active:bg-secondary' : 'opacity-70'} ${
                      isSelected ? 'bg-secondary' : ''
                    }`}
                  >
                    <View className="flex-row items-center gap-1.5">
                      {!m.allowed && <Lock size={13} color={colors.warning} />}
                      <Text
                        style={{ fontFamily: fonts.semibold }}
                        className="flex-1 text-sm text-foreground"
                        numberOfLines={1}
                      >
                        {m.label}
                      </Text>
                      {isSelected && m.allowed && <Check size={15} color={colors.cyan} />}
                    </View>
                    {m.description ? (
                      <Text
                        style={{ fontFamily: fonts.regular }}
                        className="mt-0.5 text-xs text-muted-foreground"
                      >
                        {m.description}
                      </Text>
                    ) : null}
                    {!m.allowed ? (
                      <Pressable
                        onPress={() => {
                          setOpen(false);
                          router.push(UPGRADE_ROUTE);
                        }}
                        hitSlop={6}
                        className="mt-1 flex-row items-center gap-1 self-start active:opacity-70"
                      >
                        <Sparkles size={11} color={colors.cyan} />
                        <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-cyan">
                          {t('upgrade')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            {locked ? (
              <Text
                style={{ fontFamily: fonts.regular }}
                className="px-4 pb-3 pt-1 text-xs text-muted-foreground"
              >
                {t('locked')}
              </Text>
            ) : (
              <View style={{ height: 12 }} />
            )}
          </Pressable>
        </Pressable>
      </Modal>
      ) : null}
    </>
  );
}
