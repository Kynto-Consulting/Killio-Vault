import * as Calendar from 'expo-calendar';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';

/**
 * Live permission status for device-side integrations (calendar / contacts /
 * location). The web /agent/integrations/available endpoint has no idea about
 * OS permissions, so the catalog "Connected" flag has to come from here.
 */
export type DevicePerm = 'calendar' | 'contacts' | 'location';

export async function isDeviceConnected(perm: DevicePerm): Promise<boolean> {
  try {
    if (perm === 'calendar') {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      return status === 'granted';
    }
    if (perm === 'contacts') {
      const { status } = await Contacts.getPermissionsAsync();
      return status === 'granted';
    }
    if (perm === 'location') {
      const { status } = await Location.getForegroundPermissionsAsync();
      return status === 'granted';
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Returns the set of connected device providers ("device_calendar", ...). */
export async function getConnectedDeviceProviders(): Promise<Set<string>> {
  const out = new Set<string>();
  if (await isDeviceConnected('calendar')) out.add('device_calendar');
  if (await isDeviceConnected('contacts')) out.add('device_contacts');
  if (await isDeviceConnected('location')) out.add('device_location');
  return out;
}
