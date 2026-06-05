import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { getDeviceId } from '../core/device';
import { subscribeMobilePush, unsubscribeMobilePush } from '../core/api/push.client';

/**
 * Registers this Vault install for Killio push notifications: requests
 * permission, fetches the Expo push token, and saves it server-side so normal
 * Killio notifications (mentions, assignments, etc.) reach the phone via Vault.
 *
 * Best-effort — silently no-ops in Expo Go without a projectId, or if the user
 * denies permission. Returns the token (for later unsubscribe) or null.
 */
let lastToken: string | null = null;

// Show notifications while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<string | null> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Killio',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return null;

    lastToken = token;
    await subscribeMobilePush({
      expoToken: token,
      platform: Platform.OS,
      deviceId: await getDeviceId(),
    });
    return token;
  } catch {
    return null;
  }
}

/** Unregisters the current device token (call on logout). */
export async function unregisterForPush(): Promise<void> {
  if (!lastToken) return;
  await unsubscribeMobilePush(lastToken);
  lastToken = null;
}
