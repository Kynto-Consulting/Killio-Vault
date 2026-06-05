import { useState } from 'react';
import { Image, Linking, Modal, Pressable, Text, TextInput, View } from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  CreditCard,
  FileText,
  Hash,
  Heading1,
  Lightbulb,
  Minus,
  Plus,
  Quote,
  Square,
  Trash2,
  Type,
  Video,
  Music,
} from 'lucide-react-native';

import { RichText } from './RichText';
import { InlineFormatToolbar } from './InlineFormatToolbar';
import { LatexEditor } from './LatexEditor';
import { MathRenderer } from './MathRenderer';
import {
  BountifulTable,
  type BountifulCell,
  type BountifulColumn,
  type BountifulRow,
} from './BountifulTable';
import { useTranslations } from '../i18n';
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

function CodeBrick({ brick, canEdit, onChange }: BrickProps) {
  const code = String(
    brick.content?.code ?? brick.content?.text ?? brick.content?.markdown ?? '',
  );
  const lang = brick.content?.lang || brick.content?.language;
  if (canEdit && onChange) {
    return (
      <View className="my-1 rounded-md border border-cyan/40 bg-secondary p-3 gap-2">
        <TextInput
          value={String(lang ?? '')}
          onChangeText={(v) =>
            onChange({ ...brick, content: { ...brick.content, language: v, lang: v } })
          }
          placeholder="language"
          placeholderTextColor={colors.mutedForeground}
          style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.mutedForeground, padding: 0 }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          value={code}
          onChangeText={(v) =>
            onChange({ ...brick, content: { ...brick.content, code: v, text: v } })
          }
          multiline
          style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.foreground, padding: 0, minHeight: 60 }}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  }
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

function MediaBrick({ brick, canEdit, onChange }: BrickProps) {
  const url = String(brick.content?.url ?? brick.content?.src ?? '');
  if (canEdit && onChange) {
    return (
      <View className="my-1 rounded-xl border border-cyan/40 bg-card p-3 gap-2">
        <TextInput
          value={url}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, url: v, src: v } })}
          placeholder="https://… (URL del medio)"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground, padding: 0 }}
        />
        <TextInput
          value={String(brick.content?.title ?? brick.content?.alt ?? '')}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, title: v, alt: v } })}
          placeholder="Título (opcional)"
          placeholderTextColor={colors.mutedForeground}
          style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.foreground, padding: 0 }}
        />
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: '100%', aspectRatio: 16 / 10, borderRadius: 8 }}
            resizeMode="cover"
          />
        ) : null}
      </View>
    );
  }
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

function FileBrick({ brick, canEdit, onChange }: BrickProps) {
  const url = String(brick.content?.url ?? '');
  const title = String(brick.content?.title ?? brick.content?.name ?? 'archivo');
  if (canEdit && onChange) {
    return (
      <View className="my-1 rounded-xl border border-cyan/40 bg-secondary p-3 gap-2">
        <TextInput
          value={url}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, url: v } })}
          placeholder="https://… (URL)"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground, padding: 0 }}
        />
        <TextInput
          value={title}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, title: v, name: v } })}
          placeholder="Nombre"
          placeholderTextColor={colors.mutedForeground}
          style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.foreground, padding: 0 }}
        />
      </View>
    );
  }
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

// ─── Bookmark + Math ────────────────────────────────────────────────────────

