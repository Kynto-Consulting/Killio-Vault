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

// Tools that still EXECUTE in the agent loop but must NEVER render a visible
// tool pill/chip. ai_generate_room_name silently titles the conversation — its
// invoke + tool_status/tool_output stay in the stream so the loop runs it, but
// we skip emitting any 'tool' block so the user never sees a chip.
const HIDDEN_TOOLS = new Set(['ai_generate_room_name']);

const STATUS_RE = /<tool_status\s+([^>]+?)\/?>/gi;
const OUTPUT_RE = /<tool_output\s+([^>]*?)>([\s\S]*?)<\/tool_output>/gi;
const INVOKE_RE = /<(?:async_)?invoke\s+([^>]*?)>([\s\S]*?)<\/(?:async_)?invoke>/gi;
const TOOLCALL_RE = /<tool_call\b([^>]*?)(?:\/>|>([\s\S]*?)<\/tool_call>)/gi;
// Reasoning block — accept both Killio's <pre_think> and the model-native
// <think> (Claude emits <think> with nested sections). Backreference \1 keeps
// the open/close tags matched. Group 2 = the reasoning text.
const PRETHINK_RE = /<(pre_think|think)>([\s\S]*?)<\/\1>/gi;
// Master splitter — any tag we render or strip, in document order.
const MASTER_RE =
  /<(?:pre_)?think>[\s\S]*?<\/(?:pre_)?think>|<(?:async_)?invoke\s+[^>]*?>[\s\S]*?<\/(?:async_)?invoke>|<tool_call\b[^>]*?(?:\/>|>[\s\S]*?<\/tool_call>)|<tool_status\s+[^>]*?\/?>|<tool_output\s+[^>]*?>[\s\S]*?<\/tool_output>|<\/?batch_(?:tool|invoke)>|<plan>[\s\S]*?<\/plan>|<complete_step\b[^>]*?\/?>|<end_agent\b[^>]*?>[\s\S]*?<\/end_agent>|<asset\b[^>]*?(?:\/>|>[\s\S]*?<\/asset>)/gi;

// ─── Streaming guard: incomplete tool-ish markup ────────────────────────────
// While the assistant message is still streaming, a tool block can be cut off
// mid-tag (`<invoke id="tc`), mid-body (`<invoke …><parameters><query>…` with
// no `</invoke>` yet), or arrive in a foreign/unknown wrapper (`<function_calls>`,
// `<output>`, `<invoke>`). Complete blocks are consumed by MASTER_RE and
// rendered as pills; anything tool-ish that is NOT complete must be hidden
// until it closes — never shown as raw text. Plain prose containing `<`
// ("a < b", "x<y") must survive untouched.
const TOOLISH_NAME_RE =
  /^(?:async_invoke|invoke|function|function_call|function_calls|tool|tool_call|tool_status|tool_output|output|result|batch_tool|batch_invoke|parameters)$|^antml[:\w-]*$/i;
const TOOLISH_WORDS = [
  'async_invoke',
  'invoke',
  'function_calls',
  'function_call',
  'function',
  'tool_output',
  'tool_status',
  'tool_call',
  'tool',
  'output',
  'result',
  'batch_invoke',
  'batch_tool',
  'parameters',
  'antml',
];

/**
 * Pure helper (exported for tests): strips an INCOMPLETE/unterminated tool-ish
 * block from the end of a streamed text segment. Two cases:
 *  (a) a tool-ish tag was OPENED (`<invoke …>`, `<output>`, `<function_calls>`)
 *      but its closing tag hasn't streamed in yet → cut from the opener to the
 *      end of the buffer.
 *  (b) the tag itself is still being typed (`<invok`, `</tool_ou`,
 *      `<invoke id="tc` — no `>` yet) → cut the partial token, but ONLY when it
 *      is a prefix of a known tool-ish word so prose like "a < b" is kept.
 */
