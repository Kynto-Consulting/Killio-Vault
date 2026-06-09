import * as Crypto from 'expo-crypto';

import { getDb, rowsOf } from '../db/sqlite';
import { nextRun, validateCron } from './cron-expr';

/**
 * CRUD for LOCAL cron jobs — saved recurring prompts. When a job is due the
 * on-device CronRunner re-sends `prompt` to the assistant (into conversation_id)
 * as if the user typed it. LOCAL-ONLY: jobs only fire while the Vault app runs.
 */

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  conversation_id: string | null;
  label: string | null;
  max_runs: number;
  runs_done: number;
  active: number; // 1 | 0
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
}

/** Hard caps so a runaway schedule can't spam the agent forever. */
export const MAX_RUNS_DEFAULT = 50;
export const MAX_RUNS_CAP = 500;

function clampMaxRuns(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return MAX_RUNS_DEFAULT;
  return Math.min(Math.floor(v), MAX_RUNS_CAP);
}

export interface CreateCronInput {
  schedule: string;
  prompt: string;
  conversationId?: string | null;
  label?: string | null;
  maxRuns?: number;
}

export interface CreateCronResult {
  created: boolean;
  id?: string;
  nextRun?: number | null;
  error?: string;
}

/** Create a cron job. Validates the expression and computes the first run. */
export function createCronJob(input: CreateCronInput): CreateCronResult {
  const schedule = String(input.schedule ?? '').trim();
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) return { created: false, error: 'prompt is required' };

  const cronErr = validateCron(schedule);
  if (cronErr) return { created: false, error: `Invalid schedule: ${cronErr}` };

  const now = Date.now();
  const next = nextRun(schedule, now);
  if (next == null) return { created: false, error: 'schedule never matches a valid time' };

  const id = Crypto.randomUUID();
  const db = getDb();
  db.execute(
    `INSERT INTO cron_jobs
       (id, schedule, prompt, conversation_id, label, max_runs, runs_done, active, next_run_at, last_run_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, NULL, ?)`,
    [
      id,
      schedule,
      prompt,
      input.conversationId ?? null,
      input.label ?? null,
      clampMaxRuns(input.maxRuns),
      next,
      now,
    ],
  );
  return { created: true, id, nextRun: next };
}

/** All jobs, newest first. */
export function listCronJobs(): CronJob[] {
  const db = getDb();
  return rowsOf<CronJob>(
    db.execute(`SELECT * FROM cron_jobs ORDER BY created_at DESC`),
  );
}

/** Active jobs that are due (next_run_at <= now) and still under their cap. */
export function dueCronJobs(now: number = Date.now()): CronJob[] {
  const db = getDb();
  return rowsOf<CronJob>(
    db.execute(
      `SELECT * FROM cron_jobs
        WHERE active = 1 AND runs_done < max_runs
          AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
      [now],
    ),
  );
}

/** Delete a job by id. Returns true if a row was removed. */
export function deleteCronJob(id: string): boolean {
  const db = getDb();
  const before = countCronJobs();
  db.execute(`DELETE FROM cron_jobs WHERE id = ?`, [id]);
  return countCronJobs() < before;
}

function countCronJobs(): number {
  const db = getDb();
  return Number(rowsOf<{ c: number }>(db.execute(`SELECT COUNT(*) AS c FROM cron_jobs`))[0]?.c ?? 0);
}

/**
 * Record one successful fire of a job: bump runs_done, set last_run_at, compute
 * the next run, and deactivate when the cap is reached.
 */
export function markCronJobRan(job: CronJob, firedAt: number = Date.now()): void {
  const db = getDb();
  const runsDone = job.runs_done + 1;
  const reachedCap = runsDone >= job.max_runs;
  // Compute the next run from `firedAt` so a busy app that ticks late doesn't
  // immediately re-fire the same minute.
  const next = reachedCap ? null : nextRun(job.schedule, firedAt);
  db.execute(
    `UPDATE cron_jobs
        SET runs_done = ?, last_run_at = ?, next_run_at = ?, active = ?
      WHERE id = ?`,
    [runsDone, firedAt, next, reachedCap || next == null ? 0 : 1, job.id],
  );
}
