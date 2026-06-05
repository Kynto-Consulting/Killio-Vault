import * as Crypto from 'expo-crypto';

import { getDb, rowsOf } from '../../db/sqlite';
import { embedOne } from '../../core/api/ai.client';
import { topK } from './vector';

/**
 * Local agent memory tools. These run ENTIRELY on the device — the agent's
 * memories never leave the phone (plan D). Only the embedding call hits the
 * backend (to share the server's vector space); the text + vectors are stored
 * locally in agent_memory.
 *
 * Exposed to the local agent runtime as: save_memory, search_memory,
 * list_memory, read_memory.
 */

export interface MemoryRecord {
  id: string;
  agentId: string;
  kind: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

interface MemRow {
  id: string;
  agent_id: string;
  kind: string;
  text: string;
  embedding: string;
  metadata: string;
  created_at: number;
}

function toRecord(r: MemRow): MemoryRecord {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(r.metadata);
  } catch {
    metadata = {};
  }
  return {
    id: r.id,
    agentId: r.agent_id,
    kind: r.kind,
    text: r.text,
    metadata,
    createdAt: r.created_at,
  };
}

/** save_memory — embeds + stores a memory for an agent. */
export async function saveMemory(
  agentId: string,
  text: string,
  opts: { kind?: string; metadata?: Record<string, unknown> } = {},
): Promise<MemoryRecord> {
  const clean = text.trim();
  const db = getDb();
  const id = Crypto.randomUUID();
  let embedding: number[] = [];
  try {
    embedding = await embedOne(clean, 'search_document');
  } catch {
    embedding = []; // offline: store text now, can re-embed later
  }
  db.execute(
    `INSERT INTO agent_memory (id, agent_id, kind, text, embedding, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      agentId,
      opts.kind ?? 'note',
      clean,
      JSON.stringify(embedding),
      JSON.stringify(opts.metadata ?? {}),
      Date.now(),
    ],
  );
  return {
    id,
    agentId,
    kind: opts.kind ?? 'note',
    text: clean,
    metadata: opts.metadata ?? {},
    createdAt: Date.now(),
  };
}

/** list_memory — most recent memories for an agent. */
export function listMemory(agentId: string, limit = 50): MemoryRecord[] {
  const db = getDb();
  return rowsOf<MemRow>(
    db.execute(
      `SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
      [agentId, limit],
    ),
  ).map(toRecord);
}

/** read_memory — a single memory by id. */
export function readMemory(id: string): MemoryRecord | null {
  const db = getDb();
  const row = rowsOf<MemRow>(
    db.execute(`SELECT * FROM agent_memory WHERE id = ?`, [id]),
  )[0];
  return row ? toRecord(row) : null;
}

/** search_memory — semantic top-k over the agent's memories (JS cosine). */
export async function searchMemory(
  agentId: string,
  query: string,
  k = 5,
): Promise<Array<MemoryRecord & { score: number }>> {
  const db = getDb();
  const rows = rowsOf<MemRow>(
    db.execute(`SELECT * FROM agent_memory WHERE agent_id = ?`, [agentId]),
  );
  if (rows.length === 0) return [];

  let queryVec: number[] = [];
  try {
    queryVec = await embedOne(query, 'search_query');
  } catch {
    queryVec = [];
  }

  // Fallback to recency + substring match when embeddings are unavailable.
  if (queryVec.length === 0) {
    const q = query.toLowerCase();
    return rows
      .map(toRecord)
      .filter((r) => r.text.toLowerCase().includes(q))
      .slice(0, k)
      .map((r) => ({ ...r, score: 0 }));
  }

  const vectors = rows.map((r) => {
    try {
      return JSON.parse(r.embedding) as number[];
    } catch {
      return [] as number[];
    }
  });
  return topK(queryVec, vectors, k)
    .filter((x) => x.score > 0)
    .map((x) => ({ ...toRecord(rows[x.index]), score: x.score }));
}
