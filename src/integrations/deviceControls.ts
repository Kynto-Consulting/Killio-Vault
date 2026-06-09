import { Platform, Vibration } from 'react-native';
import * as Battery from 'expo-battery';
import * as Brightness from 'expo-brightness';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as DeviceInfo from 'expo-device';
import * as Network from 'expo-network';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Torch from './native/KillioTorch';

/**
 * Additional device / local client-action integrations for the Vault assistant.
 * Each function is exposed to the agent as a client-action tool and executed
 * here on the device. Mirrors src/integrations/device.ts: graceful failures,
 * runtime permission requests on first use.
 */

// ─── pick_file ──────────────────────────────────────────────────────────────

const PICKER_MIME: Record<string, string | string[]> = {
  any: '*/*',
  image: 'image/*',
  pdf: 'application/pdf',
  text: ['text/*', 'application/json'],
};

/** Max bytes of a small text/json file we inline back to the model. */
const INLINE_MAX_BYTES = 64 * 1024;

export async function pickFile(type?: 'any' | 'image' | 'pdf' | 'text'): Promise<{
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
  content?: string;
}> {
  const res = await DocumentPicker.getDocumentAsync({
    type: PICKER_MIME[type ?? 'any'] ?? '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) {
    throw new Error('File selection cancelled.');
  }
  const asset = res.assets[0];
  const out: {
    name: string;
    uri: string;
    size?: number;
    mimeType?: string;
    content?: string;
  } = {
    name: asset.name,
    uri: asset.uri,
    size: asset.size ?? undefined,
    mimeType: asset.mimeType ?? undefined,
  };
  // Inline small text/json contents so the model can read them directly.
  const isTextual =
    !!asset.mimeType &&
    (asset.mimeType.startsWith('text/') || asset.mimeType === 'application/json');
  if (isTextual && (asset.size ?? 0) <= INLINE_MAX_BYTES) {
    try {
      out.content = await FileSystem.readAsStringAsync(asset.uri);
    } catch {
      // best-effort — leave content undefined
    }
  }
  return out;
}

// ─── battery_status ───────────────────────────────────────────────────────────

export async function batteryStatus(): Promise<{
  level: number;
  charging: boolean;
  lowPowerMode: boolean;
}> {
  const [level, state, lowPower] = await Promise.all([
    Battery.getBatteryLevelAsync(),
    Battery.getBatteryStateAsync(),
    Battery.isLowPowerModeEnabledAsync(),
  ]);
  return {
    level: Math.round(Math.max(0, level) * 100),
    charging:
      state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
    lowPowerMode: lowPower,
  };
}

// ─── flashlight ────────────────────────────────────────────────────────────────

export async function setFlashlight(on: boolean): Promise<{ on: boolean }> {
  // Native torch via CameraManager.setTorchMode (KillioTorch module). This needs
  // NO camera preview and NO CAMERA permission prompt — replacing the old, flaky
  // hidden-<CameraView> approach that re-prompted for permission every toggle
  // and often never engaged because the off-screen camera never started.
  if (!Torch.isAvailable()) {
    throw new Error('Torch unavailable on this build (requires the native APK, not Expo Go).');
  }
  if (!Torch.hasTorch()) {
    throw new Error('This device has no flashlight.');
  }
  const result = await Torch.setTorch(on);
  return { on: result };
}

// ─── set_brightness ──────────────────────────────────────────────────────────

export async function setBrightness(opts: {
  level?: number;
  restore?: boolean;
}): Promise<{ level: number | null; restored: boolean }> {
  let status = (await Brightness.getPermissionsAsync()).status;
  if (status !== 'granted') status = (await Brightness.requestPermissionsAsync()).status;
  if (status !== 'granted') throw new Error('Brightness permission denied.');
  if (opts.restore) {
    await Brightness.restoreSystemBrightnessAsync();
    return { level: null, restored: true };
  }
  const level = Math.min(1, Math.max(0, Number(opts.level ?? 0.5)));
  await Brightness.setSystemBrightnessAsync(level);
  return { level, restored: false };
}

// ─── set_alarm / set_timer (Android AlarmClock intents) ────────────────────────

export async function setAlarm(opts: {
  hour: number;
  minute: number;
  label?: string;
}): Promise<{ set: boolean }> {
  if (Platform.OS !== 'android') throw new Error('Alarms are only supported on Android.');
  await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
    extra: {
      'android.intent.extra.alarm.HOUR': Math.max(0, Math.min(23, Math.floor(opts.hour))),
      'android.intent.extra.alarm.MINUTES': Math.max(0, Math.min(59, Math.floor(opts.minute))),
      'android.intent.extra.alarm.MESSAGE': opts.label ?? '',
      'android.intent.extra.alarm.SKIP_UI': false,
    },
  });
  return { set: true };
}

export async function setTimer(opts: {
  seconds: number;
  label?: string;
}): Promise<{ set: boolean }> {
  if (Platform.OS !== 'android') throw new Error('Timers are only supported on Android.');
  await IntentLauncher.startActivityAsync('android.intent.action.SET_TIMER', {
    extra: {
      'android.intent.extra.alarm.LENGTH': Math.max(1, Math.floor(opts.seconds)),
      'android.intent.extra.alarm.MESSAGE': opts.label ?? '',
      'android.intent.extra.alarm.SKIP_UI': false,
    },
  });
  return { set: true };
}

// ─── vibrate ───────────────────────────────────────────────────────────────────

export async function vibrate(
  pattern?: 'light' | 'medium' | 'heavy' | 'success' | 'error',
): Promise<{ vibrated: boolean }> {
  try {
    switch (pattern) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'heavy':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case 'medium':
      default:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
    }
  } catch {
    // Fall back to the plain Vibration API where haptics aren't available.
    Vibration.vibrate(200);
  }
  return { vibrated: true };
}

// ─── device_info ───────────────────────────────────────────────────────────────

export async function deviceInfo(): Promise<{
  model: string | null;
  brand: string | null;
  osName: string | null;
  osVersion: string | null;
  battery: { level: number; charging: boolean; lowPowerMode: boolean } | null;
  network: { type: string | null; isConnected: boolean | null; isInternetReachable: boolean | null };
}> {
  let battery: { level: number; charging: boolean; lowPowerMode: boolean } | null = null;
  try {
    battery = await batteryStatus();
  } catch {
    battery = null;
  }
  let network: {
    type: string | null;
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  } = { type: null, isConnected: null, isInternetReachable: null };
  try {
    const state = await Network.getNetworkStateAsync();
    network = {
      type: state.type ?? null,
      isConnected: state.isConnected ?? null,
      isInternetReachable: state.isInternetReachable ?? null,
    };
  } catch {
    // leave defaults
  }
  return {
    model: DeviceInfo.modelName ?? null,
    brand: DeviceInfo.brand ?? null,
    osName: DeviceInfo.osName ?? Platform.OS,
    osVersion: DeviceInfo.osVersion ?? String(Platform.Version),
    battery,
    network,
  };
}
