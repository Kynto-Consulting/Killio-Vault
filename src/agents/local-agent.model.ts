import * as Crypto from 'expo-crypto';

import { getDb, rowsOf } from '../db/sqlite';

export interface LocalAgent {
  id: string;
  name: string;
  personality: string;
  systemPrompt: string;
  assignedDocIds: string[];
  voice?: string | null;
  wakePhrase?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AgentRow {
  id: string;
  name: string;
  personality: string;
  system_prompt: string;
  assigned_doc_ids: string;
  voice: string | null;
  wake_phrase: string | null;
  created_at: number;
  updated_at: number;
}

function toAgent(r: AgentRow): LocalAgent {
  let docs: string[] = [];
  try {
    docs = JSON.parse(r.assigned_doc_ids);
  } catch {
    docs = [];
  }
  return {
    id: r.id,
    name: r.name,
    personality: r.personality,
    systemPrompt: r.system_prompt,
    assignedDocIds: Array.isArray(docs) ? docs : [],
    voice: r.voice,
    wakePhrase: r.wake_phrase,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listAgents(): LocalAgent[] {
  const db = getDb();
  return rowsOf<AgentRow>(
    db.execute(`SELECT * FROM local_agents ORDER BY updated_at DESC`),
  ).map(toAgent);
}

export function getAgent(id: string): LocalAgent | null {
  const db = getDb();
  const row = rowsOf<AgentRow>(
    db.execute(`SELECT * FROM local_agents WHERE id = ?`, [id]),
  )[0];
  return row ? toAgent(row) : null;
}

export function createAgent(input: {
  name: string;
  personality?: string;
  systemPrompt?: string;
  assignedDocIds?: string[];
  voice?: string;
  wakePhrase?: string;
}): LocalAgent {
  const db = getDb();
  const now = Date.now();
  const id = Crypto.randomUUID();
  db.execute(
    `INSERT INTO local_agents
       (id, name, personality, system_prompt, assigned_doc_ids, voice, wake_phrase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.personality ?? '',
      input.systemPrompt ?? '',
      JSON.stringify(input.assignedDocIds ?? []),
      input.voice ?? null,
      input.wakePhrase ?? null,
      now,
      now,
    ],
  );
  return getAgent(id)!;
}

export function updateAgent(
  id: string,
  patch: Partial<Omit<LocalAgent, 'id' | 'createdAt' | 'updatedAt'>>,
): LocalAgent | null {
  const cur = getAgent(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const db = getDb();
  db.execute(
    `UPDATE local_agents SET name=?, personality=?, system_prompt=?, assigned_doc_ids=?, voice=?, wake_phrase=?, updated_at=? WHERE id=?`,
    [
      next.name,
      next.personality,
      next.systemPrompt,
      JSON.stringify(next.assignedDocIds),
      next.voice ?? null,
      next.wakePhrase ?? null,
      Date.now(),
      id,
    ],
  );
  return getAgent(id);
}

export function deleteAgent(id: string): void {
  const db = getDb();
  db.execute(`DELETE FROM agent_memory WHERE agent_id = ?`, [id]);
  db.execute(`DELETE FROM local_agents WHERE id = ?`, [id]);
}
