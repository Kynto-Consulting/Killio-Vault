import { useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  CheckSquare,
  CreditCard,
  FileText,
  Lightbulb,
  Square,
  Video,
  Music,
} from 'lucide-react-native';

import { RichText } from './RichText';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * Read-only RN port of the frontend UnifiedBrickRenderer
 * (Killio-Frontend src/components/bricks/brick-renderer.tsx).
 *
 * Supported kinds (full coverage of the web app, save complex composite editors):
 *   text, heading (text "#"), quote, callout, divider, code,
 *   image, video, audio, file (media),
 *   checklist, table, accordion, tabs, columns,
 *   graph (chart preview), form (preview), payment (preview),
 *   ai_summary, popup_document, embed.
 *
 * Nested-child kinds (accordion / tabs / columns) recursively render their
 * sub-bricks via `BrickRenderer` itself.
 *
 * EXPERIMENTAL EDIT MODE (Vault-only): pass `canEdit={true}` + onChange to allow
 * inline text edits and checklist toggles. No drag-reorder, no add/delete bricks
 * yet (that needs the full sortable list — coming in a later pass).
 */

export interface Brick {
  id?: string;
  kind: string;
  content: Record<string, any>;
  position?: number;
}

export interface BrickProps {
  brick: Brick;
  canEdit?: boolean;
  onChange?: (next: Brick) => void;
}

function textOf(c: Record<string, any>): string {
  return String(c?.markdown ?? c?.text ?? c?.value ?? '');
}

// ─── Leaf bricks ────────────────────────────────────────────────────────────

function TextBrick({ brick, canEdit, onChange }: BrickProps) {
  // Headings: a leading "#"…"######" line is rendered larger via RichText.
  const text = textOf(brick.content);
  if (canEdit && onChange) {
    return (
      <EditableText
        value={text}
        onChangeText={(t) =>
          onChange({ ...brick, content: { ...brick.content, text: t, markdown: t } })
        }
      />
    );
  }
  return <RichText content={text} />;
}

function QuoteBrick({ brick, canEdit, onChange }: BrickProps) {
  return (
    <View
      className="my-1 rounded-r-md bg-secondary/40 py-2 pl-3 pr-2"
      style={{ borderLeftWidth: 3, borderLeftColor: colors.cyan }}
    >
      {canEdit && onChange ? (
        <EditableText
          value={textOf(brick.content)}
          onChangeText={(t) =>
            onChange({ ...brick, content: { ...brick.content, text: t, markdown: `> ${t}` } })
          }
        />
      ) : (
        <RichText content={textOf(brick.content)} color={colors.mutedForeground} />
      )}
    </View>
  );
}

function CalloutBrick({ brick, canEdit, onChange }: BrickProps) {
  return (
    <View
      className="my-1 flex-row gap-3 rounded-md border p-3"
      style={{ borderColor: colors.indigo + '55', backgroundColor: colors.indigo + '14' }}
    >
      <Lightbulb size={16} color={colors.indigo} />
      <View style={{ flex: 1 }}>
        {canEdit && onChange ? (
          <EditableText
            value={textOf(brick.content)}
            onChangeText={(t) =>
              onChange({ ...brick, content: { ...brick.content, text: t, markdown: t } })
            }
          />
        ) : (
          <RichText content={textOf(brick.content)} />
        )}
      </View>
    </View>
  );
}

function DividerBrick() {
  return <View className="my-2 h-px rounded-full bg-border" />;
}

function CodeBrick({ brick }: BrickProps) {
  const code = String(
    brick.content?.code ?? brick.content?.text ?? brick.content?.markdown ?? '',
  );
  const lang = brick.content?.lang || brick.content?.language;
  return (
    <View className="my-1 rounded-md border border-border bg-secondary p-3">
      {lang ? (
        <Text
          style={{ fontFamily: fonts.mono }}
          className="mb-1 text-[10px] uppercase text-muted-foreground"
        >
          {String(lang)}
        </Text>
      ) : null}
      <Text style={{ fontFamily: fonts.mono }} className="text-xs text-foreground/85">
        {code}
      </Text>
    </View>
  );
}

