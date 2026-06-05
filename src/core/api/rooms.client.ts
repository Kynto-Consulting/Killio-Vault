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
  userId: string;
  content: string;
  createdAt: string;
  reactions?: Array<{ emoji: string; userIds: string[] }>;
  metadata?: Record<string, unknown>;
  authorName?: string;
  authorAvatarUrl?: string | null;
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
): Promise<RoomMessage> {
  const { data } = await api.post<RoomMessage>(`/rooms/${roomId}/messages`, {
    content,
  });
  return data;
}

export async function reactRoomMessage(
  roomId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await api.post(`/rooms/${roomId}/messages/${messageId}/reactions`, { emoji });
}
