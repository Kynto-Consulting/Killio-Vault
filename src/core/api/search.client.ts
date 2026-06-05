import { api } from './http';

export interface SearchHit {
  entityType: string;
  entityId: string;
  score: number;
  snippet: string;
  sourceLabel?: string;
}

/** Semantic workspace search backed by the team RAG index. */
export async function workspaceSearch(input: {
  teamId: string;
  query: string;
  maxChunks?: number;
}): Promise<SearchHit[]> {
  const { data } = await api.post<{ items: SearchHit[] }>('/ai/workspace-search', input);
  return data?.items ?? [];
}