function MediaBrick({ brick }: BrickProps) {
  const url = String(brick.content?.url ?? brick.content?.src ?? '');
  if (!url) return null;
  const title = brick.content?.title || brick.content?.alt;
  const isVideo = brick.kind === 'video' || /\.(mp4|mov|webm)$/i.test(url);
  const isAudio = brick.kind === 'audio' || /\.(mp3|wav|m4a|ogg)$/i.test(url);

  if (isVideo) {
    return (
      <Pressable onPress={() => void Linking.openURL(url)} className="my-1">
        <View className="aspect-video w-full items-center justify-center rounded-xl border border-border bg-card">
          <Video size={28} color={colors.cyan} />
          {title ? (
            <Text className="mt-1 text-xs text-muted-foreground">{String(title)}</Text>
          ) : null}
        </View>
      </Pressable>
    );
  }
  if (isAudio) {
    return (
      <Pressable
        onPress={() => void Linking.openURL(url)}
        className="my-1 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
      >
        <Music size={20} color={colors.cyan} />
        <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {String(title ?? url)}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => void Linking.openURL(url)} className="my-1">
      <Image
        source={{ uri: url }}
        style={{ width: '100%', aspectRatio: 16 / 10, borderRadius: 10 }}
        resizeMode="cover"
      />
      {title ? (
        <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
          {String(title)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function FileBrick({ brick }: BrickProps) {
  const url = String(brick.content?.url ?? '');
  const title = String(brick.content?.title ?? brick.content?.name ?? 'archivo');
  return (
    <Pressable
      onPress={() => url && void Linking.openURL(url)}
      className="my-1 flex-row items-center gap-3 rounded-xl border border-border bg-secondary p-3"
    >
      <View className="h-10 w-10 items-center justify-center rounded-lg bg-card">
        <FileText size={18} color={colors.indigo} />
      </View>
      <View className="flex-1">
        <Text
          style={{ fontFamily: fonts.medium }}
          className="text-sm text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {brick.content?.size ? (
          <Text className="text-xs text-muted-foreground">{String(brick.content.size)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

interface ChecklistItem {
  id?: string;
  label?: string;
  text?: string;
  checked?: boolean;
}
function ChecklistBrick({ brick, canEdit, onChange }: BrickProps) {
  const items: ChecklistItem[] = Array.isArray(brick.content?.items) ? brick.content.items : [];
  const toggle = (idx: number) => {
    if (!canEdit || !onChange) return;
    const next = items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it));
    onChange({ ...brick, content: { ...brick.content, items: next } });
  };
  return (
    <View className="my-1 gap-1">
      {items.map((it, i) => (
        <Pressable
          key={it.id ?? i}
          onPress={() => toggle(i)}
          disabled={!canEdit}
          className="flex-row items-start gap-2"
        >
          {it.checked ? (
            <CheckSquare size={15} color={colors.cyan} style={{ marginTop: 2 }} />
          ) : (
            <Square size={15} color={colors.mutedForeground} style={{ marginTop: 2 }} />
          )}
          <View style={{ flex: 1 }}>
            <RichText
              content={String(it.label ?? it.text ?? '')}
              color={it.checked ? colors.mutedForeground : colors.foreground}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

function TableBrick({ brick }: BrickProps) {
  const rows: any[][] = Array.isArray(brick.content?.rows)
    ? brick.content.rows
    : Array.isArray(brick.content?.cells)
      ? brick.content.cells
      : [];
  if (rows.length === 0) return null;
  return (
    <View className="my-1 overflow-hidden rounded-lg border border-border">
      {rows.map((row, ri) => (
        <View
          key={ri}
          className={`flex-row ${ri === 0 ? 'bg-secondary' : 'bg-background'} ${
            ri > 0 ? 'border-t border-border' : ''
          }`}
        >
          {row.map((cell: any, ci: number) => (
            <View
              key={ci}
              className={`flex-1 px-3 py-2 ${ci > 0 ? 'border-l border-border' : ''}`}
            >
              <Text
                style={{ fontFamily: ri === 0 ? fonts.semibold : fonts.regular }}
                className="text-xs text-foreground"
              >
                {String(cell ?? '')}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Composite bricks (recursive) ───────────────────────────────────────────

function AccordionBrick({ brick }: BrickProps) {
  const [open, setOpen] = useState(!!brick.content?.defaultOpen);
  const title = String(brick.content?.title ?? 'Sección');
  const children: Brick[] = Array.isArray(brick.content?.children) ? brick.content.children : [];
  const body = brick.content?.body || brick.content?.text;
  return (
    <View className="my-1 overflow-hidden rounded-lg border border-border">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-2 bg-secondary px-3 py-2"
      >
        {open ? (
          <ChevronDown size={14} color={colors.foreground} />
        ) : (
          <ChevronRight size={14} color={colors.foreground} />
        )}
        <Text style={{ fontFamily: fonts.semibold }} className="flex-1 text-sm text-foreground">
          {title}
        </Text>
      </Pressable>
      {open ? (
        <View className="gap-2 px-3 py-2">
          {body ? <RichText content={String(body)} /> : null}
          {children.map((c, i) => (
            <BrickRenderer key={c.id ?? i} brick={c} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TabsBrick({ brick }: BrickProps) {
  const tabs: { id?: string; label?: string; children?: Brick[] }[] = Array.isArray(
    brick.content?.tabs,
  )
    ? brick.content.tabs
    : [];
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  const cur = tabs[active] ?? tabs[0];
  return (
    <View className="my-1 overflow-hidden rounded-lg border border-border">
      <View className="flex-row gap-1 border-b border-border bg-secondary px-2 py-1">
        {tabs.map((t, i) => (
          <Pressable
            key={t.id ?? i}
            onPress={() => setActive(i)}
            className={`rounded-md px-3 py-1.5 ${i === active ? 'bg-background' : ''}`}
          >
            <Text
              style={{ fontFamily: i === active ? fonts.semibold : fonts.regular }}
              className={`text-xs ${i === active ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {String(t.label ?? `Tab ${i + 1}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="gap-2 p-3">
        {(cur.children ?? []).map((c, i) => (
          <BrickRenderer key={c.id ?? i} brick={c} />
        ))}
      </View>
    </View>
  );
}

function ColumnsBrick({ brick }: BrickProps) {
  const cols: { children?: Brick[] }[] = Array.isArray(brick.content?.columns)
    ? brick.content.columns
    : [];
  return (
    <View className="my-1 flex-row gap-2">
      {cols.map((col, i) => (
        <View key={i} className="flex-1 gap-2">
          {(col.children ?? []).map((c, j) => (
            <BrickRenderer key={c.id ?? j} brick={c} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Preview-only bricks ────────────────────────────────────────────────────

function GraphBrick({ brick }: BrickProps) {
  const title = String(brick.content?.title ?? 'Gráfico');
  return (
    <View className="my-1 rounded-lg border border-border bg-secondary/30 p-3">
      <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-muted-foreground">
        {title}
      </Text>
      <Text className="mt-1 text-[11px] text-muted-foreground">
        Vista previa de gráfico (abre en el web).
      </Text>
    </View>
  );
}

function FormBrick({ brick }: BrickProps) {
  const fields: { label?: string }[] = Array.isArray(brick.content?.fields)
    ? brick.content.fields
    : [];
  return (
    <View className="my-1 gap-2 rounded-lg border border-border bg-secondary/30 p-3">
      <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-muted-foreground">
        Formulario
      </Text>
      {fields.map((f, i) => (
        <View key={i} className="rounded-md border border-border bg-background px-3 py-2">
          <Text className="text-xs text-muted-foreground">{String(f.label ?? `Campo ${i + 1}`)}</Text>
        </View>
      ))}
    </View>
  );
}

function PaymentBrick({ brick }: BrickProps) {
  return (
    <View className="my-1 flex-row items-center gap-3 rounded-lg border border-border bg-card p-3">
      <CreditCard size={18} color={colors.cyan} />
      <View className="flex-1">
        <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
          Pago
        </Text>
        <Text className="text-xs text-muted-foreground">
          {brick.content?.amount ? `${brick.content.amount}` : 'Detalles en el web'}
        </Text>
      </View>
    </View>
  );
}

function AiSummaryBrick({ brick }: BrickProps) {
  return (
    <View
      className="my-1 rounded-lg border p-3"
      style={{ borderColor: colors.cyan + '55', backgroundColor: colors.cyan + '14' }}
    >
      <Text style={{ fontFamily: fonts.semibold, color: colors.cyan }} className="mb-1 text-xs">
        Resumen IA
      </Text>
      <RichText content={textOf(brick.content)} />
    </View>
  );
}

function PopupDocBrick({ brick }: BrickProps) {
  const title = String(brick.content?.title ?? 'Documento');
  return (
    <View className="my-1 flex-row items-center gap-3 rounded-lg border border-border bg-secondary p-3">
      <FileText size={18} color={colors.indigo} />
      <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground">
        {title}
      </Text>
    </View>
  );
}

function EmbedBrick({ brick }: BrickProps) {
  const url = String(brick.content?.url ?? '');
  return (
    <Pressable
      onPress={() => url && void Linking.openURL(url)}
      className="my-1 rounded-lg border border-border bg-card p-3"
    >
      <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
        Contenido embebido
      </Text>
      {url ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {url}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ─── Edit helpers ───────────────────────────────────────────────────────────

import { TextInput } from 'react-native';
function EditableText({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (t: string) => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      multiline
      style={{ fontFamily: fonts.regular, color: colors.foreground, fontSize: 15, padding: 0 }}
      placeholderTextColor={colors.mutedForeground}
    />
  );
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function BrickRenderer(props: BrickProps) {
  const { brick } = props;
  switch (brick.kind) {
    case 'text':
    case 'heading':
      return <TextBrick {...props} />;
    case 'quote':
      return <QuoteBrick {...props} />;
    case 'callout':
      return <CalloutBrick {...props} />;
    case 'divider':
      return <DividerBrick />;
    case 'code':
      return <CodeBrick {...props} />;
    case 'image':
    case 'media':
    case 'video':
    case 'audio':
      return <MediaBrick {...props} />;
    case 'file':
      return <FileBrick {...props} />;
    case 'checklist':
      return <ChecklistBrick {...props} />;
    case 'table':
    case 'beautiful_table':
    case 'bountiful_table':
      return <TableBrick {...props} />;
    case 'accordion':
      return <AccordionBrick {...props} />;
    case 'tabs':
      return <TabsBrick {...props} />;
    case 'columns':
      return <ColumnsBrick {...props} />;
    case 'graph':
    case 'chart':
      return <GraphBrick {...props} />;
    case 'form':
      return <FormBrick {...props} />;
    case 'payment':
      return <PaymentBrick {...props} />;
    case 'ai_summary':
      return <AiSummaryBrick {...props} />;
    case 'popup_document':
      return <PopupDocBrick {...props} />;
    case 'embed':
      return <EmbedBrick {...props} />;
    default:
      return (
        <View className="my-1 rounded-md border border-border bg-secondary/40 p-2">
          <Text className="text-xs text-muted-foreground">[bloque: {brick.kind}]</Text>
        </View>
      );
  }
}

/** Vertical stack of bricks, sorted by position. */
export function BrickList({
  bricks,
  canEdit,
  onChange,
}: {
  bricks: Brick[];
  canEdit?: boolean;
  onChange?: (id: string, next: Brick) => void;
}) {
  const sorted = [...bricks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return (
    <View className="gap-2">
      {sorted.map((b, i) => (
        <BrickRenderer
          key={b.id ?? i}
          brick={b}
          canEdit={canEdit}
          onChange={onChange ? (next) => onChange(b.id ?? String(i), next) : undefined}
        />
      ))}
    </View>
  );
}
