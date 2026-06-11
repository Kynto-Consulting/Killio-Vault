import React, { Fragment, createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { FileText } from 'lucide-react-native';

import { RefPill, type RefType } from './RefPill';
import { ReferencePicker, type ReferencePickerProps } from './ReferencePicker';
import { resolveLucide } from './lucide-registry';
import { MathRenderer } from './MathRenderer';
import { API_BASE_URL } from '../core/api/config';
import { colors, typography } from '../theme/theme';
import { fonts } from '../theme/fonts';
import { useI18n } from '../i18n';
import type { MentionType } from '../types/picker';

/**
 * 1:1 port of Killio-Frontend src/components/ui/rich-text.tsx to React Native.
 *
 * Supports:
 *   - Block: fenced ```code``` (mermaid/grarkdown/erDiagram/html-preview/plain),
 *     $$math$$ (rendered as a styled code block — KaTeX is web-only).
 *   - Line: headings #..######, references @[..] / $[..] / #[..].
 *   - Inline markdown: **bold**, __underline__, ~~strike~~, *italic*, _italic_,
 *     `inline code`, $inline math$ (styled code), tag.native.X / tag.custom.X.
 *   - Inline tokens: [lu:NAME:SW] → Lucide icon at 1em with inherited color.
 *   - Wrappers (balanced, nestable): [bg:HEX]...[/bg], [color:HEX]...[/color],
 *     [size:14px]...[/size], [width:Npx]...[/width], [link:URL]...[/link].
 *
 * Skipped (not portable to RN): KaTeX math rendering, AI suggestion blocks,
 * mermaid → real mesh — those degrade to monospace blocks so content still
 * round-trips between Vault and the web app without data loss.
 */

interface RichTextProps {
  content: string;
  color?: string;
  size?: number;
  onReferencePress?(type: string, id: string): void;
  /** Disable specific styles (used by table cells, etc). Same flags as web. */
  disabledStyles?: string[];
  /** Make all rendered text OS-selectable (long-press to select/copy). Used by
   *  the assistant chat bubbles for a Gemini-like UX. */
  selectable?: boolean;
  // ── Edit mode ──────────────────────────────────────────────────────────────
  // When `editable=true`, RichText flips to a TextInput that emits `onChange`
  // on every keystroke. Typing `@` (or `$`, `#`) opens the ReferencePicker
  // scoped to the matching category set; picking inserts the canonical
  // `@[type:id:Name]` token at the cursor (replacing the trigger char).
  editable?: boolean;
  onChange?(next: string): void;
  /** Optional placeholder for the editable input. */
  placeholder?: string;
  /** Optional autoFocus when entering edit mode. */
  autoFocus?: boolean;
  // Picker candidate lists. Empty/undefined = picker still opens but only
  // categories with data show up. Falls back to API via teamId if set.
  documents?: ReferencePickerProps['documents'];
  boards?: ReferencePickerProps['boards'];
  cards?: ReferencePickerProps['cards'];
  users?: ReferencePickerProps['users'];
  folders?: ReferencePickerProps['folders'];
  activeBricks?: ReferencePickerProps['activeBricks'];
  teamId?: string;
}

// Picker scopes per trigger char — matches the web reference-picker behaviour:
//   `@` → mention anything (user/doc/card/board/mesh)
//   `$` → deep-link to a document
//   `#` → deep-link to a card/board
const TRIGGER_SCOPE: Record<string, MentionType[]> = {
  '@': ['user', 'doc', 'card', 'board', 'mesh', 'folder', 'room'],
  $: ['doc'],
  '#': ['card', 'board', 'mesh'],
};

const REF_SPLIT_RE =
  /(@\[ext:[^\]]+\]|@\[(?:doc|board|mesh|card|user|folder|room|thread|transcript|event):[^\]]+\]|[$#]\[[^\]]+\])/g;
const EXT_RE = /@\[ext:([^:\]]+):([^:\]]+):([^:\]]+):([^\]]*)\]/;
// Accepts both `@[type:id:Display Name]` and `@[type:id|Display Name]`.
// The pipe form is what the web reference-picker emits in the task spec; the
// colon form is what `Killio-Frontend/.../reference-picker.tsx` actually writes
// (`@[doc:abc:Title]`). Be permissive on the display separator so a token
// authored in either app round-trips identically.
const MENTION_RE =
  /@\[(doc|board|mesh|card|user|folder|room|thread|transcript|event):([^:|\]]+)(?:[:|]([^\]]+))?\]/;
const DEEP_RE = /^[$#]\[([^\]]+)\]$/;

type RefToken =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; type: RefType; id: string; name: string };

const HEADING_FONT_SIZES = [24, 20, 18, 16, 15, 14];
const HEADING_LINE_HEIGHTS = [30, 26, 22, 20, 18, 18];

const FENCED_CODE_RE = /```[\w[\]-]*\n[\s\S]*?```/;
const ASSET_RE = /<asset\b[^>]*\/?>/g;

