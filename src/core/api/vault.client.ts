import { api } from './http';

export interface DiarySegment {
  text: string;
  /** UTC epoch milliseconds (global time unit). */
  ts: number;
  clientId?: string;
  source?: string;
}

export interface IngestDiaryResult {
  folderId: string;
  documentId: string;
  appended: number;
  skipped: number;
}

export interface DiarySearchHit {
  documentId: string;
  brickId: string;
  text: string;
  ts: number;
  source: string;
}

/** Uploads a batch of transcript segments to the personal-workspace diary. */
export async function ingestDiary(input: {
  teamId: string;
  date: string; // YYYY-MM-DD (local)
  deviceId: string;
  segments: DiarySegment[];
}): Promise<IngestDiaryResult> {
  const { data } = await api.post<IngestDiaryResult>(
    '/vault/diary/ingest',
    input,
  );
  return data;
}

/** Mirrors an agent turn into the rooms "Vault" group (cross-device history). */
export async function logConversation(input: {
  teamId: string;
  conversationId: string;
  title?: string;
  userText?: string;
  assistantText?: string;
}): Promise<void> {
  await api.post('/vault/conversation/log', input).catch(() => undefined);
}

export interface VaultEntitlements {
  tier: string;
  policy: {
    enabled: boolean;
    onDeviceDiary: boolean;
    cloudSttMinutesMonthly: number;
    screenCapture: boolean;
    localAgents: number | null;
    wakeWord: boolean;
  };
}

export async function getEntitlements(teamId: string): Promise<VaultEntitlements> {
  const { data } = await api.get<VaultEntitlements>('/vault/entitlements', {
    params: { teamId },
  });
  return data;
}

export async function searchDiary(input: {
  teamId: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  hourFrom?: number;
  hourTo?: number;
  query?: string;
}): Promise<DiarySearchHit[]> {
  const { data } = await api.post<DiarySearchHit[]>('/vault/diary/search', input);
  return data;
}
