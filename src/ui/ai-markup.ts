/**
 * RN port of the frontend agent-markup parser (Killio-Frontend src/lib/ai-markup.ts
 * + parseInlineToolEvents). Turns a streamed assistant message containing
 * <invoke>/<tool_call>/<tool_status>/<tool_output>/<pre_think> tags into ordered
 * blocks the chat renders: plain text (→ RichText), tool-call chips, thinking.
 */
export type ToolStatus = 'running' | 'done' | 'error' | 'approval';

export interface ToolState {
  id?: string;
  name: string;
  input?: Record<string, unknown>;
  status: ToolStatus;
  output?: unknown;
  durationMs?: number;
  /** Optional cross-workspace override declared by the AI via `workspace="…"`. */
  workspace?: string;
}

export type MarkupBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: ToolState }
  | { type: 'think'; text: string }
  | { type: 'brick'; kind: string; content: Record<string, any> };

const STATUS_RE = /<tool_status\s+([^>]+?)\/?>/gi;
const OUTPUT_RE = /<tool_output\s+([^>]*?)>([\s\S]*?)<\/tool_output>/gi;
const INVOKE_RE = /<(?:async_)?invoke\s+([^>]*?)>([\s\S]*?)<\/(?:async_)?invoke>/gi;
const TOOLCALL_RE = /<tool_call\b([^>]*?)(?:\/>|>([\s\S]*?)<\/tool_call>)/gi;
const PRETHINK_RE = /<pre_think>([\s\S]*?)<\/pre_think>/gi;
// Master splitter — any tag we render or strip, in document order.
const MASTER_RE =
  /<pre_think>[\s\S]*?<\/pre_think>|<(?:async_)?invoke\s+[^>]*?>[\s\S]*?<\/(?:async_)?invoke>|<tool_call\b[^>]*?(?:\/>|>[\s\S]*?<\/tool_call>)|<tool_status\s+[^>]*?\/?>|<tool_output\s+[^>]*?>[\s\S]*?<\/tool_output>|<\/?batch_(?:tool|invoke)>|<plan>[\s\S]*?<\/plan>|<complete_step\b[^>]*?\/?>|<asset\b[^>]*?(?:\/>|>[\s\S]*?<\/asset>)/gi;

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

function parseInvokeInput(body: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const re = /<([\w-]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] === 'parameters') {
      Object.assign(input, parseInvokeInput(m[2]));
    } else {
      input[m[1]] = m[2].trim();
    }
  }
  return input;
}

/** Builds id → ToolState from invoke/tool_call + status + output tags. */
function collectToolStates(content: string): Map<string, ToolState> {
  const byId = new Map<string, ToolState>();
  let m: RegExpExecArray | null;

  INVOKE_RE.lastIndex = 0;
  while ((m = INVOKE_RE.exec(content))) {
    const a = attrs(m[1]);
    const id = a.id || a.name || `tc-${byId.size}`;
    byId.set(id, {
      id,
      name: a.name || 'tool',
      input: parseInvokeInput(m[2]),
      status: 'running',
      workspace: a.workspace || undefined,
    });
  }

  TOOLCALL_RE.lastIndex = 0;
  while ((m = TOOLCALL_RE.exec(content))) {
    const a = attrs(m[1]);
    let id = a.id;
    let name = a.name;
    let input: Record<string, unknown> | undefined;
    if (m[2]) {
      try {
        const json = JSON.parse(m[2].trim());
        id = id || json.id;
        name = name || json.name;
        input = json.input;
      } catch {
        /* ignore */
      }
    }
    if (a.input) {
      try {
        input = JSON.parse(a.input);
      } catch {
        /* ignore */
      }
    }
    const key = id || name || `tc-${byId.size}`;
    if (!byId.has(key)) byId.set(key, { id: key, name: name || 'tool', input, status: 'running' });
  }

  STATUS_RE.lastIndex = 0;
  while ((m = STATUS_RE.exec(content))) {
    const a = attrs(m[1]);
    const id = a.id;
    if (!id) continue;
    const st = byId.get(id) ?? { id, name: id, status: 'running' as ToolStatus };
    const status = a.status;
    st.status =
      status === 'waiting_for_approval'
        ? 'approval'
        : status === 'error' || a.success === 'false'
          ? 'error'
          : status === 'done'
            ? 'done'
            : 'running';
    if (a.duration_ms) st.durationMs = Number(a.duration_ms);
    byId.set(id, st);
  }

  OUTPUT_RE.lastIndex = 0;
  while ((m = OUTPUT_RE.exec(content))) {
    const a = attrs(m[1]);
    const id = a.id;
    if (!id) continue;
    const st = byId.get(id) ?? { id, name: id, status: 'done' as ToolStatus };
    const body = unescapeHtml(m[2]);
    try {
      st.output = JSON.parse(body);
    } catch {
      st.output = body;
    }
    if (a.success === 'false') st.status = 'error';
    byId.set(id, st);
  }

  return byId;
}

export function parseAgentMarkup(content: string): MarkupBlock[] {
  if (!content) return [];
  const states = collectToolStates(content);
  const blocks: MarkupBlock[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MASTER_RE.lastIndex = 0;

  const pushText = (txt: string) => {
    const t = txt.trim();
    if (t) blocks.push({ type: 'text', text: t });
  };

  while ((m = MASTER_RE.exec(content))) {
    pushText(content.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];

    if (/^<pre_think>/i.test(tag)) {
      PRETHINK_RE.lastIndex = 0;
      const pm = PRETHINK_RE.exec(tag);
      const txt = (pm?.[1] ?? '').trim();
      if (txt) blocks.push({ type: 'think', text: txt });
    } else if (/^<(?:async_)?invoke/i.test(tag)) {
      const a = attrs(tag.match(/<(?:async_)?invoke\s+([^>]*?)>/i)?.[1] ?? '');
      const id = a.id || a.name || '';
      const st = states.get(id);
      if (st) blocks.push({ type: 'tool', tool: st });
    } else if (/^<tool_call/i.test(tag)) {
      const a = attrs(tag);
      let id = a.id || a.name;
      if (!id) {
        const inner = tag.match(/>([\s\S]*?)<\/tool_call>/)?.[1];
        if (inner) {
          try {
            const j = JSON.parse(inner.trim());
            id = j.id || j.name;
          } catch {
            /* ignore */
          }
        }
      }
      const st = id ? states.get(id) : undefined;
      if (st) blocks.push({ type: 'tool', tool: st });
    } else if (/^<asset\b/i.test(tag)) {
      // <asset type="brick" kind="text">{json}</asset>  → inline brick preview.
      // Other asset types (img/document) are handled by RichText inside text blocks.
      const a = attrs(tag.match(/<asset\b([^>]*?)(?:\/|>)/i)?.[1] ?? '');
      if (a.type === 'brick') {
        const body = tag.match(/>([\s\S]*?)<\/asset>/)?.[1] ?? '';
        try {
          const json = JSON.parse(unescapeHtml(body));
          const kind = a.kind || json.kind || 'text';
          const content = json.content ?? json;
          blocks.push({ type: 'brick', kind, content });
        } catch {
          /* malformed brick payload — skip */
        }
      } else {
        // pass img/document assets back to text so RichText renders them.
        blocks.push({ type: 'text', text: tag });
      }
    }
    // tool_status / tool_output / batch wrappers / plan / complete_step → consumed (no block)
  }
  pushText(content.slice(last));
  return blocks;
}
