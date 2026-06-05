import { api } from './http';

export interface UserMemory {
  id: string;
  userId: string;
  teamId: string | null;
  kind: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listMemories(opts: {
  teamId?: string | null;
  kind?: string;
  limit?: number;
} = {}): Promise<UserMemory[]> {
  const { data } = await api.get<UserMemory[]>('/vault/memories', {
    params: {
      teamId: opts.teamId ?? undefined,
      kind: opts.kind,
      limit: opts.limit,
    },
  });
  return data ?? [];
}

export async function createMemory(input: {
  text: string;
  kind?: string;
  teamId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<UserMemory> {
  const { data } = await api.post<UserMemory>('/vault/memories', input);
  return data;
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await api.delete(`/vault/memories/${memoryId}`);
}
