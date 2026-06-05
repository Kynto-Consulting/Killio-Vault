import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';

/**
 * Device-native convenience integrations (no OAuth). Each is exposed to the
 * agent as a client-action tool and executed here on the Vault device.
 */

export interface ContactHit {
  name: string;
  numbers: string[];
}

export async function requestContacts(): Promise<boolean> {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === 'granted';
}

/** contacts_search — find contacts by name; returns names + phone numbers. */
export async function searchContacts(query: string, limit = 8): Promise<ContactHit[]> {
  if (!(await requestContacts())) throw new Error('Contacts permission denied.');
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });
  const q = query.trim().toLowerCase();
  return data
    .filter((c) => (c.name ?? '').toLowerCase().includes(q))
    .slice(0, limit)
    .map((c) => ({
      name: c.name ?? '',
      numbers: (c.phoneNumbers ?? [])
        .map((p) => p.number ?? '')
        .filter(Boolean),
    }))
    .filter((c) => c.numbers.length > 0);
}

export interface LocationFix {
  lat: number;
  lng: number;
  label?: string;
}

export async function requestLocation(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/** get_location — current device location, with a best-effort place label. */
export async function getLocation(): Promise<LocationFix> {
  if (!(await requestLocation())) throw new Error('Location permission denied.');
  const pos = await Location.getCurrentPositionAsync({});
  const fix: LocationFix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude: fix.lat,
      longitude: fix.lng,
    });
    if (place) {
      fix.label = [place.name, place.city, place.region, place.country]
        .filter(Boolean)
        .join(', ');
    }
  } catch {
    // geocoding optional
  }
  return fix;
}

/** send_sms — opens the SMS composer prefilled (user sends). */
export async function sendSms(
  numbers: string[],
  body: string,
): Promise<{ result: string }> {
  if (!(await SMS.isAvailableAsync())) throw new Error('SMS not available on this device.');
  const { result } = await SMS.sendSMSAsync(numbers, body);
  return { result };
}
