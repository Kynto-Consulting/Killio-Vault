/**
 * Tiny KAML-compatible codec for Killio files in the Vault.
 *
 * Mirrors the Killio-Frontend src/lib/killio-file/kaml.ts subset we actually
 * use on mobile: a header line + a JSON-ish payload encoded as a single
 * embedded JSON document so we can ship without the full KAML grammar parser.
 * Files written here are readable by the web app (and vice-versa) because
 * the encoded payload remains valid KAML — the header pinpoints the kind and
 * the payload survives a round-trip.
 */
export interface KillioFile {
  kind: 'kd' | 'kb' | 'km' | 'ks' | 'kf';
  schemaVersion: string;
  payload: unknown;
}

const HEADER_RE = /^#killio\s+(kd|kb|km|ks|kf)\s+(\S+)\s*\n([\s\S]*)$/;

export function encodeKillioFile(file: KillioFile): string {
  return `#killio ${file.kind} ${file.schemaVersion}\n${JSON.stringify(file.payload, null, 2)}\n`;
}

export function decodeKillioFile(raw: string): KillioFile {
  const m = HEADER_RE.exec(raw.trim() + '\n');
  if (!m) {
    throw new Error('not a Killio file (missing #killio header)');
  }
  const [, kind, schemaVersion, body] = m;
  return {
    kind: kind as KillioFile['kind'],
    schemaVersion,
    payload: parsePayload(body),
  };
}

function parsePayload(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}
