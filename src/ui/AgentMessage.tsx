import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ArrowRight,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Contact,
  Download,
  Edit2,
  FilePen,
  FilePlus,
  FilePlus2,
  FileSearch,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Globe,
  Hash,
  ImageUp,
  LayoutDashboard,
  List,
  Loader,
  MapPin,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Phone,
  PhoneOff,
  Play,
  PlusCircle,
  PlusSquare,
  Search,
  Send,
  Sigma,
  Sparkles,
  SquareArrowOutUpRight,
  Tag,
  Terminal,
  Trash2,
  Upload,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';

import { RichText } from './RichText';
import { BrickRenderer } from './BrickRenderer';
import { parseAgentMarkup, type ToolState } from './ai-markup';
import { resolveTool } from './tool-catalog';
import { useTranslations } from '../i18n';
import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

const ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  'phone-off': PhoneOff,
  'image-up': ImageUp,
  calendar: Calendar,
  'calendar-plus': CalendarPlus,
  contact: Contact,
  'map-pin': MapPin,
  'message-square': MessageSquare,
  'message-square-plus': MessageSquarePlus,
  phone: Phone,
  globe: Globe,
  'square-arrow-out-up-right': SquareArrowOutUpRight,
  sparkles: Sparkles,
  'file-text': FileText,
  'file-plus': FilePlus,
  'plus-square': PlusSquare,
  'edit-2': Edit2,
  send: Send,
  'check-circle-2': CheckCircle2,
  'layout-dashboard': LayoutDashboard,
  'plus-circle': PlusCircle,
  'arrow-right': ArrowRight,
  download: Download,
  'git-branch': GitBranch,
  hash: Hash,
  zap: Zap,
  tag: Tag,
  wrench: Wrench,
  // VFS / OS
  'file-search': FileSearch,
  'file-plus-2': FilePlus2,
  'file-pen': FilePen,
  folder: Folder,
  'folder-plus': FolderPlus,
  upload: Upload,
  'trash-2': Trash2,
  terminal: Terminal,
  play: Play,
  list: List,
  sigma: Sigma,
  paperclip: Paperclip,
};

function iconFor(name: string): LucideIcon {
  return ICON_MAP[name] ?? Wrench;
}

function ToolChip({ tool }: { tool: ToolState }) {
  const t = useTranslations('agentTool');
  const [open, setOpen] = useState(false);
  const meta = resolveTool(tool.name);
  const Icon = iconFor(meta.icon);
  const label = t(meta.i18nKey, normalizeParams(tool.input));
  const color =
    tool.status === 'error'
      ? colors.destructive
      : tool.status === 'approval'
        ? colors.warning
        : tool.status === 'done'
          ? colors.success
          : colors.cyan;
  const hasDetail = !!tool.input || tool.output !== undefined;

  return (
    <View className="my-0.5">
      <Pressable
        onPress={() => hasDetail && setOpen((v) => !v)}
        className="flex-row items-center gap-2 rounded-lg border border-border bg-secondary/60 px-2.5 py-1.5"
      >
        {tool.status === 'running' ? (
          <Loader size={13} color={color} />
        ) : tool.status === 'error' ? (
          <CircleAlert size={13} color={color} />
        ) : (
          <Check size={13} color={color} />
        )}
        <Icon size={13} color={colors.mutedForeground} />
        <Text
          style={{ fontFamily: fonts.medium }}
          className="flex-1 text-xs text-foreground"
          numberOfLines={1}
        >
          {label || tool.name}
        </Text>
        {hasDetail ? (
          open ? (
            <ChevronDown size={13} color={colors.mutedForeground} />
          ) : (
            <ChevronRight size={13} color={colors.mutedForeground} />
          )
        ) : null}
      </Pressable>
      {open && hasDetail ? (
        <View className="ml-3 mt-1 rounded-lg border border-border bg-background p-2">
          {tool.input ? (
            <Text
              style={{ fontFamily: fonts.mono }}
              className="text-[11px] text-muted-foreground"
            >
              {JSON.stringify(tool.input, null, 1).slice(0, 600)}
            </Text>
          ) : null}
          {tool.output !== undefined ? (
            <Text
              style={{ fontFamily: fonts.mono }}
              className="mt-1 text-[11px] text-foreground/80"
            >
              {(typeof tool.output === 'string'
                ? tool.output
                : JSON.stringify(tool.output, null, 1)
              ).slice(0, 800)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function normalizeParams(input: unknown): Record<string, string | number> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    else out[k] = JSON.stringify(v).slice(0, 60);
  }
  // Provide a generic "target" param for one-arg tools that the catalog labels
  // reference (call_number → "Llamar a {target}").
  if (!out.target) {
    out.target =
      (out.number as string) ??
      (out.query as string) ??
      (out.title as string) ??
      (out.url as string) ??
      (out.keyword as string) ??
      '';
  }
  return out;
}

function ThinkBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="my-0.5">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center gap-1.5">
        {open ? (
          <ChevronDown size={13} color={colors.mutedForeground} />
        ) : (
          <ChevronRight size={13} color={colors.mutedForeground} />
        )}
        <Text style={{ fontFamily: fonts.medium }} className="text-xs text-muted-foreground">
          Razonamiento
        </Text>
      </Pressable>
      {open ? (
        <Text className="ml-4 mt-1 text-xs italic text-muted-foreground">{text}</Text>
      ) : null}
    </View>
  );
}

/** Renders a streamed assistant message: text (RichText) + tool chips + thinking + bricks. */
export function AgentMessage({ content }: { content: string }) {
  const blocks = parseAgentMarkup(content);
  if (blocks.length === 0) return null;
  return (
    <View className="gap-1">
      {blocks.map((b, i) => {
        if (b.type === 'text') return <RichText key={i} content={b.text} />;
        if (b.type === 'tool') return <ToolChip key={i} tool={b.tool} />;
        if (b.type === 'brick')
          return (
            <View
              key={i}
              className="my-1 overflow-hidden rounded-xl border"
              style={{ borderColor: colors.indigo + '55', backgroundColor: colors.indigo + '0d' }}
            >
              <View
                className="flex-row items-center gap-2 border-b px-3 py-1.5"
                style={{ borderColor: colors.indigo + '33' }}
              >
                <Sparkles size={12} color={colors.indigo} />
                <Text
                  style={{ fontFamily: fonts.bold, color: colors.indigo }}
                  className="text-[10px] uppercase"
                >
                  Bloque · {b.kind}
                </Text>
              </View>
              <View className="p-2">
                <BrickRenderer brick={{ kind: b.kind, content: b.content }} />
              </View>
            </View>
          );
        return <ThinkBlock key={i} text={b.text} />;
      })}
    </View>
  );
}
