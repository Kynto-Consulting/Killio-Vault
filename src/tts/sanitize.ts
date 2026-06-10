/**
 * Cleans agent/user message text before it is sent to TTS (native or Cartesia)
 * so the voice never reads XML tool markup, reference tokens, markdown symbols,
 * URLs, etc. Bilingual replacements (es/en) for the few things that should be
 * SPOKEN as a word instead of dropped (links, images, code).
 */
type Lang = 'es' | 'en';

// Natural spoken phrases (not raw words) — the voice narrates the attachment
// instead of trying to read the URL/markup.
const REPLACE: Record<Lang, { link: string; image: string; code: string }> = {
  es: {
    link: ' (un enlace) ',
    image: ' (adjuntó una imagen) ',
    code: ' (un bloque de código) ',
  },
  en: {
    link: ' (a link) ',
    image: ' (attached an image) ',
    code: ' (a code block) ',
  },
};

export function speechLang(voice?: string): Lang {
  return (voice ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function sanitizeForSpeech(text: string, lang: Lang = 'es'): string {
  const r = REPLACE[lang];
  let s = text ?? '';

  // 1. Strip tool/agent markup blocks (with their inner content).
  s = s
    .replace(/<tool_output\b[^>]*>[\s\S]*?<\/tool_output>/gi, '')
    .replace(/<invoke\b[\s\S]*?<\/invoke>/gi, '')
    .replace(/<batch_invoke>[\s\S]*?<\/batch_invoke>/gi, '')
    .replace(/<tool_status\b[^>]*\/?>/gi, '')
    .replace(/<tool_call\b[^>]*\/?>/gi, '')
    .replace(/<pre_think>[\s\S]*?<\/pre_think>/gi, '');

  // 2. Assets → spoken word for the type.
  s = s
    .replace(/<asset\b[^>]*type="img"[^>]*\/?>/gi, ` ${r.image} `)
    .replace(/<asset\b[^>]*\/?>/gi, ` ${r.link} `);

  // 3. Any remaining XML/HTML-ish tags.
  s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');

  // 4. References → keep the human name only.
  s = s
    .replace(/@\[ext:[^:\]]+:[^:\]]+:[^:\]]+:([^\]]*)\]/g, '$1') // @[ext:..:..:..:label]
    .replace(/@\[[^:\]]+:[^:\]]+:([^\]]+)\]/g, '$1') // @[type:id:name]
    .replace(/@\[[^:\]]+:[^\]]+\]/g, '') // @[type:id]
    .replace(/[$#]\[[^\]]+\]/g, ''); // #[..] / $[..]

  // 4b. Raw ids the model sometimes leaks into prose — the voice must NOT read
  // them out. Strip UUIDs, tool-call ids (tc-…/tool_use ids/toolu_…), and long
  // bare hex/base-id blobs. Done AFTER reference/markup handling so we only hit
  // ids that survived into plain text.
  s = s
    // canonical UUID v1-5 (8-4-4-4-12 hex)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    // prefixed tool/call ids: tc-…, tool_…, toolu_…, msg_…, call_… (alnum/_/-)
    .replace(/\b(?:tc|toolu|tool_use|tool|msg|call|run|asst)[-_][A-Za-z0-9_-]{6,}\b/gi, ' ')
    // long bare hex blobs (>=24 hex chars, e.g. mongo-ish / sha ids)
    .replace(/\b[0-9a-f]{24,}\b/gi, ' ');

  // 5. Markdown links / images → spoken words / link text.
  s = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ` ${r.image} `) // ![alt](url)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // [text](url)

  // 6. Code fences + inline code → spoken word (don't read raw code).
  s = s
    .replace(/```[\s\S]*?```/g, ` ${r.code} `)
    .replace(/`([^`]+)`/g, '$1');

  // 7. Bare URLs → spoken word.
  s = s.replace(/https?:\/\/\S+/gi, ` ${r.link} `);

  // 8. Markdown decoration markers + heading hashes.
  s = s
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/^\s*[-*]\s+/gm, '');

  // 9. Collapse whitespace.
  return s.replace(/\s+/g, ' ').trim();
}
