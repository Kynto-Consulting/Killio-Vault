/**
 * Minimal 5-field cron evaluator — pure JS, Hermes-safe (no deps, no native).
 *
 * Fields: "minute hour day-of-month month day-of-week"
 *   minute       0-59
 *   hour         0-23
 *   day-of-month 1-31
 *   month        1-12
 *   day-of-week  0-6 (0 = Sunday)
 *
 * Supported per field: `*`, lists `a,b`, ranges `a-b`, steps `*​/n` and `a-b/n`.
 * Names (JAN, MON, …) are NOT supported — numbers only.
 *
 * Standard cron semantics: when BOTH day-of-month and day-of-week are restricted
 * (neither is `*`), a tick matches if EITHER one matches (cron OR rule).
 *
 * Times are evaluated in the DEVICE LOCAL timezone (getHours/getMinutes/etc.).
 */

const FIELD_BOUNDS: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

/** Parsed cron: for each of the 5 fields, the allowed-value set + whether it was `*`. */
export interface ParsedCron {
  fields: { values: Set<number>; isStar: boolean }[];
}

function parseField(raw: string, min: number, max: number): { values: Set<number>; isStar: boolean } {
  const values = new Set<number>();
  let isStar = false;
  for (const partRaw of raw.split(',')) {
    const part = partRaw.trim();
    if (!part) throw new Error(`Empty cron field part in "${raw}"`);

    let step = 1;
    let rangeStr = part;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      rangeStr = part.slice(0, slash);
      step = Number(part.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) throw new Error(`Bad cron step in "${part}"`);
    }

    let lo: number;
    let hi: number;
    if (rangeStr === '*') {
      isStar = true;
      lo = min;
      hi = max;
    } else {
      const dash = rangeStr.indexOf('-');
      if (dash !== -1) {
        lo = Number(rangeStr.slice(0, dash));
        hi = Number(rangeStr.slice(dash + 1));
      } else {
        lo = Number(rangeStr);
        hi = lo;
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new Error(`Bad cron value in "${part}"`);
      }
      if (lo < min || hi > max || lo > hi) {
        throw new Error(`Cron value out of range in "${part}" (allowed ${min}-${max})`);
      }
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (values.size === 0) throw new Error(`Cron field "${raw}" matched nothing`);
  return { values, isStar };
}

/** Parse a 5-field cron expression. Throws on any malformed field. */
export function parseCron(expr: string): ParsedCron {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have exactly 5 fields, got ${parts.length}: "${expr}"`);
  }
  const fields = parts.map((p, i) => parseField(p, FIELD_BOUNDS[i][0], FIELD_BOUNDS[i][1]));
  return { fields };
}

/** True when the given Date (local time) satisfies the parsed cron. */
function matches(parsed: ParsedCron, d: Date): boolean {
  const [minF, hourF, domF, monF, dowF] = parsed.fields;
  if (!minF.values.has(d.getMinutes())) return false;
  if (!hourF.values.has(d.getHours())) return false;
  if (!monF.values.has(d.getMonth() + 1)) return false;

  const domMatch = domF.values.has(d.getDate());
  const dowMatch = dowF.values.has(d.getDay());
  // Cron OR-rule: if both DOM and DOW are restricted, either matching is enough.
  if (!domF.isStar && !dowF.isStar) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

/**
 * Next fire time strictly AFTER `from` (UTC epoch ms), evaluated in device local
 * time. Scans minute-by-minute up to ~4 years; returns null if nothing matches
 * (e.g. an impossible date like Feb 30). Enforces the 1-minute minimum interval
 * implicitly because cron resolution is per-minute.
 */
export function nextRun(expr: string, fromMs: number = Date.now()): number | null {
  const parsed = parseCron(expr);
  // Start at the next whole minute strictly after `from`.
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  // 4 years of minutes is the worst-case bound (covers Feb-29 schedules).
  const MAX_MINUTES = 366 * 4 * 24 * 60;
  for (let i = 0; i < MAX_MINUTES; i++) {
    if (matches(parsed, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/** Validate an expression; returns an error string or null if valid. */
export function validateCron(expr: string): string | null {
  try {
    parseCron(expr);
    return null;
  } catch (e) {
    return (e as Error)?.message ?? 'invalid cron expression';
  }
}