function BookmarkBrick({ brick, canEdit, onChange }: BrickProps) {
  const url = String(brick.content?.url ?? brick.content?.href ?? '');
  const title = String(brick.content?.title ?? brick.content?.name ?? url ?? '');
  const description = String(brick.content?.description ?? brick.content?.summary ?? '');
  const favicon = String(brick.content?.favicon ?? '');
  if (canEdit && onChange) {
    return (
      <View className="my-1 rounded-xl border border-cyan/40 bg-secondary p-3 gap-2">
        <TextInput
          value={url}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, url: v, href: v } })}
          placeholder="https://… (URL)"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.foreground, padding: 0 }}
        />
        <TextInput
          value={title}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, title: v } })}
          placeholder="Título"
          placeholderTextColor={colors.mutedForeground}
          style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground, padding: 0 }}
        />
        <TextInput
          value={description}
          onChangeText={(v) => onChange({ ...brick, content: { ...brick.content, description: v } })}
          placeholder="Descripción"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.foreground, padding: 0 }}
        />
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => url && void Linking.openURL(url)}
      className="my-1 rounded-xl border border-border bg-secondary p-3 gap-1"
    >
      <View className="flex-row items-center gap-2">
        {favicon ? (
          <Image source={{ uri: favicon }} style={{ width: 14, height: 14 }} />
        ) : (
          <FileText size={12} color={colors.indigo} />
        )}
        <Text
          style={{ fontFamily: fonts.semibold }}
          className="flex-1 text-sm text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {description ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {description}
        </Text>
      ) : null}
      <Text className="text-[10px] text-cyan" numberOfLines={1}>
        {url}
      </Text>
    </Pressable>
  );
}

function MathBrick({ brick, canEdit, onChange }: BrickProps) {
  const formula = String(brick.content?.formula ?? brick.content?.latex ?? brick.content?.math ?? '');
  const display = brick.content?.display !== false;
  if (canEdit && onChange) {
    return (
      <View className="my-1">
        <LatexEditor
          value={formula}
          onChange={(v) => onChange({ ...brick, content: { ...brick.content, formula: v, latex: v } })}
          display={display}
          onToggleDisplay={(next) =>
            onChange({ ...brick, content: { ...brick.content, display: next } })
          }
        />
      </View>
    );
  }
  return (
    <View className="my-1 rounded-md border border-border bg-card p-2">
      <MathRenderer formula={formula} display={display} />
    </View>
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

function TableBrick({ brick, canEdit, onChange }: BrickProps) {
  // Bountiful tables (rich cell objects, named columns/rows) are not yet
  // editable inline — they ship through patch-cell / patch-column APIs the
  // web surface owns. Simple tables get a tap-to-edit cell grid.
  const isBountiful = brick.kind === 'bountiful_table' || brick.kind === 'beautiful_table';
  const rows: any[][] = Array.isArray(brick.content?.rows)
    ? brick.content.rows
    : Array.isArray(brick.content?.cells)
      ? brick.content.cells
      : [];

  if (canEdit && onChange && !isBountiful) {
    const setCell = (ri: number, ci: number, val: string) => {
      const next = rows.map((r) => (Array.isArray(r) ? [...r] : []));
      while (next.length <= ri) next.push([]);
      while (next[ri].length <= ci) next[ri].push('');
      next[ri][ci] = val;
      onChange({ ...brick, content: { ...brick.content, rows: next } });
    };
    const addRow = () => {
      const cols = rows[0]?.length ?? 1;
      onChange({
        ...brick,
        content: {
          ...brick.content,
          rows: [...rows, Array.from({ length: cols }, () => '')],
        },
      });
    };
    const addCol = () => {
      onChange({
        ...brick,
        content: {
          ...brick.content,
          rows: rows.map((r) => (Array.isArray(r) ? [...r, ''] : [''])),
        },
      });
    };
    const removeRow = (ri: number) => {
      onChange({ ...brick, content: { ...brick.content, rows: rows.filter((_, i) => i !== ri) } });
    };
    const removeCol = (ci: number) => {
      onChange({
        ...brick,
        content: {
          ...brick.content,
          rows: rows.map((r) => (Array.isArray(r) ? r.filter((_, i) => i !== ci) : r)),
        },
      });
    };
    return (
      <View className="my-1 overflow-hidden rounded-lg border border-cyan/40">
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
                className={`flex-1 px-2 py-1 ${ci > 0 ? 'border-l border-border' : ''}`}
              >
                <TextInput
                  value={String(cell ?? '')}
                  onChangeText={(v) => setCell(ri, ci, v)}
                  style={{
                    fontFamily: ri === 0 ? fonts.semibold : fonts.regular,
                    fontSize: 12,
                    color: colors.foreground,
                    padding: 0,
                  }}
                />
              </View>
            ))}
            <Pressable onPress={() => removeRow(ri)} hitSlop={4} className="px-1 justify-center">
              <Text className="text-[10px] text-destructive">×</Text>
            </Pressable>
          </View>
        ))}
        <View className="flex-row border-t border-border bg-background">
          <Pressable onPress={addRow} className="flex-1 items-center py-1 border-r border-border">
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">+ row</Text>
          </Pressable>
          <Pressable onPress={addCol} className="flex-1 items-center py-1 border-r border-border">
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">+ col</Text>
          </Pressable>
          <Pressable
            onPress={() => removeCol((rows[0]?.length ?? 1) - 1)}
            className="flex-1 items-center py-1"
          >
            <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-muted-foreground">− col</Text>
          </Pressable>
        </View>
      </View>
    );
  }

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

