import { api } from './http';

/**
 * Mobile-shape wrapper around the rooms HTTP API. Mirrors the bits the web
 * `useLinkedRoom` + `useRoomChat` hooks read so the Vault document sidebar
 * can render the same chat thread the web app shows under "Comments".
 */
export interface Room {
  id: string;
  teamId: string;
  name: string;
  type: 'channel' | 'dm' | 'thread';
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
  emoji?: string | null;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  /**
   * Author user id. NULL for AI/bot messages (kind 'ai'): the backend stores
   * `userId: null` for the AI Copilot author to avoid FK violations, so any
   * render logic must treat a missing userId as "not me / bot side".
   */
  userId: string | null;
  /** Message kind. 'ai' = AI Copilot reply, otherwise a normal user message. */
  type?: 'text' | 'ai' | string;
  /** Backend author block. For kind 'ai' this is { displayName: 'AI Copilot' }. */
  user?: { displayName?: string; email?: string; avatarUrl?: string | null };
  content: string;
  createdAt: string;
  editedAt?: string | null;
  reactions?: Array<{ emoji: string; userIds: string[] }>;
  metadata?: Record<string, unknown> & {
    /** Optional reference to the message this is replying to. */
    replyTo?: { id: string; authorName?: string; preview?: string };
    /** Inline attachments (uploaded to /uploads with usage=chat_attachment). */
    attachments?: Array<{
      url: string;
      name: string;
      kind: 'image' | 'video' | 'audio' | 'document';
      size?: number;
      mimeType?: string;
      durationMs?: number;
    }>;
    /** Pinned-message marker (set via PATCH metadata). */
    pinned?: boolean;
    /** Soft-delete marker (renderer hides body, shows tombstone). */
    deleted?: boolean;
  };
  authorName?: string;
  authorAvatarUrl?: string | null;
  /** ISO timestamp at which the current user (or anyone) marked the message read. */
  status?: 'sent' | 'read';
}

export interface RoomMember {
  userId: string;
  role: 'admin' | 'member' | 'readonly';
  displayName?: string;
  email?: string;
  avatarUrl?: string | null;
  joinedAt?: string;
}

export async function findRoomByEntity(
  teamId: string,
  entityType: string,
  entityId: string,
): Promise<Room | null> {
  const { data } = await api.get<Room | null>(`/teams/${teamId}/rooms/find`, {
    params: { entityType, entityId },
  });
  return data ?? null;
}

export async function createRoom(
  teamId: string,
  body: {
    name: string;
    type?: 'channel' | 'dm' | 'thread';
    linkedEntityType?: string;
    linkedEntityId?: string;
    emoji?: string;
    groupId?: string;
  },
): Promise<Room> {
  const { data } = await api.post<Room>(`/teams/${teamId}/rooms`, body);
  return data;
}

export async function listRoomMessages(roomId: string, limit = 50): Promise<RoomMessage[]> {
  const { data } = await api.get<RoomMessage[]>(`/rooms/${roomId}/messages`, {
    params: { limit },
  });
  return data ?? [];
}

export async function sendRoomMessage(
  roomId: string,
  content: string,
  metadata?: RoomMessage['metadata'],
): Promise<RoomMessage> {
  const { data } = await api.post<RoomMessage>(`/rooms/${roomId}/messages`, {
    content,
    ...(metadata ? { metadata } : {}),
  });
  return data;
}

/**
 * Patches a message's metadata. The backend merges, so callers can flip a
 * single flag (pinned, deleted, etc.) without round-tripping the whole blob.
 */
export async function updateRoomMessageMetadata(
  roomId: string,
  messageId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await api.patch(`/rooms/${roomId}/messages/${messageId}/metadata`, { metadata });
}

export async function markRoomMessagesRead(
  roomId: string,
  messageIds: string[],
): Promise<void> {
  if (!messageIds.length) return;
  await api.post(`/rooms/${roomId}/messages/read`, { messageIds });
}

export async function markAllRoomMessagesRead(roomId: string): Promise<void> {
  await api.post(`/rooms/${roomId}/messages/read/all`, {});
}

export async function listRoomMembers(roomId: string): Promise<RoomMember[]> {
  const { data } = await api.get<RoomMember[]>(`/rooms/${roomId}/members`);
  return data ?? [];
}

export async function reactRoomMessage(
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await api.post(`/rooms/${roomId}/messages/${messageId}/reactions`, { emoji });
}

export async function listTeamRooms(teamId: string): Promise<Room[]> {
  const { data } = await api.get<Room[]>(`/teams/${teamId}/rooms`);
  return data ?? [];
}

export async function findOrCreateDm(
  teamId: string,
  targetUserId: string,
): Promise<Room> {
  const { data } = await api.get<Room>(`/teams/${teamId}/rooms/dm`, {
    params: { userId: targetUserId },
  });
  return data;
}

export type RoomNotificationPref = 'all' | 'mentions' | 'none';

export async function getRoomNotificationPref(
  roomId: string,
): Promise<{ pref: RoomNotificationPref }> {
  const { data } = await api.get<{ pref: RoomNotificationPref }>(
    `/rooms/${roomId}/notification-pref`,
  );
  return data ?? { pref: 'all' };
}

export async function setRoomNotificationPref(
  roomId: string,
  pref: RoomNotificationPref,
): Promise<void> {
  await api.put(`/rooms/${roomId}/notification-pref`, { pref });
}

// ─── Calls ──────────────────────────────────────────────────────────────────

export interface RoomCall {
  id: string;
  roomId: string;
  startedAt: string;
  endedAt?: string | null;
  status: 'active' | 'ended' | 'transcribing' | 'failed';
  audioS3Key?: string | null;
  transcript?: string | null;
  summary?: string | null;
}

export async function getActiveCall(roomId: string): Promise<RoomCall | null> {
  const { data } = await api.get<RoomCall | null>(`/rooms/${roomId}/active-call`);
  return data ?? null;
}

export async function listRoomCalls(roomId: string): Promise<RoomCall[]> {
  const { data } = await api.get<RoomCall[]>(`/rooms/${roomId}/calls`);
  return data ?? [];
}

export async function startRoomCall(roomId: string): Promise<RoomCall> {
  const { data } = await api.post<RoomCall>(`/rooms/${roomId}/calls`);
  return data;
}

export async function endRoomCall(roomId: string, callId: string): Promise<void> {
  await api.patch(`/rooms/${roomId}/calls/${callId}`);
}
