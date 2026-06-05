import { PermissionsAndroid, Platform } from 'react-native';

export interface CapturePermissions {
  microphone: boolean;
  notifications: boolean;
}

/**
 * Requests the runtime permissions the foreground capture service needs.
 * Android 14 typed FGS requires RECORD_AUDIO granted before start; POST_
 * NOTIFICATIONS (API 33+) is needed for the persistent notification.
 */
export async function requestCapturePermissions(): Promise<CapturePermissions> {
  if (Platform.OS !== 'android') {
    return { microphone: false, notifications: false };
  }

  const toAsk: string[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (Number(Platform.Version) >= 33) {
    toAsk.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  const res = await PermissionsAndroid.requestMultiple(toAsk as any);
  const granted = (k: string) =>
    res[k as keyof typeof res] === PermissionsAndroid.RESULTS.GRANTED;

  return {
    microphone: granted(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
    notifications:
      Number(Platform.Version) < 33 ||
      granted(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
  };
}

export async function hasMicrophone(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
}
