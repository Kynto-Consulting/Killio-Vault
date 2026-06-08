/**
 * Wake-word detection — JS matcher over the continuous on-device SpeechRecognizer
 * transcripts (free, local, no Porcupine, no credits). The capture service already
 * streams transcripts 24/7; we scan them for the wake phrases:
 *   "Hey Killio", "Oye Killio", and per-agent "Hey|Oye {AgentName}".
 */
export const BUILTIN_WAKE_PHRASES = ['hey killio', 'oye killio', 'okay killio', 'ok killio'];

export interface WakeMatch {
  /** Matched wake phrase (lowercased). */
  phrase: string;
  /** Agent name if a custom-name phrase matched, else undefined (default agent). */
  agentName?: string;
  /** The rest of the utterance after the wake phrase (the command). */
  command: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Wake prefixes that precede the assistant name. */
const WAKE_PREFIXES = ['hey', 'oye', 'ok', 'okay', 'he', 'hola', 'ey'];

/** Levenshtein distance (small strings). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Fuzzy match for "killio" — the small offline Vosk model mishears the made-up
 * name as "kilo", "kilio", "quilio", "killo", "kiyo", "quillo", etc. Accept any
 * token within edit-distance 2 of "killio"/"kilio", or with a close prefix.
 */
function isKillio(token: string, strict = false): boolean {
  if (!token) return false;
  if (strict) {
    // Bare (no wake prefix) — be strict to avoid false wakes on common words
    // like "quiero". Only near-exact mishears.
    return lev(token, 'killio') <= 1 || lev(token, 'kilio') <= 1;
  }
  // After a wake prefix ("oye …") the context makes loose matching safe.
  if (lev(token, 'killio') <= 2 || lev(token, 'kilio') <= 2) return true;
  return /^(kil|kiy|kli)/.test(token) && token.length <= 7;
}

/**
 * Returns a WakeMatch if `text` starts with a wake phrase. Built-in "killio" is
 * matched FUZZILY (offline STT mangles the made-up name into "kilo"/"kilio"/…);
 * custom agent names are matched as before.
 */
export function matchWake(text: string, agentNames: string[] = []): WakeMatch | null {
  const norm = normalize(text);
  if (!norm) return null;
  const tokens = norm.split(' ');

  // 1) Built-in: <prefix> <fuzzy-killio> … → handles "oye kilo", "hey kilio".
  if (tokens.length >= 2 && WAKE_PREFIXES.includes(tokens[0]) && isKillio(tokens[1])) {
    return { phrase: `${tokens[0]} killio`, command: tokens.slice(2).join(' ').trim() };
  }
  // 1b) Bare "killio …" (model dropped the prefix) — strict to avoid false wakes.
  if (isKillio(tokens[0], true)) {
    return { phrase: 'killio', command: tokens.slice(1).join(' ').trim() };
  }

  // 2) Custom agent names — FUZZY ≥80% similarity (offline STT mangles names
  //    too). After a wake prefix, fuzzy-match the next N tokens against each
  //    agent name (N = name's word count); trigger when similarity ≥ 0.8.
  if (tokens.length >= 2 && WAKE_PREFIXES.includes(tokens[0])) {
    for (const name of agentNames) {
      const n = normalize(name);
      if (!n) continue;
      const words = n.split(' ').length;
      const candidate = tokens.slice(1, 1 + words).join(' ');
      if (!candidate) continue;
      const dist = lev(candidate, n);
      const sim = 1 - dist / Math.max(candidate.length, n.length);
      if (sim >= 0.8) {
        return {
          phrase: `${tokens[0]} ${n}`,
          agentName: name,
          command: tokens.slice(1 + words).join(' ').trim(),
        };
      }
    }
  }
  // 2b) Bare agent name at the very start (no prefix) — strict ≥0.85.
  for (const name of agentNames) {
    const n = normalize(name);
    if (!n) continue;
    const words = n.split(' ').length;
    const candidate = tokens.slice(0, words).join(' ');
    if (!candidate) continue;
    const sim = 1 - lev(candidate, n) / Math.max(candidate.length, n.length);
    if (sim >= 0.85) {
      return { phrase: n, agentName: name, command: tokens.slice(words).join(' ').trim() };
    }
  }
  return null;
}

/** Always false — no native Porcupine module; detection is JS over transcripts. */
export function isAvailable(): boolean {
  return false;
}

export function wakePhrasesFor(agentName?: string): string[] {
  const phrases = [...BUILTIN_WAKE_PHRASES];
  const name = agentName?.trim();
  if (name) phrases.push(`hey ${name.toLowerCase()}`, `oye ${name.toLowerCase()}`);
  return phrases;
}