export function stripIncompleteToolMarkup(text: string): string {
  let t = text;

  // (a) opened-but-unclosed tool-ish block → cut from the first such opener.
  const openRe = /<(\/?)([A-Za-z_][\w:-]*)((?:\s[^>]*)?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(t))) {
    const [, closing, name, , selfClose] = m;
    if (closing || selfClose) continue;
    if (!TOOLISH_NAME_RE.test(name)) continue;
    const closeIdx = t.toLowerCase().indexOf(`</${name.toLowerCase()}`, openRe.lastIndex);
    if (closeIdx === -1) {
      t = t.slice(0, m.index);
      break;
    }
  }

  // (b) partial tag still streaming at the very end (no '>' yet).
  const tail = t.match(/<(\/?)([A-Za-z_][\w:-]*)?([^<>]*)$/);
  if (tail) {
    const word = (tail[2] || '').toLowerCase();
    const isToolish = word
      ? TOOLISH_WORDS.some((w) => w.startsWith(word) || word.startsWith(w))
      : tail[1] === '/'; // a bare trailing '</'
    if (isToolish && tail.index !== undefined) t = t.slice(0, tail.index);
  }

  return t;
}

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
    // Strip any dangling/unclosed <end_agent> control token (the closed form is
    // already consumed by MASTER_RE) so it never renders as raw text.
    let t = txt.replace(/<end_agent\b[^>]*>[\s\S]*$/i, '');
    // Streaming guard: an UNTERMINATED leading/trailing <think>/<thinking> open
    // tag (the '<think' chars arrive before the closing '>' — or the whole
    // reasoning block before its </think>) would briefly render as raw text.
    // The complete <think>…</think> form is already normalized by MASTER_RE; here
    // we drop the partial token so it never flickers as literal '<think'.
    //  - trailing: a '<think'/'<thinking' with no '>' yet → cut from there on.
    t = t.replace(/<think(?:ing)?(?:\s[^>]*)?$/i, '');
    //  - trailing: an opened-but-not-closed <think …>… block at the buffer end.
    t = t.replace(/<think(?:ing)?\b[^>]*>[\s\S]*$/i, '');
    //  - leading: a stray closing </think> / </thinking> with no matching open.
    t = t.replace(/^[\s\S]*?<\/think(?:ing)?>/i, '');
    // Streaming guard: hide any INCOMPLETE tool-ish block (<invoke, <function*,
    // <tool*, <output, <result, <batch_*, <parameters) at the buffer end until
    // it is complete. Complete blocks were already consumed by MASTER_RE.
    t = stripIncompleteToolMarkup(t);
    t = t.trim();
    if (t) blocks.push({ type: 'text', text: t });
  };

  // Dedupe tool chips by logical call (name + input). During live streaming the
  // SAME call arrives twice — once as the model's own <invoke> in its delta text,
  // once as the synthesized <invoke> injected by onToolStart (different ids) —
  // which rendered as two chips. We keep ONE chip per call and upgrade it to the
  // most-resolved state (done/error + output beats a bare running invoke).
  const toolKeyIndex = new Map<string, number>();
  const toolScore = (tl: ToolState): number =>
    (tl.status === 'done' || tl.status === 'error' ? 2 : tl.status === 'approval' ? 1 : 0) +
    (tl.output !== undefined ? 1 : 0);
  const pushTool = (st: ToolState) => {
    if (HIDDEN_TOOLS.has(st.name)) return; // executed but never shown (e.g. ai_generate_room_name)
    const key = `${st.name}::${JSON.stringify(st.input ?? {})}`;
    const existingIdx = toolKeyIndex.get(key);
    if (existingIdx !== undefined) {
      const prev = blocks[existingIdx];
      if (prev.type === 'tool' && toolScore(st) > toolScore(prev.tool)) prev.tool = st;
      return; // duplicate of an already-rendered call → don't add a second chip
    }
    toolKeyIndex.set(key, blocks.length);
    blocks.push({ type: 'tool', tool: st });
  };

  while ((m = MASTER_RE.exec(content))) {
    pushText(content.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];

    if (/^<(?:pre_)?think>/i.test(tag)) {
      PRETHINK_RE.lastIndex = 0;
      const pm = PRETHINK_RE.exec(tag);
      const txt = (pm?.[2] ?? '').trim();
      if (txt) blocks.push({ type: 'think', text: txt });
    } else if (/^<(?:async_)?invoke/i.test(tag)) {
      const a = attrs(tag.match(/<(?:async_)?invoke\s+([^>]*?)>/i)?.[1] ?? '');
      const id = a.id || a.name || '';
      const st = states.get(id);
      if (st) pushTool(st);
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
      if (st) pushTool(st);
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