function AccordionBrick({ brick, canEdit, onChange }: BrickProps) {
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
        {canEdit && onChange ? (
          <TextInput
            value={title}
            onChangeText={(v) =>
              onChange({ ...brick, content: { ...brick.content, title: v } })
            }
            style={{
              fontFamily: fonts.semibold,
              color: colors.foreground,
              flex: 1,
              padding: 0,
              fontSize: 14,
            }}
          />
        ) : (
          <Text style={{ fontFamily: fonts.semibold }} className="flex-1 text-sm text-foreground">
            {title}
          </Text>
        )}
      </Pressable>
      {open ? (
        <View className="gap-2 px-3 py-2">
          {canEdit && onChange ? (
            <TextInput
              value={String(body ?? '')}
              onChangeText={(v) =>
                onChange({ ...brick, content: { ...brick.content, body: v, text: v } })
              }
              multiline
              placeholder="Texto de la sección…"
              placeholderTextColor={colors.mutedForeground}
              style={{ fontFamily: fonts.regular, color: colors.foreground, padding: 0, fontSize: 14 }}
            />
          ) : body ? (
            <RichText content={String(body)} />
          ) : null}
          {children.map((c, i) => (
            <BrickRenderer
              key={c.id ?? i}
              brick={c}
              canEdit={canEdit}
              onChange={
                canEdit && onChange
                  ? (next) => {
                      const arr = [...children];
                      arr[i] = next;
                      onChange({ ...brick, content: { ...brick.content, children: arr } });
                    }
                  : undefined
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TabsBrick({ brick, canEdit, onChange }: BrickProps) {
  const tabs: { id?: string; label?: string; children?: Brick[] }[] = Array.isArray(
    brick.content?.tabs,
  )
    ? brick.content.tabs
    : [];
  const [active, setActive] = useState(0);
  if (tabs.length === 0 && !canEdit) return null;

  const updateTabs = (next: typeof tabs) => {
    if (!onChange) return;
    onChange({ ...brick, content: { ...brick.content, tabs: next } });
  };

  const cur = tabs[active] ?? tabs[0] ?? { label: '', children: [] };
  return (
    <View className="my-1 overflow-hidden rounded-lg border border-border">
      <View className="flex-row gap-1 border-b border-border bg-secondary px-2 py-1">
        {tabs.map((tab, i) => (
          <Pressable
            key={tab.id ?? i}
            onPress={() => setActive(i)}
            className={`rounded-md px-3 py-1.5 ${i === active ? 'bg-background' : ''}`}
          >
            {canEdit && onChange ? (
              <TextInput
                value={String(tab.label ?? `Tab ${i + 1}`)}
                onChangeText={(v) => {
                  const next = [...tabs];
                  next[i] = { ...next[i], label: v };
                  updateTabs(next);
                }}
                style={{
                  fontFamily: i === active ? fonts.semibold : fonts.regular,
                  color: i === active ? colors.foreground : colors.mutedForeground,
                  fontSize: 12,
                  padding: 0,
                  minWidth: 50,
                }}
              />
            ) : (
              <Text
                style={{ fontFamily: i === active ? fonts.semibold : fonts.regular }}
                className={`text-xs ${i === active ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {String(tab.label ?? `Tab ${i + 1}`)}
              </Text>
            )}
          </Pressable>
        ))}
        {canEdit && onChange ? (
          <Pressable
            onPress={() => {
              const next = [...tabs, { label: `Tab ${tabs.length + 1}`, children: [] }];
              updateTabs(next);
              setActive(next.length - 1);
            }}
            className="rounded-md px-2 py-1"
          >
            <Text style={{ fontFamily: fonts.semibold }} className="text-xs text-cyan">＋</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="gap-2 p-3">
        {(cur.children ?? []).map((c, i) => (
          <BrickRenderer
            key={c.id ?? i}
            brick={c}
            canEdit={canEdit}
            onChange={
              canEdit && onChange
                ? (next) => {
                    const tabsCopy = [...tabs];
                    const tabCopy = { ...tabsCopy[active] };
                    const ch = [...(tabCopy.children ?? [])];
                    ch[i] = next;
                    tabCopy.children = ch;
                    tabsCopy[active] = tabCopy;
                    updateTabs(tabsCopy);
                  }
                : undefined
            }
          />
        ))}
      </View>
    </View>
  );
}

function ColumnsBrick({ brick, canEdit, onChange }: BrickProps) {
  const cols: { children?: Brick[] }[] = Array.isArray(brick.content?.columns)
    ? brick.content.columns
    : [];
  const updateCol = (idx: number, nextCol: { children?: Brick[] }) => {
    if (!onChange) return;
    const arr = [...cols];
    arr[idx] = nextCol;
    onChange({ ...brick, content: { ...brick.content, columns: arr } });
  };
  return (
    <View className="my-1 flex-row gap-2">
      {cols.map((col, i) => (
        <View key={i} className="flex-1 gap-2">
          {(col.children ?? []).map((c, j) => (
            <BrickRenderer
              key={c.id ?? j}
              brick={c}
              canEdit={canEdit}
              onChange={
                canEdit && onChange
                  ? (next) => {
                      const ch = [...(col.children ?? [])];
                      ch[j] = next;
                      updateCol(i, { ...col, children: ch });
                    }
                  : undefined
              }
            />
          ))}
        </View>
      ))}
      {canEdit && onChange ? (
        <Pressable
          onPress={() => onChange({ ...brick, content: { ...brick.content, columns: [...cols, { children: [] }] } })}
          className="self-start rounded-md border border-dashed border-cyan/40 px-2 py-1"
        >
          <Text style={{ fontFamily: fonts.semibold }} className="text-[10px] text-cyan">＋ col</Text>
        </Pressable>
      ) : null}
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

// ─── Bountiful table adapter ────────────────────────────────────────────────

/**
 * Bridges the cell-typed BountifulTable to the BrickRenderer onChange surface.
 * Whole-content edits (column add, row add) go through onChange; cell patches
 * also flow through onChange because the BrickList wrapping this dispatcher
 * routes the eventual PUT through documents API — the realtime
 * `brick.cell_patched` delta is emitted by the backend once the brick content
 * round-trips. A future pass can swap this for the cell-patch endpoint to
 * skip the brick-wide PUT.
 */
function BountifulTableAdapter({ brick, canEdit, onChange }: BrickProps) {
  const columns: BountifulColumn[] = Array.isArray(brick.content?.columns)
    ? (brick.content.columns as BountifulColumn[])
    : [];
  const rows: BountifulRow[] = Array.isArray(brick.content?.rows)
    ? (brick.content.rows as BountifulRow[])
    : [];

  return (
    <BountifulTable
      brickId={brick.id ?? ''}
      title={brick.content?.title}
      columns={columns}
      rows={rows}
      readonly={!canEdit || !onChange}
      onPatchCell={(rowId, colId, cell, rowMeta) => {
        if (!onChange) return;
        const nextRows = rows.map((r) =>
          r.id === rowId
            ? {
                ...r,
                cells: { ...(r.cells ?? {}), [colId]: cell as BountifulCell },
                ...rowMeta,
              }
            : r,
        );
        onChange({ ...brick, content: { ...brick.content, rows: nextRows } });
      }}
      onUpdate={(next) => {
        if (!onChange) return;
        onChange({
          ...brick,
          content: {
            ...brick.content,
            title: next.title,
            columns: next.columns,
            rows: next.rows,
          },
        });
      }}
    />
  );
}

// ─── Edit helpers ───────────────────────────────────────────────────────────

function EditableText({
  value,
  onChangeText,
  disabledStyles,
}: {
  value: string;
  onChangeText: (t: string) => void;
  disabledStyles?: string[];
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Delay blur so a toolbar tap can land before the toolbar disappears.
          setTimeout(() => setFocused(false), 150);
        }}
        multiline
        style={{ fontFamily: fonts.regular, color: colors.foreground, fontSize: 15, padding: 0 }}
        placeholderTextColor={colors.mutedForeground}
      />
      {focused ? (
        <View className="mt-2">
          <InlineFormatToolbar
            visible
            value={value}
            onChange={onChangeText}
            disabledStyles={disabledStyles}
          />
        </View>
      ) : null}
    </View>
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
      return <TableBrick {...props} />;
    case 'beautiful_table':
    case 'bountiful_table':
    case 'database':
      return <BountifulTableAdapter {...props} />;
    case 'bookmark':
      return <BookmarkBrick {...props} />;
    case 'math':
      return <MathBrick {...props} />;
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

/** All brick kinds the "+" menu can insert. Subset that has a meaningful
 *  inline editor — composite / media bricks are added through the asset
 *  pipelines. */
export type AddableKind =
  | 'text'
  | 'heading'
  | 'quote'
  | 'callout'
  | 'checklist'
  | 'code'
  | 'divider';

/**
 * Vertical stack of bricks. When `editable=true`, each brick switches to its
 * inline editor on tap (same flow as the web — no separate edit overlay) and
 * a "+" affordance appears between rows for inserting new bricks. Long-press a
 * brick to open a context menu (move up/down, copy, delete). When
 * `editable=false`, the list is read-only.
 *
 * Callers wire `onUpdate / onAdd / onDelete / onReorder` to their backend (the
 * Vault cloud doc API or the local-workspace .kd writer). Returning a new id
 * from `onAdd` lets the list move focus to the freshly-inserted brick.
 */
export function BrickList({
  bricks,
  editable = false,
  onUpdate,
  onAdd,
  onDelete,
  onReorder,
}: {
  bricks: Brick[];
  editable?: boolean;
  onUpdate?: (id: string, next: Brick) => void;
  onAdd?: (kind: AddableKind, afterBrickId?: string) => Promise<string | void> | string | void;
  onDelete?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
}) {
  const t = useTranslations('brickEditor');
  const sorted = [...bricks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [addMenuFor, setAddMenuFor] = useState<string | 'end' | null>(null);
  const [contextFor, setContextFor] = useState<string | null>(null);

  const moveBrick = (id: string, dir: 'up' | 'down') => {
    if (!onReorder) return;
    const ids = sorted.map((b) => b.id!).filter(Boolean);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorder(next);
  };

  return (
    <View className="gap-1">
      {sorted.length === 0 && editable && onAdd ? (
        <Pressable
          onPress={() => setAddMenuFor('end')}
          className="items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-4 py-8"
        >
          <View className="mb-2 h-8 w-8 items-center justify-center rounded-full bg-cyan/10">
            <Plus size={14} color={colors.cyan} />
          </View>
          <Text style={{ fontFamily: fonts.semibold }} className="text-sm text-foreground">
            {t('addBlock')}
          </Text>
        </Pressable>
      ) : null}

      {sorted.map((b, i) => {
        const id = b.id ?? String(i);
        const isFocused = focusedId === id;
        return (
          <View key={id}>
            <Pressable
              onPress={() => {
                if (!editable) return;
                setFocusedId((cur) => (cur === id ? null : id));
              }}
              onLongPress={() => {
                if (!editable) return;
                setContextFor(id);
              }}
              className={`rounded-md ${
                isFocused
                  ? 'border border-cyan/30 bg-card px-1 py-1'
                  : 'border border-transparent'
              }`}
            >
              <BrickRenderer
                brick={b}
                canEdit={editable && isFocused}
                onChange={
                  onUpdate
                    ? (next) => {
                        if (!b.id) return;
                        onUpdate(b.id, next);
                      }
                    : undefined
                }
              />
            </Pressable>

            {editable && onAdd && b.id ? (
              <Pressable
                onPress={() => setAddMenuFor(b.id!)}
                className="my-0.5 flex-row items-center gap-1 self-center rounded-full bg-secondary/40 px-2 py-0.5 opacity-50"
              >
                <Plus size={9} color={colors.mutedForeground} />
                <Text className="text-[9px] text-muted-foreground">{t('addInline')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {editable && onAdd && sorted.length > 0 ? (
        <Pressable
          onPress={() => setAddMenuFor('end')}
          className="mt-1 flex-row items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-card/40 py-2"
        >
          <Plus size={12} color={colors.mutedForeground} />
          <Text style={{ fontFamily: fonts.medium }} className="text-xs text-muted-foreground">
            {t('addAtEnd')}
          </Text>
        </Pressable>
      ) : null}

      <AddKindModal
        open={addMenuFor !== null}
        onClose={() => setAddMenuFor(null)}
        onPick={async (kind) => {
          const after = addMenuFor === 'end' ? undefined : (addMenuFor as string);
          setAddMenuFor(null);
          const next = await onAdd?.(kind, after);
          if (typeof next === 'string') setFocusedId(next);
        }}
      />

      <ContextMenu
        open={contextFor !== null}
        onClose={() => setContextFor(null)}
        onMoveUp={() => {
          if (contextFor) moveBrick(contextFor, 'up');
          setContextFor(null);
        }}
        onMoveDown={() => {
          if (contextFor) moveBrick(contextFor, 'down');
          setContextFor(null);
        }}
        onDelete={() => {
          if (contextFor) onDelete?.(contextFor);
          setContextFor(null);
        }}
      />
    </View>
  );
}

const ADD_OPTIONS: { kind: AddableKind; labelKey: string; icon: typeof Type }[] = [
  { kind: 'text', labelKey: 'kind.text', icon: Type },
  { kind: 'heading', labelKey: 'kind.heading', icon: Heading1 },
  { kind: 'quote', labelKey: 'kind.quote', icon: Quote },
  { kind: 'callout', labelKey: 'kind.callout', icon: Hash },
  { kind: 'checklist', labelKey: 'kind.checklist', icon: CheckSquare },
  { kind: 'code', labelKey: 'kind.code', icon: Code },
  { kind: 'divider', labelKey: 'kind.divider', icon: Minus },
];

function AddKindModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose(): void;
  onPick(kind: AddableKind): void;
}) {
  const t = useTranslations('brickEditor');
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 items-center justify-end bg-background/80">
        <View className="w-full rounded-t-2xl border-t border-border bg-card p-4 gap-2">
          <Text style={{ fontFamily: fonts.bold }} className="text-base text-foreground">
            {t('addBlock')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {ADD_OPTIONS.map(({ kind, labelKey, icon: Icon }) => (
              <Pressable
                key={kind}
                onPress={() => onPick(kind)}
                className="h-20 w-20 items-center justify-center gap-1 rounded-xl border border-border bg-background"
              >
                <Icon size={18} color={colors.foreground} />
                <Text style={{ fontFamily: fonts.medium }} className="text-[10px] text-foreground">
                  {t(labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function ContextMenu({
  open,
  onClose,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  open: boolean;
  onClose(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  onDelete(): void;
}) {
  const t = useTranslations('brickEditor');
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-background/80 p-6">
        <View className="w-full max-w-xs rounded-xl border border-border bg-card p-2 gap-1">
          <ContextItem icon={ArrowUp} label={t('actions.up')} onPress={onMoveUp} />
          <ContextItem icon={ArrowDown} label={t('actions.down')} onPress={onMoveDown} />
          <View className="h-px bg-border/40 my-1" />
          <ContextItem icon={Trash2} label={t('actions.delete')} onPress={onDelete} tone="danger" />
        </View>
      </Pressable>
    </Modal>
  );
}

function ContextItem({
  icon: Icon,
  label,
  onPress,
  tone,
}: {
  icon: typeof Type;
  label: string;
  onPress(): void;
  tone?: 'danger';
}) {
  const color = tone === 'danger' ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-md px-3 py-2 active:bg-secondary"
    >
      <Icon size={14} color={color} />
      <Text style={{ fontFamily: fonts.medium, color }} className="text-sm">
        {label}
      </Text>
    </Pressable>
  );
}

void Copy;
