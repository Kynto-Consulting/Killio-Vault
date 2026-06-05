import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link as LinkIcon,
  MessageSquare,
  Palette,
  Quote,
  Sparkles,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react-native';

import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * 1:1 mobile port of Killio-Frontend's `inline-format-toolbar.tsx`. Pops up
 * underneath the active text brick when `visible` is true and rewrites the
 * brick's markdown by wrapping the (whole) text with the right syntax:
 *   bold      → **text**
 *   italic    → *text*
 *   underline → __text__
 *   strike    → ~~text~~
 *   code      → `text`
 *   link      → [link:URL]text[/link]
 *   color     → [color:#hex]text[/color]
 *   highlight → [bg:#hex]text[/bg]
 *   size      → [size:XX]text[/size]
 *   heading   → "# " prefix toggled (level 1–3)
 *   quote     → "> " prefix toggled
 *   callout   → wraps in [color:#hex]…[/color]
 *   lucide    → appends "[lu:icon]" inline
 *
 * Mobile can't read the precise selection from a TextInput without native
 * hooks, so the toolbar operates on the whole value — that matches what the
 * web does when nothing is selected and keeps the behaviour predictable on a
 * tap surface.
 */
export interface InlineFormatToolbarProps {
  visible: boolean;
  value: string;
  onChange(next: string): void;
  /** Hide individual buttons. Same keys the web toolbar accepts. */
  disabledStyles?: string[];
  /** Optional AI / comment hooks. When omitted, the buttons are hidden. */
  onAiAction?(action: 'improve' | 'fix' | 'explain' | 'suggest_edit'): void;
  onComment?(): void;
  onClose?(): void;
}

const COLOR_PRESETS = [
  { label: 'White', value: '#ffffff' },
  { label: 'Gray', value: '#94a3b8' },
  { label: 'Red', value: '#f87171' },
  { label: 'Orange', value: '#fb923c' },
  { label: 'Yellow', value: '#facc15' },
  { label: 'Green', value: '#4ade80' },
  { label: 'Cyan', value: '#22d3ee' },
  { label: 'Blue', value: '#60a5fa' },
  { label: 'Purple', value: '#c084fc' },
  { label: 'Pink', value: '#f472b6' },
];

const HIGHLIGHT_PRESETS = [
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Green', value: '#86efac' },
  { label: 'Cyan', value: '#67e8f9' },
  { label: 'Blue', value: '#93c5fd' },
  { label: 'Pink', value: '#f9a8d4' },
  { label: 'Orange', value: '#fdba74' },
  { label: 'Purple', value: '#c4b5fd' },
];

const SIZE_PRESETS = [
  { label: 'XS', value: '11px' },
  { label: 'SM', value: '13px' },
  { label: 'MD', value: '16px' },
  { label: 'LG', value: '20px' },
  { label: 'XL', value: '24px' },
  { label: '2XL', value: '32px' },
];

const LUCIDE_QUICK = ['zap', 'check', 'sparkles', 'rocket', 'flame', 'star', 'heart', 'bell'];

export function InlineFormatToolbar({
  visible,
  value,
  onChange,
  disabledStyles = [],
  onAiAction,
  onComment,
  onClose,
}: InlineFormatToolbarProps) {
  const t = useTranslations('inlineFormat');
  const [panel, setPanel] = useState<'color' | 'highlight' | 'size' | 'block' | 'lucide' | null>(
    null,
  );

  if (!visible) return null;
  const dis = (k: string) => disabledStyles.includes(k);

  const wrap = (open: string, close = open) => {
    onChange(`${open}${value || 'text'}${close}`);
  };
  const tag = (open: string, close: string) => {
    onChange(`${open}${value || 'text'}${close}`);
  };
  const togglePrefix = (prefix: string) => {
    if (value.startsWith(prefix)) onChange(value.slice(prefix.length));
    else onChange(`${prefix}${value}`);
  };

  return (
    <View className="rounded-xl border border-border bg-card p-2 gap-2 shadow-lg">
      {/* Row 1: basic decorations */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1">
        {!dis('bold') ? (
          <ToolBtn icon={Bold} label="B" onPress={() => wrap('**')} />
        ) : null}
        {!dis('italic') ? (
          <ToolBtn icon={Italic} label="I" onPress={() => wrap('*')} />
        ) : null}
        {!dis('underline') ? (
          <ToolBtn icon={Underline} label="U" onPress={() => wrap('__')} />
        ) : null}
        {!dis('strike') ? (
          <ToolBtn icon={Strikethrough} label="S" onPress={() => wrap('~~')} />
        ) : null}
        {!dis('code') ? (
          <ToolBtn icon={Code} label="</>" onPress={() => wrap('`')} />
        ) : null}
        {!dis('link') ? (
          <ToolBtn
            icon={LinkIcon}
            label="link"
            onPress={() => tag('[link:https://]', '[/link]')}
          />
        ) : null}
        {!dis('color') ? (
          <PanelBtn
            icon={Palette}
            label={t('color')}
            active={panel === 'color'}
            onPress={() => setPanel((p) => (p === 'color' ? null : 'color'))}
          />
        ) : null}
        {!dis('highlight') ? (
          <PanelBtn
            icon={Highlighter}
            label={t('highlight')}
            active={panel === 'highlight'}
            onPress={() => setPanel((p) => (p === 'highlight' ? null : 'highlight'))}
          />
        ) : null}
        {!dis('size') ? (
          <PanelBtn
            icon={Type}
            label={t('size')}
            active={panel === 'size'}
            onPress={() => setPanel((p) => (p === 'size' ? null : 'size'))}
          />
        ) : null}
        {!dis('block') ? (
          <PanelBtn
            icon={Quote}
            label={t('block')}
            active={panel === 'block'}
            onPress={() => setPanel((p) => (p === 'block' ? null : 'block'))}
          />
        ) : null}
        {!dis('lucide') ? (
          <PanelBtn
            icon={Sparkles}
            label="lucide"
            active={panel === 'lucide'}
            onPress={() => setPanel((p) => (p === 'lucide' ? null : 'lucide'))}
          />
        ) : null}
        {onComment ? (
          <ToolBtn icon={MessageSquare} label={t('comment')} onPress={() => onComment?.()} />
        ) : null}
        {onAiAction ? (
          <ToolBtn icon={Sparkles} label="AI" onPress={() => onAiAction('improve')} />
        ) : null}
        {onClose ? (
          <ToolBtn icon={Type} label="×" onPress={() => onClose()} />
        ) : null}
      </ScrollView>

      {/* Color picker panel */}
      {panel === 'color' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <Pressable
              key={c.value}
              onPress={() => {
                tag(`[color:${c.value}]`, '[/color]');
                setPanel(null);
              }}
              className="h-7 w-7 items-center justify-center rounded-full border border-border"
              style={{ backgroundColor: c.value }}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Highlight panel */}
      {panel === 'highlight' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          {HIGHLIGHT_PRESETS.map((c) => (
            <Pressable
              key={c.value}
              onPress={() => {
                tag(`[bg:${c.value}]`, '[/bg]');
                setPanel(null);
              }}
              className="h-7 w-7 items-center justify-center rounded-full border border-border"
              style={{ backgroundColor: c.value }}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Size panel */}
      {panel === 'size' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          {SIZE_PRESETS.map((s) => (
            <Pressable
              key={s.value}
              onPress={() => {
                tag(`[size:${s.value}]`, '[/size]');
                setPanel(null);
              }}
              className="h-7 items-center justify-center rounded border border-border bg-background px-2"
            >
              <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-foreground">
                {s.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Block panel (heading 1-3, quote, callout) */}
      {panel === 'block' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          {(['# ', '## ', '### '] as const).map((p, i) => (
            <Pressable
              key={p}
              onPress={() => {
                togglePrefix(p);
                setPanel(null);
              }}
              className="h-7 items-center justify-center rounded border border-border bg-background px-2"
            >
              <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-foreground">
                H{i + 1}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              togglePrefix('> ');
              setPanel(null);
            }}
            className="h-7 items-center justify-center rounded border border-border bg-background px-2"
          >
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-foreground">
              {t('quote')}
            </Text>
          </Pressable>
          {[
            { label: 'Note', color: '#38bdf8' },
            { label: 'Tip', color: '#34d399' },
            { label: 'Important', color: '#a78bfa' },
            { label: 'Warning', color: '#fbbf24' },
            { label: 'Danger', color: '#fb7185' },
          ].map((c) => (
            <Pressable
              key={c.label}
              onPress={() => {
                tag(`[color:${c.color}]`, '[/color]');
                setPanel(null);
              }}
              className="h-7 items-center justify-center rounded border px-2"
              style={{ borderColor: c.color, backgroundColor: `${c.color}22` }}
            >
              <Text style={{ fontFamily: fonts.semibold, color: c.color }} className="text-[10px]">
                {c.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Lucide picker */}
      {panel === 'lucide' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          {LUCIDE_QUICK.map((name) => (
            <Pressable
              key={name}
              onPress={() => {
                onChange(`${value} [lu:${name}]`);
                setPanel(null);
              }}
              className="h-7 items-center justify-center rounded border border-border bg-background px-2"
            >
              <Text style={{ fontFamily: fonts.mono }} className="text-[10px] text-foreground">
                [lu:{name}]
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function ToolBtn({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof Bold;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="h-8 min-w-8 items-center justify-center rounded-md border border-border bg-background px-2"
    >
      <Icon size={13} color={colors.foreground} />
    </Pressable>
  );
}

function PanelBtn({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: typeof Bold;
  label: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-8 min-w-8 items-center justify-center rounded-md border px-2 ${
        active ? 'border-cyan bg-cyan/10' : 'border-border bg-background'
      }`}
    >
      <Icon size={13} color={active ? colors.cyan : colors.foreground} />
    </Pressable>
  );
}
