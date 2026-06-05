import { api } from './http';

export interface NotificationRow {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  linkUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
  i18n?: {
    titleKey?: string;
    messageKey?: string;
    messageParams?: Record<string, string>;
  };
}

export async function listNotifications(): Promise<NotificationRow[]> {
  const { data } = await api.get<NotificationRow[]>('/notifications');
  return data ?? [];
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get<{ count: number }>('/notifications/unread-count');
  return data?.count ?? 0;
}

export async function markAsRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllAsRead(): Promise<void> {
  await api.post('/notifications/read-all');
}
