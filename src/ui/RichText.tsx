import React, { Fragment } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { FileText } from 'lucide-react-native';

import { RefPill, type RefType } from './RefPill';
import { resolveLucide } from './lucide-registry';
import { MathRenderer } from './MathRenderer';
import { API_BASE_URL } from '../core/api/config';
import { colors, typography } from '../theme/theme';
import { fonts } from '../theme/fonts';

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
}

const REF_SPLIT_RE =
  /(@\[ext:[^\]]+\]|@\[(?:doc|board|mesh|card|user|folder|room|thread|transcript|event):[^\]]+\]|[$#]\[[^\]]+\])/g;
const EXT_RE = /@\[ext:([^:\]]+):([^:\]]+):([^:\]]+):([^\]]*)\]/;
const MENTION_RE =
  /@\[(doc|board|mesh|card|user|folder|room|thread|transcript|event):([^:\]]+)(?::([^\]]+))?\]/;
const DEEP_RE = /^[$#]\[([^\]]+)\]$/;

type RefToken =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; type: RefType; id: string; name: string };

const HEADING_FONT_SIZES = [24, 20, 18, 16, 15, 14];
const HEADING_LINE_HEIGHTS = [30, 26, 22, 20, 18, 18];

const FENCED_CODE_RE = /```[\w[\]-]*\n[\s\S]*?```/;
const ASSET_RE = /<asset\b[^>]*\/?>/g;

// ─── Public component ────────────────────────────────────────────────────────

export function RichText({
  content,
  color = colors.foreground,
  size = 15,
  onReferencePress,
  disabledStyles = [],
}: RichTextProps) {
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
  const hasMultilineWrappers =
    content.includes('\n') && /\[(?:size|color|bg|link|width):/.test(content);
  if (hasMultilineWrappers) {
    // Wrappers can span lines (e.g. [color:#abc]\nfoo\n[/color]). Render the
    // whole block in one pass so the balanced parser sees the full string.
    return (
      <Text style={{ color, fontSize: size, lineHeight: size * 1.4 }}>
        {renderWithWrappers(content, color, size, noSize)}
      </Text>
    );
  }

  const lines = content.split(/\r?\n/);
  return (
    <View>
      {lines.map((raw, li) => {
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
  // First split: inline code, inline math, lucide tokens — they must NOT
  // participate in further decoration parsing because their content is literal.
  const SPLIT_RE = /(`[^`]+`|\$[^$\n]+\$|\[lu:[\w-]+(?::[\d.]+)?\])/g;
  const segments = text.split(SPLIT_RE);

  const out: React.ReactNode[] = [];
  segments.forEach((seg, segIdx) => {
    if (!seg) return;
    const key = `${keyPrefix}-${segIdx}`;
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
