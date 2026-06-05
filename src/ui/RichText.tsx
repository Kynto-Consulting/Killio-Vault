import React from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { FileText } from 'lucide-react-native';

import { RefPill, type RefType } from './RefPill';
import { API_BASE_URL } from '../core/api/config';
import { colors, typography } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * RN port of the frontend RichText renderer (Killio-Frontend
 * src/components/ui/rich-text.tsx). Supports the parts that matter in chat:
 *  - references: @[type:id:name], @[ext:provider:kind:id:label], #[..]/$[..]
 *  - inline markdown: **bold**, *italic*, `code`
 *  - headings (#..######) and line breaks
 * Web-only features (math, mermaid, mesh, suggestions) are intentionally dropped.
 */

interface Props {
  content: string;
  color?: string;
  size?: number;
  onReferencePress?: (type: string, id: string) => void;
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; type: RefType; id: string; name: string };

const SPLIT_RE =
  /(@\[ext:[^\]]+\]|@\[(?:doc|board|mesh|card|user|folder|room|thread|transcript|event):[^\]]+\]|[$#]\[[^\]]+\])/g;
const EXT_RE = /@\[ext:([^:\]]+):([^:\]]+):([^:\]]+):([^\]]*)\]/;
const MENTION_RE =
  /@\[(doc|board|mesh|card|user|folder|room|thread|transcript|event):([^:\]]+)(?::([^\]]+))?\]/;
const DEEP_RE = /^[$#]\[([^\]]+)\]$/;

function tokenizeRefs(line: string): Token[] {
  const parts = line.split(SPLIT_RE);
  const out: Token[] = [];
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

/** Renders **bold**, *italic*, `code` inside a text run as nested <Text>. */
function renderMarkdown(value: string, baseColor: string, keyPrefix: string): React.ReactNode[] {
  const chunks = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return chunks
    .filter((c) => c !== '')
    .map((chunk, i) => {
      const key = `${keyPrefix}-${i}`;
      if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
        return (
          <Text key={key} style={{ fontWeight: '700' }}>
            {chunk.slice(2, -2)}
          </Text>
        );
      }
      if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
        return (
          <Text
            key={key}
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              color: baseColor,
              backgroundColor: colors.muted,
            }}
          >
            {chunk.slice(1, -1)}
          </Text>
        );
      }
      if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length > 2) {
        return (
          <Text key={key} style={{ fontStyle: 'italic' }}>
            {chunk.slice(1, -1)}
          </Text>
        );
      }
      return <Text key={key}>{chunk}</Text>;
    });
}

const HEADING_SIZES = [24, 20, 18, 16, 15, 14];

const ASSET_RE = /<asset\b[^>]*\/?>/g;

function resolveAssetUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${API_BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m?.[1];
}

/** Renders an <asset> tag: image preview or a tappable file chip. */
function AssetBlock({ tag }: { tag: string }) {
  const type = attr(tag, 'type');
  const src = attr(tag, 'src');
  if (!src) return null;
  const url = resolveAssetUrl(src);
  const title = attr(tag, 'title') ?? 'archivo';

  if (type === 'img') {
    return (
      <Pressable onPress={() => void Linking.openURL(url)} className="my-1">
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
      className="my-1 flex-row items-center gap-3 rounded-xl border border-border bg-secondary p-3"
    >
      <View className="h-9 w-9 items-center justify-center rounded-lg bg-card">
        <FileText size={18} color={colors.indigo} />
      </View>
      <Text style={{ fontFamily: fonts.medium }} className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

export function RichText({ content, color = colors.foreground, size = 15, onReferencePress }: Props) {
  if (!content) return null;

  // Split assets out first; render them as blocks, the rest as rich text lines.
  const segments = content.split(ASSET_RE);
  const assetTags = content.match(ASSET_RE) ?? [];
  const blocks: React.ReactNode[] = [];
  segments.forEach((seg, i) => {
    if (seg.trim()) blocks.push(<TextBlock key={`t${i}`} content={seg} color={color} size={size} onReferencePress={onReferencePress} />);
    if (assetTags[i]) blocks.push(<AssetBlock key={`a${i}`} tag={assetTags[i]} />);
  });

  return <View>{blocks}</View>;
}

function TextBlock({ content, color = colors.foreground, size = 15, onReferencePress }: Props) {
  const lines = content.replace(/^\n+|\n+$/g, '').split(/\r?\n/);

  return (
    <View>
      {lines.map((rawLine, li) => {
        const hm = rawLine.match(/^(#{1,6})\s+(.*)$/);
        const level = hm ? hm[1].length : 0;
        const line = hm ? hm[2] : rawLine;
        const tokens = tokenizeRefs(line);
        const fontSize = level > 0 ? HEADING_SIZES[level - 1] : size;
        const fontWeight = level > 0 ? '700' : '400';

        return (
          <View
            key={li}
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              rowGap: 2,
            }}
          >
            {tokens.map((tok, ti) =>
              tok.kind === 'ref' ? (
                <View key={ti} style={{ marginHorizontal: 1 }}>
                  <RefPill
                    type={tok.type}
                    name={tok.name}
                    onPress={onReferencePress ? () => onReferencePress(tok.type, tok.id) : undefined}
                  />
                </View>
              ) : (
                <Text key={ti} style={{ color, fontSize, fontWeight, lineHeight: fontSize * 1.4 }}>
                  {renderMarkdown(tok.value, color, `${li}-${ti}`)}
                </Text>
              ),
            )}
          </View>
        );
      })}
    </View>
  );
}

void typography;
