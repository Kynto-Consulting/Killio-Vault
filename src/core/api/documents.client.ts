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
  folderId?: string | null;
  updatedAt?: string;
  createdAt?: string;
  visibility?: 'private' | 'team' | 'public';
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

export async function createDocument(input: {
  teamId: string;
  title: string;
  folderId?: string | null;
}): Promise<{ id: string; title: string }> {
  const { data } = await api.post<{ id: string; title: string }>('/documents', {
    teamId: input.teamId,
    title: input.title,
    folderId: input.folderId ?? undefined,
  });
  return data;
}

export async function updateDocument(
  documentId: string,
  patch: { title?: string; folderId?: string | null },
): Promise<void> {
  await api.put(`/documents/${documentId}`, patch);
}

export async function deleteDocument(documentId: string): Promise<void> {
  await api.delete(`/documents/${documentId}`);
}

export async function createFolder(input: {
  teamId: string;
  name: string;
  parentFolderId?: string | null;
  icon?: string;
  color?: string;
}): Promise<FolderSummary> {
  const { data } = await api.post<FolderSummary>('/folders', {
    teamId: input.teamId,
    name: input.name,
    parentFolderId: input.parentFolderId ?? undefined,
    icon: input.icon,
    color: input.color,
  });
  return data;
}

export async function updateFolder(
  folderId: string,
  patch: { name?: string; icon?: string; color?: string },
): Promise<void> {
  await api.put(`/folders/${folderId}`, patch);
}

export async function deleteFolder(folderId: string): Promise<void> {
  await api.delete(`/folders/${folderId}`);
}

export async function appendDocumentBlock(
  documentId: string,
  blockKind: string,
  initial?: Record<string, any>,
): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>(`/documents/${documentId}/bricks`, {
    kind: blockKind,
    content: initial ?? {},
  });
  return data;
}

export async function reorderBricks(
  documentId: string,
  brickIds: string[],
): Promise<void> {
  await api.put(`/documents/${documentId}/bricks/reorder`, { brickIds });
}

export async function removeBrick(
  documentId: string,
  brickId: string,
): Promise<void> {
  await api.delete(`/documents/${documentId}/bricks/${brickId}`);
}

/** Targeted cell patch — backend emits the `brick.cell_patched` Pulse delta. */
export async function patchBrickCell(
  documentId: string,
  brickId: string,
  patch:
    | {
        kind: 'bountiful_table_cell';
        rowId: string;
        colId: string;
        cell: Record<string, unknown>;
        rowMeta?: { _lastEditedAt: string; _lastEditedBy: string };
      }
    | {
        kind: 'table_cell';
        rowIndex: number;
        colIndex: number;
        value: string;
      },
): Promise<void> {
  await api.patch(`/documents/${documentId}/bricks/${brickId}/cell`, patch);
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
