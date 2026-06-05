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
