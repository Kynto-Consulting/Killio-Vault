import { api } from './http';

/** Registers this device's Expo push token so Killio can notify Vault. */
export async function subscribeMobilePush(input: {
  expoToken: string;
  platform?: string;
  deviceId?: string;
}): Promise<void> {
  await api.post('/push/mobile/subscribe', input);
}

export async function unsubscribeMobilePush(expoToken: string): Promise<void> {
  await api
    .delete('/push/mobile/unsubscribe', { data: { expoToken } })
    .catch(() => undefined);
}
