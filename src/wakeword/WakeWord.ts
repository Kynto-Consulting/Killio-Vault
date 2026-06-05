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

/**
 * Returns a WakeMatch if `text` starts with (or contains near the start) a wake
 * phrase. `agentNames` lets custom agents be invoked by name ("Hey Nova …").
 */
export function matchWake(text: string, agentNames: string[] = []): WakeMatch | null {
  const norm = normalize(text);
  if (!norm) return null;

  const candidates: { phrase: string; agentName?: string }[] = [
    ...BUILTIN_WAKE_PHRASES.map((p) => ({ phrase: p })),
    ...agentNames.flatMap((name) => {
      const n = normalize(name);
      return n
        ? [
            { phrase: `hey ${n}`, agentName: name },
            { phrase: `oye ${n}`, agentName: name },
          ]
        : [];
    }),
  ];

  for (const c of candidates) {
    const idx = norm.indexOf(c.phrase);
    // Only trigger when the phrase is at/near the start of the utterance.
    if (idx >= 0 && idx <= 3) {
      const command = norm.slice(idx + c.phrase.length).trim();
      return { phrase: c.phrase, agentName: c.agentName, command };
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
