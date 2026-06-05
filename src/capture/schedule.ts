/**
 * Capture scheduling. The user runs capture 24/7 or within time windows
 * (e.g. 09:00–18:00). Pure helpers so the logic is testable; the controller
 * polls `isWithinWindows` to gate the foreground service.
 */
export interface TimeWindow {
  /** Minutes from local midnight, 0..1439. */
  startMin: number;
  endMin: number;
  /**
   * Days of week this window applies to (0=Sun..6=Sat). Omitted/empty = every
   * day. Lets the user program a custom weekly listening calendar.
   */
  days?: number[];
}

export type CaptureMode =
  | { kind: 'always' }
  | { kind: 'windows'; windows: TimeWindow[] }
  | { kind: 'off' };

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function isWithinWindows(mode: CaptureMode, now: Date): boolean {
  if (mode.kind === 'off') return false;
  if (mode.kind === 'always') return true;
  const m = minutesOfDay(now);
  const today = now.getDay();
  return mode.windows.some((w) => {
    if (w.days && w.days.length > 0 && !w.days.includes(today)) return false;
    // Handle windows that wrap past midnight (start > end).
    return w.startMin <= w.endMin
      ? m >= w.startMin && m < w.endMin
      : m >= w.startMin || m < w.endMin;
  });
}

export function minToHhMm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseHhMm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time: ${s}`);
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return h * 60 + min;
}
