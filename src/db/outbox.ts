import * as Crypto from 'expo-crypto';

import { getDb, rowsOf } from './sqlite';
import { getDeviceId } from '../core/device';
import { ingestDiary, type DiarySegment } from '../core/api/vault.client';
import { getPersonalTeamId } from '../core/auth/token-store';

export interface OutboxRow {
  id: string;
  date: string;
  text: string;
  ts: number;
  source: string;
  status: 'pending' | 'sent';
  created_at: number;
}

/** Local date (YYYY-MM-DD) for a UTC-epoch timestamp, in the device timezone. */
export function localDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Enqueues a transcript segment for upload. ts must be UTC epoch ms. */
export function enqueueSegment(seg: {
  text: string;
  ts: number;
  source?: string;
}): void {
  const text = seg.text.trim();
  if (!text) return;
  const db = getDb();
  const date = localDate(seg.ts);
  db.execute(
    `INSERT INTO diary_outbox (id, date, text, ts, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      Crypto.randomUUID(),
      date,
      text,
      seg.ts,
      seg.source ?? 'on_device_stt',
      Date.now(),
    ],
  );
  // Verifiable in logcat: every transcribed segment lands here, independent of
  // voice-ID / wake — the diary captures ALL speech (voice-ID only gates AI
  // responses). If this line is missing for a spoken segment, the enqueue path
  // (not the diary view) is the regression.
  console.log(
    `[KillioDiary] enqueued date=${date} source=${seg.source ?? 'on_device_stt'} len=${text.length} text="${text.slice(0, 60)}"`,
  );
  notifyDiaryChanged(date);
}

/**
 * Lightweight in-process pub/sub so the diary screen can re-render the instant a
 * segment is enqueued (real-time), without polling. Survives across capture in
 * the background (the controller enqueues; if the diary is open it refreshes).
 */
type DiaryListener = (date: string) => void;
const diaryListeners = new Set<DiaryListener>();

export function onDiaryChanged(cb: DiaryListener): () => void {
  diaryListeners.add(cb);
  return () => {
    diaryListeners.delete(cb);
  };
}

function notifyDiaryChanged(date: string): void {
  for (const cb of diaryListeners) {
    try {
      cb(date);
    } catch {
      /* a listener throwing must never block the enqueue */
    }
  }
}

export function pendingCount(): number {
  const db = getDb();
  const res = db.execute(
    `SELECT COUNT(*) AS c FROM diary_outbox WHERE status = 'pending'`,
  );
  return Number(rowsOf<{ c: number }>(res)[0]?.c ?? 0);
}

/**
 * Flushes pending segments to the backend, grouped by local date (one ingest
 * call per day). On success the rows are marked sent. Returns total uploaded.
 * Safe to call repeatedly — ingest is idempotent server-side.
 */
export async function flushOutbox(): Promise<number> {
  const teamId = await getPersonalTeamId();
  if (!teamId) return 0;
  const deviceId = await getDeviceId();
  const db = getDb();

  const pending = rowsOf<OutboxRow>(
    db.execute(
      `SELECT * FROM diary_outbox WHERE status = 'pending' ORDER BY ts ASC LIMIT 500`,
    ),
  );
  if (pending.length === 0) return 0;

  const byDate = new Map<string, OutboxRow[]>();
  for (const row of pending) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  let uploaded = 0;
  for (const [date, rows] of byDate) {
    const segments: DiarySegment[] = rows.map((r) => ({
      text: r.text,
      ts: r.ts,
      source: r.source,
      clientId: undefined, // server derives a stable id from (deviceId, ts)
    }));
    try {
      await ingestDiary({ teamId, date, deviceId, segments });
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      db.execute(
        `UPDATE diary_outbox SET status = 'sent' WHERE id IN (${placeholders})`,
        ids,
      );
      uploaded += rows.length;
    } catch {
      // Leave as pending; next flush retries this date.
    }
  }
  return uploaded;
}

/**
 * Returns the local transcript from the last `windowMs` (default 60s) as plain
 * text. Fed as prior context when the wake word fires ("Hey Killio …") so the
 * agent knows what was being said just before — no need to repeat yourself.
 */
export function recentTranscriptText(windowMs = 60_000): string {
  try {
    const db = getDb();
    const since = Date.now() - windowMs;
    const rows = rowsOf<OutboxRow>(
      db.execute(
        `SELECT * FROM diary_outbox WHERE ts >= ? ORDER BY ts ASC LIMIT 200`,
        [since],
      ),
    );
    return rows.map((r) => r.text).join(' ').trim();
  } catch {
    return '';
  }
}

export interface LocalSegment {
  text: string;
  ts: number;
  source: string;
  /** true = not yet uploaded to the server diary. */
  pending: boolean;
}

/**
 * Local transcript segments for a given local date (YYYY-MM-DD) straight from
 * the on-device outbox — including ones not yet uploaded. Lets the diary show
 * what was just captured immediately, before the next flush. Newest first.
 */
/** On-screen debug snapshot (no adb needed): total rows + stored dates. */
export function diaryDebug(): { total: number; dates: string[] } {
  try {
    const db = getDb();
    const t = rowsOf<{ c: number }>(db.execute(`SELECT COUNT(*) AS c FROM diary_outbox`));
    const d = rowsOf<{ date: string }>(db.execute(`SELECT DISTINCT date FROM diary_outbox ORDER BY date DESC LIMIT 6`));
    return { total: Number(t[0]?.c ?? 0), dates: d.map((r) => r.date) };
  } catch (e) {
    return { total: -1, dates: [String(e).slice(0, 40)] };
  }
}

/** Local-day [start,end) epoch-ms range for a YYYY-MM-DD string (device-local). */
function dayRange(date: string): [number, number] {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime();
  return [start, start + 24 * 60 * 60 * 1000];
}

export function getLocalSegments(date: string): LocalSegment[] {
  try {
    const db = getDb();
    // Filter by the ts EPOCH RANGE rather than the `date` TEXT column. The exact
    // `date = ?` string match was returning 0 rows even though rows for today
    // existed (the stored date string and the query string can desync), so we
    // derive the local-day window from the same date and match on ts — robust.
    const [start, end] = dayRange(date);
    const rows = rowsOf<OutboxRow>(
      db.execute(
        `SELECT * FROM diary_outbox WHERE ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 500`,
        [start, end],
      ),
    );
    return rows.map((r) => ({
      text: r.text,
      ts: r.ts,
      source: r.source,
      pending: r.status === 'pending',
    }));
  } catch (err) {
    console.warn(`[KillioDiary] getLocalSegments FAILED date=${date}: ${String(err)}`);
    return [];
  }
}

/** Removes sent rows older than `keepMs` to bound local storage. */
export function pruneSent(keepMs = 7 * 24 * 60 * 60 * 1000): void {
  const db = getDb();
  db.execute(`DELETE FROM diary_outbox WHERE status = 'sent' AND created_at < ?`, [
    Date.now() - keepMs,
  ]);
}