// When true, every leaf <Text> RichText renders is OS-selectable (long-press →
// select/copy), mirroring Gemini's selectable chat bubbles. Threaded via context
// so the dozen leaf renderers don't each need an extra prop. Default false keeps
// existing call sites (doc/card bricks) unchanged.
const SelectableContext = createContext(false);
function useSelectable(): boolean {
  return useContext(SelectableContext);
}

// Active BCP-47 locale, threaded down so the module-level leaf renderers can
// localize `[t:UNIX:fmt]` date tokens without each one calling a hook. Mirrors
// the SelectableContext pattern above. Defaults to Spanish (the app default).
const LocaleContext = createContext('es');
function useLocaleTag(): string {
  return useContext(LocaleContext);
}

// The three token formats a date can render as (1:1 port of the frontend's
// inline-pickers.ts formatDateToken). Kept as a `[t:UNIX:fmt]` token so it
// re-localizes on every render. `unix` is SECONDS (new Date(unix*1000)):
//   - date:    day month year       (24 de mayo de 2026)
//   - time:    day month + hour      (24 de mayo, 18:00)
//   - time-to: relative from now     (en 3 días / hace 2 horas)
type DateTokenFormat = 'date' | 'time' | 'time-to';

function formatDateToken(unix: number, fmt: DateTokenFormat, locale: string): string {
  const dt = new Date(unix * 1000);
  if (Number.isNaN(dt.getTime())) return '';
  if (fmt === 'time') {
    return dt.toLocaleString(locale, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (fmt === 'time-to') {
    const diffSec = unix - Math.floor(Date.now() / 1000);
    const abs = Math.abs(diffSec);
    try {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', 31536000],
        ['month', 2592000],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
      ];
      for (const [unit, secs] of units) {
        if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit);
      }
      return rtf.format(diffSec, 'second');
    } catch {
      // Intl.RelativeTimeFormat may be missing on very old engines — fall back
      // to the absolute date so the pill still shows something meaningful.
      return dt.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  return dt.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── Public component ────────────────────────────────────────────────────────

export function RichText({
  content,
  color = colors.foreground,
  size = 15,
  onReferencePress,
  disabledStyles = [],
  selectable = false,
  editable,
  onChange,
  placeholder,
  autoFocus,
  documents,
  boards,
  cards,
  users,
  folders,
  activeBricks,
  teamId,
}: RichTextProps) {
  // Active locale (es/en/…) → drives `[t:UNIX:fmt]` date-token localization in
  // the display path. Read once here and provided via context so leaf renderers
  // don't each call the hook.
  const { locale } = useI18n();

  // Edit mode short-circuits the whole render tree — we hand control to
  // RichTextEditor which owns the TextInput + ReferencePicker overlay.
  if (editable && onChange) {
    return (
      <RichTextEditor
        value={content ?? ''}
        onChange={onChange}
        color={color}
        size={size}
        placeholder={placeholder}
        autoFocus={autoFocus}
        documents={documents}
        boards={boards}
        cards={cards}
        users={users}
        folders={folders}
        activeBricks={activeBricks}
        teamId={teamId}
      />
    );
  }
  return (
    <LocaleContext.Provider value={locale}>
      <RichTextInner
        content={content}
        color={color}
        size={size}
        onReferencePress={onReferencePress}
        disabledStyles={disabledStyles}
        selectable={selectable}
      />
    </LocaleContext.Provider>
  );
}

/**
 * Non-editable render path. Split out so the public RichText can wrap it once in
 * the SelectableContext provider — the prop only needs to be set at the outer
 * call site (the chat bubble); every recursive RichText/leaf Text below inherits
 * it from context.
 */
function RichTextInner({
  content,
  color,
  size,
  onReferencePress,
  disabledStyles,
  selectable,
}: {
  content: string;
  color: string;
  size: number;
  onReferencePress?(type: string, id: string): void;
  disabledStyles: string[];
  selectable: boolean;
}) {
  const inheritedSelectable = useSelectable();
  const eff = selectable || inheritedSelectable;
  const body = renderRichBody({ content, color, size, onReferencePress, disabledStyles });
  if (!eff) return body;
  return <SelectableContext.Provider value={true}>{body}</SelectableContext.Provider>;
}

function renderRichBody({
  content,
  color,
  size,
  onReferencePress,
  disabledStyles,
}: {
  content: string;
  color: string;
  size: number;
  onReferencePress?(type: string, id: string): void;
  disabledStyles: string[];
}): React.ReactElement | null {
  if (!content) return null;
  const noHeading = disabledStyles.includes('heading');
  const noSize = disabledStyles.includes('size');

  // Block-level passes: $$math$$, ``` fenced code ```, then <asset .../>.
  if (content.includes('$$')) {
    const parts = content.split(/(\$\$[\s\S]*?\$\$)/g);
    if (parts.length > 1) {
      return (
        <View>
          {parts.map((part, i) => {
            if (part.startsWith('$$') && part.endsWith('$$')) {
              return <MathBlock key={i} math={part.slice(2, -2).trim()} />;
            }
            if (!part) return null;
            return (
              <RichText
                key={i}
                content={part}
                color={color}
                size={size}
                onReferencePress={onReferencePress}
                disabledStyles={disabledStyles}
              />
            );
          })}
        </View>
      );
    }
  }

  if (FENCED_CODE_RE.test(content)) {
    const parts = content.split(/(```[\w[\]-]*\n[\s\S]*?```)/g);
    return (
      <View>
        {parts.map((part, i) => {
          const cm = part.match(/^```([\w[\]-]*)\n([\s\S]*?)```$/);
          if (cm) {
            const [, lang, code] = cm;
            const body = code.replace(/\n$/, '');
            return <FencedCodeBlock key={i} lang={lang} body={body} />;
          }
          if (!part) return null;
          return (
            <RichText
              key={i}
              content={part}
              color={color}
              size={size}
              onReferencePress={onReferencePress}
              disabledStyles={disabledStyles}
            />
          );
        })}
      </View>
    );
  }

  // GitHub-style markdown tables: contiguous `| a | b |` lines whose second
  // line is a `|---|---|` separator → native table block. Runs after the
  // fenced-code pass so tables inside ``` blocks stay literal.
  if (content.includes('|')) {
    const segs = splitMarkdownTables(content);
    if (segs.some((s) => s.type === 'table')) {
      return (
        <View>
          {segs.map((seg, i) => {
            if (seg.type === 'table') {
              return <MarkdownTable key={i} header={seg.header} rows={seg.rows} size={size} />;
            }
            if (!seg.value.trim()) return null;
            return (
              <RichText
                key={i}
                content={seg.value}
                color={color}
                size={size}
                onReferencePress={onReferencePress}
                disabledStyles={disabledStyles}
              />
            );
          })}
        </View>
      );
    }
  }

  // Strip out <asset .../> tags as block nodes; render remaining content as
  // text lines.
  if (ASSET_RE.test(content)) {
    ASSET_RE.lastIndex = 0;
    const segments = content.split(ASSET_RE);
    const assetTags = content.match(ASSET_RE) ?? [];
    const blocks: React.ReactNode[] = [];
    segments.forEach((seg, i) => {
      if (seg.trim()) {
        blocks.push(
          <TextLines
            key={`t${i}`}
            content={seg}
            color={color}
            size={size}
            noHeading={noHeading}
            noSize={noSize}
            onReferencePress={onReferencePress}
          />,
        );
      }
      if (assetTags[i]) blocks.push(<AssetBlock key={`a${i}`} tag={assetTags[i]} />);
    });
    return <View>{blocks}</View>;
  }

  return (
    <TextLines
      content={content}
      color={color}
      size={size}
      noHeading={noHeading}
      noSize={noSize}
      onReferencePress={onReferencePress}
    />
  );
}

// ─── Line-level + reference pass ─────────────────────────────────────────────

interface TextLinesProps {
  content: string;
  color: string;
  size: number;
  noHeading: boolean;
  noSize: boolean;
  onReferencePress?(type: string, id: string): void;
}

function TextLines({
  content,
  color,
  size,
  noHeading,
  noSize,
  onReferencePress,
}: TextLinesProps) {
  // Selectable propagates to descendant <Text> in RN, so setting it on the
  // outer per-line Text makes the whole bubble's prose long-press-selectable.
  const selectable = useSelectable();
  const hasMultilineWrappers =
    content.includes('\n') && /\[(?:size|color|bg|link|width):/.test(content);
  if (hasMultilineWrappers) {
    // Wrappers can span lines (e.g. [color:#abc]\nfoo\n[/color]). Render the
    // whole block in one pass so the balanced parser sees the full string.
    return (
      <Text selectable={selectable} style={{ color, fontSize: size, lineHeight: size * 1.4 }}>
        {renderWithWrappers(content, color, size, noSize)}
      </Text>
    );
  }

  const lines = content.split(/\r?\n/);
  return (
    <View>
      {lines.map((raw, li) => {
        // Horizontal rule: a line consisting ONLY of 3+ of the same rule char
        // (`-`, `*`, or `_`), with optional spaces between/around — the
        // CommonMark thematic break. Must match the whole line so `--` inside
        // prose or a table separator row never triggers it. Web parity: see
        // Killio-Frontend rich-text.tsx (renders <hr>).
        if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(raw)) {
          return (
            <View
              key={li}
              style={{
                height: 1,
                marginVertical: 12,
                backgroundColor: colors.border,
              }}
            />
          );
        }
        const hm = !noHeading ? raw.match(/^(#{1,6})\s+(.*)$/) : null;
        const level = hm ? hm[1].length : 0;
        const line = hm ? hm[2] : raw;
        const tokens = tokenizeRefs(line);
        const fontSize = level > 0 ? HEADING_FONT_SIZES[level - 1] : size;
        const lineHeight =
          level > 0 ? HEADING_LINE_HEIGHTS[level - 1] : Math.round(size * 1.5);
        const fontFamily = level > 0 ? fonts.bold : fonts.regular;

        return (
          <View
            key={li}
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 2 }}
          >
            {tokens.map((tok, ti) => {
              if (tok.kind === 'ref') {
                return (
                  <View key={ti} style={{ marginHorizontal: 1 }}>
                    <RefPill
                      type={tok.type}
                      name={tok.name}
                      onPress={
                        onReferencePress ? () => onReferencePress(tok.type, tok.id) : undefined
                      }
                    />
                  </View>
                );
              }
              return (
                <Text
                  key={ti}
                  selectable={selectable}
                  style={{ color, fontSize, fontFamily, lineHeight }}
                >
                  {renderWithWrappers(tok.value, color, fontSize, noSize)}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function tokenizeRefs(line: string): RefToken[] {
  const parts = line.split(REF_SPLIT_RE);
  const out: RefToken[] = [];
  for (const part of parts) {
    if (!part) continue;
    const ext = part.match(EXT_RE);
    if (ext) {
      out.push({ kind: 'ref', type: 'ext', id: ext[3], name: ext[4] || ext[1] });
      continue;
    }
    const men = part.match(MENTION_RE);
    if (men) {
      const type = (men[1] === 'folder' ? 'doc' : men[1]) as RefType;
      out.push({ kind: 'ref', type, id: men[2], name: men[3] || men[2] });
      continue;
    }
    const deep = part.match(DEEP_RE);
    if (deep) {
      out.push({ kind: 'ref', type: 'deep', id: deep[1], name: deep[1] });
      continue;
    }
    out.push({ kind: 'text', value: part });
  }
  return out;
}

// ─── Wrapper pass ([bg], [color], [size], [width], [link]) ───────────────────

function findBalancedClose(
  source: string,
  startCursor: number,
  openToken: string,
  closeToken: string,
): number {
  let depth = 1;
  let cursor = startCursor;
  while (cursor < source.length) {
    const nextOpen = source.indexOf(openToken, cursor);
    const nextClose = source.indexOf(closeToken, cursor);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + openToken.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    cursor = nextClose + closeToken.length;
  }
  return -1;
}

/**
 * Recursive wrapper renderer. Mirrors the web renderWithWrappers exactly so a
 * round-tripped piece of text (e.g. `[bg:#22d3ee][color:#fff]foo[/color][/bg]`)
 * lights up the same span tree on mobile that it does on the web. Returns an
 * array of React nodes meant to live inside a parent `<Text>` element.
 */
function renderWithWrappers(
  value: string,
  inheritedColor: string,
  inheritedSize: number,
  noSize: boolean,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < value.length) {
    const bgStart = value.indexOf('[bg:', cursor);
    const colorStart = value.indexOf('[color:', cursor);
    const linkStart = value.indexOf('[link:', cursor);
    const sizeStart = value.indexOf('[size:', cursor);
    const widthStart = value.indexOf('[width:', cursor);
    const candidates = [
      bgStart !== -1 ? { start: bgStart, kind: 'bg' as const } : null,
      colorStart !== -1 ? { start: colorStart, kind: 'color' as const } : null,
      linkStart !== -1 ? { start: linkStart, kind: 'link' as const } : null,
      sizeStart !== -1 ? { start: sizeStart, kind: 'size' as const } : null,
      widthStart !== -1 ? { start: widthStart, kind: 'width' as const } : null,
    ].filter(Boolean) as { start: number; kind: 'bg' | 'color' | 'link' | 'size' | 'width' }[];

    let nextStart = -1;
    let nextKind: 'bg' | 'color' | 'link' | 'size' | 'width' | null = null;
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.start - b.start);
      nextStart = candidates[0].start;
      nextKind = candidates[0].kind;
    }

    if (nextStart === -1) {
      const remaining = value.slice(cursor);
      pushLeafLines(nodes, remaining, inheritedColor, inheritedSize, partIndex);
      partIndex += 1;
      break;
    }

    if (nextStart > cursor) {
      const before = value.slice(cursor, nextStart);
      pushLeafLines(nodes, before, inheritedColor, inheritedSize, partIndex);
      partIndex += 1;
    }

    const openEnd = value.indexOf(']', nextStart);
    if (openEnd === -1) {
      pushLeafLines(nodes, value.slice(nextStart), inheritedColor, inheritedSize, partIndex);
      partIndex += 1;
      break;
    }

    const closeTag = `[/${nextKind}]`;
    const openToken = `[${nextKind}:`;
    const closeIndex = findBalancedClose(value, openEnd + 1, openToken, closeTag);
    if (closeIndex === -1) {
      pushLeafLines(nodes, value.slice(nextStart), inheritedColor, inheritedSize, partIndex);
      partIndex += 1;
      break;
    }

    const meta = value.slice(nextStart + openToken.length, openEnd).trim();
    const inner = value.slice(openEnd + 1, closeIndex);
    const innerKey = `wrap-${nextKind}-${partIndex++}`;

    if (nextKind === 'bg') {
      nodes.push(
        <Text
          key={innerKey}
          style={{ backgroundColor: meta, borderRadius: 3 }}
        >
          {renderWithWrappers(inner, inheritedColor, inheritedSize, noSize)}
        </Text>,
      );
    } else if (nextKind === 'color') {
      nodes.push(
        <Text key={innerKey} style={{ color: meta }}>
          {renderWithWrappers(inner, meta, inheritedSize, noSize)}
        </Text>,
      );
    } else if (nextKind === 'size' || nextKind === 'width') {
      const px = parsePx(meta) ?? inheritedSize;
      if (noSize) {
        nodes.push(
          <Fragment key={innerKey}>
            {renderWithWrappers(inner, inheritedColor, inheritedSize, noSize)}
          </Fragment>,
        );
      } else {
        nodes.push(
          <Text
            key={innerKey}
            style={{ fontSize: px, lineHeight: Math.round(px * 1.4) }}
          >
            {renderWithWrappers(inner, inheritedColor, px, noSize)}
          </Text>,
        );
      }
    } else if (nextKind === 'link') {
      nodes.push(
        <Text
          key={innerKey}
          onPress={() => void Linking.openURL(meta)}
          style={{
            color: colors.cyan,
            textDecorationLine: 'underline',
          }}
        >
          {renderWithWrappers(inner, colors.cyan, inheritedSize, noSize)}
        </Text>,
      );
    }

    cursor = closeIndex + closeTag.length;
  }

  return nodes;
}

function pushLeafLines(
  out: React.ReactNode[],
  value: string,
  inheritedColor: string,
  inheritedSize: number,
  baseKey: number,
) {
  if (!value) return;
  if (value.includes('\n')) {
    const parts = value.split('\n');
    parts.forEach((ln, i) => {
      if (i > 0) {
        out.push(<Text key={`lf-${baseKey}-${i}`}>{'\n'}</Text>);
      }
      const leaves = renderLeafMarkdown(ln, inheritedColor, inheritedSize, `leaf-${baseKey}-${i}`);
      out.push(<Fragment key={`leaf-frag-${baseKey}-${i}`}>{leaves}</Fragment>);
    });
  } else {
    const leaves = renderLeafMarkdown(value, inheritedColor, inheritedSize, `leaf-${baseKey}`);
    out.push(<Fragment key={`leaf-frag-${baseKey}`}>{leaves}</Fragment>);
  }
}

// ─── Leaf markdown (bold/italic/underline/strike/code/math/lu/tag) ───────────

function renderLeafMarkdown(
  text: string,
  inheritedColor: string,
  inheritedSize: number,
  keyPrefix: string,
): React.ReactNode[] {
  // First split: inline code, inline math, lucide tokens, standard markdown
  // links `[label](url)` and bare http(s) URLs — they must NOT participate in
  // further decoration parsing because their content is literal. The labeled
  // link is listed BEFORE the bare-URL autolink so a label containing a URL
  // isn't double-linked.
  const SPLIT_RE =
    /(`[^`]+`|\$[^$\n]+\$|\[lu:[\w-]+(?::[\d.]+)?\]|\[t:\d+:(?:date|time|time-to)\]|\[[^\]]+\]\((?:https?:|mailto:)[^)\s]+\)|(?<![("=])\bhttps?:\/\/[^\s<>)]+)/g;
  const segments = text.split(SPLIT_RE);

  const out: React.ReactNode[] = [];
  const LABELED_LINK_RE = /^\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)$/;
  const BARE_URL_RE = /^https?:\/\/[^\s<>)]+$/;
  const DATE_TOKEN_RE = /^\[t:(\d+):(date|time|time-to)\]$/;
  const pushLink = (label: string, url: string, key: string) => {
    out.push(
      <Text
        key={key}
        onPress={() => void Linking.openURL(url)}
        style={{ color: colors.cyan, textDecorationLine: 'underline' }}
      >
        {label}
      </Text>,
    );
  };

  segments.forEach((seg, segIdx) => {
    if (!seg) return;
    const key = `${keyPrefix}-${segIdx}`;
    const labeled = seg.match(LABELED_LINK_RE);
    if (labeled) {
      pushLink(labeled[1], labeled[2], key);
      return;
    }
    if (BARE_URL_RE.test(seg)) {
      pushLink(seg, seg, key);
      return;
    }
    const dateTok = seg.match(DATE_TOKEN_RE);
    if (dateTok) {
      out.push(
        <DateTokenPill
          key={key}
          unix={Number(dateTok[1])}
          fmt={dateTok[2] as DateTokenFormat}
          raw={seg}
          size={inheritedSize}
        />,
      );
      return;
    }
    if (seg.startsWith('[lu:') && seg.endsWith(']')) {
      const m = seg.match(/^\[lu:([\w-]+)(?::([\d.]+))?\]$/);
      if (m) {
        const Icon = resolveLucide(m[1]);
        if (Icon) {
          const stroke = m[2] ? Number(m[2]) : 2;
          // `1em` ~= the inherited font size; align the icon with the text
          // baseline so it sits inline like the web SVG.
          out.push(
            <Icon
              key={key}
              color={inheritedColor}
              size={inheritedSize}
              strokeWidth={stroke}
              // RN doesn't support vertical-align like CSS does — the small
              // negative margin nudges it visually onto the baseline.
              style={{ marginBottom: -2 }}
            />,
          );
          return;
        }
      }
      out.push(<Text key={key}>{seg}</Text>);
      return;
    }
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      out.push(
        <Text
          key={key}
          style={{
            fontFamily: fonts.mono,
            fontSize: Math.max(11, inheritedSize - 2),
            color: inheritedColor,
            backgroundColor: colors.muted,
          }}
        >
          {' '}
          {seg.slice(1, -1)}
          {' '}
        </Text>,
      );
      return;
    }
    if (seg.startsWith('$') && seg.endsWith('$') && seg.length > 2) {
      // RN has no KaTeX. Render the formula as monospaced text — matches the
      // web fallback (`<span>` styled like code).
      out.push(
        <Text
          key={key}
          style={{
            fontFamily: fonts.mono,
            fontSize: inheritedSize,
            color: colors.cyan,
          }}
        >
          {seg.slice(1, -1)}
        </Text>,
      );
      return;
    }
    out.push(...renderDecorations(seg, inheritedColor, inheritedSize, key));
  });
  return out;
}

function renderDecorations(
  input: string,
  inheritedColor: string,
  inheritedSize: number,
  keyPrefix: string,
): React.ReactNode[] {
  const chunks = input.split(
    /(\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[^*\n]+?\*|(?<![A-Za-z0-9])_[^_\n]+?_(?![A-Za-z0-9]))/g,
  );
  return chunks
    .map((chunk, i) => {
      const key = `${keyPrefix}-d-${i}`;
      if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
        return (
          <Text key={key} style={{ fontFamily: fonts.bold }}>
            {chunk.slice(2, -2)}
          </Text>
        );
      }
      if (chunk.startsWith('__') && chunk.endsWith('__') && chunk.length > 4) {
        return (
          <Text key={key} style={{ textDecorationLine: 'underline' }}>
            {chunk.slice(2, -2)}
          </Text>
        );
      }
      if (chunk.startsWith('~~') && chunk.endsWith('~~') && chunk.length > 4) {
        return (
          <Text key={key} style={{ textDecorationLine: 'line-through' }}>
            {chunk.slice(2, -2)}
          </Text>
        );
      }
      if (chunk.length > 2 && chunk.startsWith('*') && chunk.endsWith('*')) {
        return (
          <Text key={key} style={{ fontStyle: 'italic' }}>
            {chunk.slice(1, -1)}
          </Text>
        );
      }
      if (chunk.length > 2 && chunk.startsWith('_') && chunk.endsWith('_')) {
        return (
          <Text key={key} style={{ fontStyle: 'italic' }}>
            {chunk.slice(1, -1)}
          </Text>
        );
      }
      // Embed tag.native.X / tag.custom.X badges inline so the same shorthand
      // the web uses lights up here as well.
      const tagSegs = chunk.split(/(tag\.(?:native|custom)\.[a-zA-Z0-9.\-]+)/g);
      return (
        <Fragment key={key}>
          {tagSegs.map((tc, tcIdx) => {
            if (!tc) return null;
            if (tc.startsWith('tag.native.') || tc.startsWith('tag.custom.')) {
              return <TagBadge key={`${key}-tag-${tcIdx}`} label={tc.split('.').slice(-1)[0]} />;
            }
            return <Text key={`${key}-frag-${tcIdx}`}>{tc}</Text>;
          })}
        </Fragment>
      );
    })
    .filter(Boolean) as React.ReactNode[];
}

// ─── Markdown tables (GitHub style) ──────────────────────────────────────────

type TableSeg =
  | { type: 'text'; value: string }
  | { type: 'table'; header: string[]; rows: string[][] };

// Separator row: `|---|:---:|--|` — each cell is dashes with optional leading/
// trailing colons. Must contain at least one run of 3+ dashes so prose with a
// stray `-|` never triggers it.
const TABLE_SEP_RE = /^\s*\|?(\s*:?-{3,}:?\s*\|)*\s*:?-{3,}:?\s*\|?\s*$/;

/** Splits one table line into trimmed cells (handles optional outer pipes and `\|` escapes). */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * Hand-rolled GitHub-table detector: a header line containing `|`, immediately
 * followed by a separator row with the SAME cell count, then any number of
 * contiguous `|` body rows. Everything else passes through as text.
 */
function splitMarkdownTables(content: string): TableSeg[] {
  const lines = content.split(/\r?\n/);
  const segs: TableSeg[] = [];
  let textBuf: string[] = [];
  const flushText = () => {
    if (textBuf.length) {
      segs.push({ type: 'text', value: textBuf.join('\n') });
      textBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    if (
      line.includes('|') &&
      next !== undefined &&
      next.includes('-') &&
      TABLE_SEP_RE.test(next)
    ) {
      const header = splitTableRow(line);
      const sepCells = splitTableRow(next);
      if (header.length > 1 && header.length === sepCells.length) {
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
          rows.push(splitTableRow(lines[j]));
          j += 1;
        }
        flushText();
        segs.push({ type: 'table', header, rows });
        i = j;
        continue;
      }
    }
    textBuf.push(line);
    i += 1;
  }
  flushText();
  return segs;
}

/**
 * RN table renderer: horizontal ScrollView wrapper so wide tables pan instead
 * of wrapping, fixed per-column widths derived from content length, bold
 * bordered header row, padded cells with inline-markdown support.
 */
function MarkdownTable({
  header,
  rows,
  size,
}: {
  header: string[];
  rows: string[][];
  size: number;
}) {
  const selectable = useSelectable();
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const widths: number[] = [];
  for (let c = 0; c < cols; c += 1) {
    let max = (header[c] ?? '').length;
    for (const r of rows) max = Math.max(max, (r[c] ?? '').length);
    widths.push(Math.min(240, Math.max(64, max * 7 + 22)));
  }
  const cellFont = Math.max(11, size - 2);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginVertical: 8 }}
    >
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.muted,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <View key={c} style={{ width: widths[c], paddingVertical: 7, paddingHorizontal: 10 }}>
              <Text
                selectable={selectable}
                style={{ fontFamily: fonts.semibold, fontSize: cellFont, color: colors.foreground }}
              >
                {renderLeafMarkdown(header[c] ?? '', colors.foreground, cellFont, `th-${c}`)}
              </Text>
            </View>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View
            key={ri}
            style={{
              flexDirection: 'row',
              borderTopWidth: ri > 0 ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <View
                key={c}
                style={{ width: widths[c], paddingVertical: 6, paddingHorizontal: 10 }}
              >
                <Text
                  selectable={selectable}
                  style={{ fontFamily: fonts.regular, fontSize: cellFont, color: colors.foreground }}
                >
                  {renderLeafMarkdown(r[c] ?? '', colors.foreground, cellFont, `td-${ri}-${c}`)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Auxiliary blocks ────────────────────────────────────────────────────────

function MathBlock({ math }: { math: string }) {
  // Real KaTeX render via the WebView-backed MathRenderer — matches the web
  // <BlockMath> output 1:1 so a formula round-trips identically.
  return (
    <View
      style={{
        marginVertical: 6,
        padding: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.02)',
      }}
    >
      <MathRenderer formula={math} display />
    </View>
  );
}

function FencedCodeBlock({ lang, body }: { lang: string; body: string }) {
  const isPreview = /^(mermaid|grarkdown|grark|erdiagram|erd|er|html(\[preview\])?)$/i.test(lang);
  return (
    <View
      style={{
        marginVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.muted,
        padding: 10,
      }}
    >
      {lang ? (
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            color: colors.mutedForeground,
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          {lang} {isPreview ? '· preview-only' : ''}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 12,
          color: colors.foreground,
        }}
      >
        {body}
      </Text>
    </View>
  );
}

function AssetBlock({ tag }: { tag: string }) {
  const type = attr(tag, 'type');
  const src = attr(tag, 'src');
  if (!src) return null;
  const url = resolveAssetUrl(src);
  const title = attr(tag, 'title') ?? 'archivo';
  if (type === 'img') {
    return (
      <Pressable onPress={() => void Linking.openURL(url)} style={{ marginVertical: 4 }}>
        <Image
          source={{ uri: url }}
          style={{ width: 220, height: 160, borderRadius: 12 }}
          resizeMode="cover"
        />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={{
        marginVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.muted,
      }}
    >
      <View
        style={{
          height: 36,
          width: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          backgroundColor: colors.surface,
        }}
      >
        <FileText size={18} color={colors.indigo} />
      </View>
      <Text
        style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.foreground }}
        numberOfLines={1}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * Inline date/time pill for a `[t:UNIX:fmt]` token. Mirrors the web's
 * accent-tinted pill (`bg-accent/10 text-accent`). Reads the active locale from
 * context so it localizes + (for `time-to`) recomputes on each render. Falls
 * back to the raw token if the date is unparseable so content never disappears.
 */
function DateTokenPill({
  unix,
  fmt,
  raw,
  size,
}: {
  unix: number;
  fmt: DateTokenFormat;
  raw: string;
  size: number;
}) {
  const selectable = useSelectable();
  const locale = useLocaleTag();
  const label = formatDateToken(unix, fmt, locale) || raw;
  return (
    <Text
      selectable={selectable}
      style={{
        fontFamily: fonts.medium,
        fontSize: Math.max(11, size - 1),
        color: colors.cyan,
        backgroundColor: colors.muted,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
      }}
    >
      {label}
    </Text>
  );
}

function TagBadge({ label }: { label: string }) {
  return (
    <Text
      style={{
        fontFamily: fonts.semibold,
        fontSize: 10,
        color: colors.cyan,
        backgroundColor: colors.muted,
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 4,
        marginHorizontal: 2,
      }}
    >
      #{label}
    </Text>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m?.[1];
}

function resolveAssetUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${API_BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`;
}

function parsePx(raw: string): number | null {
  const m = raw.match(/^(\d+(?:\.\d+)?)(px|pt|em|rem)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === 'em' || unit === 'rem') return Math.round(n * 16);
  if (unit === 'pt') return Math.round((n * 4) / 3);
  return n;
}

void typography;

// ─── Editable RichText (editor mode) ─────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange(next: string): void;
  color: string;
  size: number;
  placeholder?: string;
  autoFocus?: boolean;
  documents?: ReferencePickerProps['documents'];
  boards?: ReferencePickerProps['boards'];
  cards?: ReferencePickerProps['cards'];
  users?: ReferencePickerProps['users'];
  folders?: ReferencePickerProps['folders'];
  activeBricks?: ReferencePickerProps['activeBricks'];
  teamId?: string;
}

/**
 * Edit-mode renderer. Wraps a multiline TextInput, watches for the `@`/`$`/`#`
 * trigger chars at the cursor, and pops the ReferencePicker scoped to that
 * trigger. Picking a row replaces the trigger char with the canonical
 * `@[type:id:Name]` token (web parity), so the display side renders an inline
 * RefPill straight after blur.
 *
 * Mobile: We can't anchor the picker next to the caret (no DOM caret API), so
 * the picker is a full-screen modal — the user types `@`, the picker opens
 * with the same query they were typing, they tap a row, the modal closes and
 * the token is inserted at the original cursor position.
 */
function RichTextEditor({
  value,
  onChange,
  color,
  size,
  placeholder,
  autoFocus,
  documents,
  boards,
  cards,
  users,
  folders,
  activeBricks,
  teamId,
}: RichTextEditorProps) {
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: value.length,
    end: value.length,
  });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerScope, setPickerScope] = useState<MentionType[] | undefined>(undefined);
  // Where the trigger char (`@`/`$`/`#`) lives in the buffer. Stored so we can
  // splice the chosen token back into the right slot once the picker resolves.
  const [triggerAt, setTriggerAt] = useState<number | null>(null);

  const handleChangeText = useCallback(
    (next: string) => {
      onChange(next);
      // Detect a trigger char immediately to the left of the cursor. We only
      // act on a fresh insertion (next.length > value.length) — otherwise
      // erasing through an old `@` would keep reopening the picker.
      if (next.length > value.length) {
        const cursor = selection.end;
        const ch = next[cursor - 1];
        if (ch === '@' || ch === '$' || ch === '#') {
          setPickerScope(TRIGGER_SCOPE[ch]);
          setTriggerAt(cursor - 1);
          setPickerVisible(true);
        }
      }
    },
    [onChange, selection.end, value.length],
  );

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setSelection(e.nativeEvent.selection);
    },
    [],
  );

  const handlePick = useCallback(
    (sel: { token: string; mentionType: MentionType; id: string; label: string }) => {
      if (triggerAt === null) return;
      // Replace the trigger char at `triggerAt` with the full token.
      const before = value.slice(0, triggerAt);
      const after = value.slice(triggerAt + 1);
      const next = `${before}${sel.token} ${after}`;
      onChange(next);
      const cursor = before.length + sel.token.length + 1;
      setSelection({ start: cursor, end: cursor });
      setTriggerAt(null);
    },
    [onChange, triggerAt, value],
  );

  const closePicker = useCallback(() => {
    setPickerVisible(false);
    setTriggerAt(null);
  }, []);

  // Allowed list for the picker = the union of all trigger scopes; the picker
  // itself filters by category chips so the user can narrow live.
  const allowed = useMemo(() => pickerScope, [pickerScope]);

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        selection={selection}
        multiline
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoFocus={autoFocus}
        style={{
          fontFamily: fonts.regular,
          color,
          fontSize: size,
          lineHeight: Math.round(size * 1.5),
          padding: 0,
          minHeight: size * 1.5,
        }}
      />
      <ReferencePicker
        visible={pickerVisible}
        onClose={closePicker}
        onPick={handlePick}
        allowed={allowed}
        documents={documents}
        boards={boards}
        cards={cards}
        users={users}
        folders={folders}
        activeBricks={activeBricks}
        teamId={teamId}
      />
    </View>
  );
}
