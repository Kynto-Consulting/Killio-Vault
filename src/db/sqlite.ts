import type { DB } from '@op-engineering/op-sqlite';

/**
 * Single shared SQLite handle (op-sqlite). Holds the offline diary outbox and,
 * in later phases, local-agent config + the vector memory store (sqlite-vec).
 *
 * op-sqlite is a NATIVE module — absent in Expo Go. We lazy-require it so a plain
 * `import` doesn't crash the whole app at boot; getDb() throws only when actually
 * used (callers guard). Full DB features require the dev-build APK.
 */
let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { open } = require('@op-engineering/op-sqlite');
  const handle = open({ name: 'killio_vault.db' }) as DB;
  migrate(handle);
  db = handle;
  return handle;
}

/** True when the native SQLite module is available (dev-build, not Expo Go). */
export function isDbAvailable(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

function migrate(d: DB): void {
  d.execute(`
    CREATE TABLE IF NOT EXISTS diary_outbox (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL,       -- YYYY-MM-DD (local)
      text        TEXT NOT NULL,
      ts          INTEGER NOT NULL,    -- UTC epoch ms
      source      TEXT NOT NULL DEFAULT 'on_device_stt',
      status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent
      created_at  INTEGER NOT NULL
    );
  `);
  d.execute(
    `CREATE INDEX IF NOT EXISTS diary_outbox_status_idx ON diary_outbox (status, ts);`,
  );

  // Local agents — config NEVER leaves the device (plan D).
  d.execute(`
    CREATE TABLE IF NOT EXISTS local_agents (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      personality     TEXT NOT NULL DEFAULT '',
      system_prompt   TEXT NOT NULL DEFAULT '',
      assigned_doc_ids TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
      voice           TEXT,
      wake_phrase     TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
  `);

  // Per-agent vector memory. Embeddings stored as JSON; similarity computed in
  // JS (cosine) — bounded per agent so this stays cheap. (sqlite-vec can replace
  // the JS scan later behind the same MemoryStore interface.)
  d.execute(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'note',
      text        TEXT NOT NULL,
      embedding   TEXT NOT NULL DEFAULT '[]',
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL
    );
  `);
  d.execute(
    `CREATE INDEX IF NOT EXISTS agent_memory_agent_idx ON agent_memory (agent_id, created_at);`,
  );

  // Local cron jobs — saved recurring prompts. When due, the prompt is re-sent
  // to the assistant as if the user typed it (into conversation_id) by the
  // on-device CronRunner. LOCAL-ONLY: only fires while the Vault app is alive.
  d.execute(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id               TEXT PRIMARY KEY,
      schedule         TEXT NOT NULL,        -- 5-field cron expr "min hour dom mon dow"
      prompt           TEXT NOT NULL,
      conversation_id  TEXT,                 -- target conversation (null = let backend pick)
      label            TEXT,
      max_runs         INTEGER NOT NULL DEFAULT 50,
      runs_done        INTEGER NOT NULL DEFAULT 0,
      active           INTEGER NOT NULL DEFAULT 1,  -- 1 active, 0 deactivated
      next_run_at      INTEGER,              -- UTC epoch ms of the next due fire
      last_run_at      INTEGER,
      created_at       INTEGER NOT NULL
    );
  `);
  d.execute(
    `CREATE INDEX IF NOT EXISTS cron_jobs_active_idx ON cron_jobs (active, next_run_at);`,
  );
}

/** Normalizes op-sqlite result rows across versions. */
export function rowsOf<T = any>(res: { rows?: any }): T[] {
  const r = res?.rows;
  if (!r) return [];
  if (Array.isArray(r)) return r as T[];
  if (Array.isArray(r._array)) return r._array as T[];
  return [];
}
