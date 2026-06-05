import { api } from './http';

export interface DocBrick {
  id: string;
  kind: string;
  content: Record<string, any>;
}

export interface DocFull {
  id: string;
  title: string;
  bricks: DocBrick[];
}

export interface DocSummary {
  id: string;
  title: string;
  folderId?: string | null;
  updatedAt?: string;
}

export interface FolderSummary {
  id: string;
  name: string;
  parentFolderId: string | null;
  icon?: string | null;
  color?: string | null;
}

export async function listFolders(
  teamId: string,
  parentFolderId?: string,
): Promise<FolderSummary[]> {
  const { data } = await api.get<FolderSummary[]>('/folders', {
    params: { teamId, parentFolderId },
  });
  return data ?? [];
}

/** Lists documents in a team (optionally within a folder) for agent assignment. */
export async function listDocuments(
  teamId: string,
  folderId?: string,
): Promise<DocSummary[]> {
  const { data } = await api.get<DocSummary[] | { items: DocSummary[] }>(
    '/documents',
    { params: { teamId, folderId } },
  );
  return Array.isArray(data) ? data : (data.items ?? []);
}

export async function getDocument(documentId: string): Promise<DocFull> {
  const { data } = await api.get<DocFull>(`/documents/${documentId}`);
  return data;
}

export async function updateBrickContent(
  documentId: string,
  brickId: string,
  content: Record<string, any>,
): Promise<void> {
  await api.put(`/documents/${documentId}/bricks/${brickId}`, { content });
}

/** Flattens a document's text-bearing bricks into a single plain-text blob. */
export function documentToText(doc: DocFull, maxChars = 4000): string {
  const parts: string[] = [];
  for (const b of doc.bricks ?? []) {
    const t = b.content?.text ?? b.content?.value ?? '';
    if (typeof t === 'string' && t.trim()) parts.push(t.trim());
  }
  const text = `# ${doc.title}\n${parts.join('\n')}`;
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}
