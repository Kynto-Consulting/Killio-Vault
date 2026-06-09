import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';

/**
 * Device-native convenience integrations (no OAuth). Each is exposed to the
 * agent as a client-action tool and executed here on the Vault device.
 */

export interface ContactHit {
  name: string;
  /** Primary phone number (first available), for convenience. */
  phone?: string;
  /** All phone numbers on the contact. */
  numbers: string[];
}

/** Check permission first; only prompt if not already granted (avoids
 *  re-prompting on every call, the same bug the old flashlight had). */
export async function requestContacts(): Promise<boolean> {
  let { status, canAskAgain } = await Contacts.getPermissionsAsync();
  if (status !== 'granted' && canAskAgain) {
    ({ status } = await Contacts.requestPermissionsAsync());
  }
  return status === 'granted';
}

/** Strip accents/diacritics and lowercase for tolerant matching. */
function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * contacts_search — find contacts by name; returns names + phone numbers.
 *
 * Matches case/accent-insensitively as a substring across name, firstName,
 * lastName, nickname and company. When the query is empty/missing, returns the
 * first N contacts (with phone numbers) instead of an empty list.
 */
export async function searchContacts(query: string, limit = 8): Promise<ContactHit[]> {
  if (!(await requestContacts())) throw new Error('Contacts permission denied.');
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.Nickname,
      Contacts.Fields.Company,
      Contacts.Fields.PhoneNumbers,
    ],
  });

  const q = normalize(query);
  const withNumbers = data
    .map((c) => {
      const numbers = (c.phoneNumbers ?? [])
        .map((p) => (p.number ?? '').trim())
        .filter(Boolean);
      return {
        name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || '',
        phone: numbers[0],
        numbers,
        // Pre-built haystack of every searchable field.
        haystack: [c.name, c.firstName, c.lastName, c.nickname, c.company]
          .map(normalize)
          .join(' '),
      };
    })
    .filter((c) => c.numbers.length > 0);

  const matched = q
    ? withNumbers.filter((c) => c.haystack.includes(q))
    : withNumbers;

  return matched.slice(0, limit).map(({ name, phone, numbers }) => ({ name, phone, numbers }));
}

export interface LocationFix {
  lat: number;
  lng: number;
  label?: string;
}

/** Check permission first; only prompt if not already granted (and allowed to
 *  ask). Avoids re-prompting on every call. */
export async function requestLocation(): Promise<boolean> {
  let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted' && canAskAgain) {
    ({ status } = await Location.requestForegroundPermissionsAsync());
  }
  return status === 'granted';
}

/** Resolve a promise with a timeout fallback so location never hangs the turn. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * get_location — current device location, with a best-effort place label.
 *
 * Robust against the common failure modes:
 *  - permission already granted → no re-prompt
 *  - location services disabled → clear error (no hang)
 *  - GPS slow → fast last-known fallback, then a timed getCurrentPosition
 */
export async function getLocation(): Promise<LocationFix> {
  if (!(await requestLocation())) throw new Error('Location permission denied.');

  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location services are turned off. Enable GPS/location and try again.');
  }

  // Fast path: last-known fix returns immediately if recent.
  let pos = await Location.getLastKnownPositionAsync().catch(() => null);

  // Otherwise get a fresh fix, but never hang the turn — cap at 10s.
  if (!pos) {
    pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      10_000,
    );
  }

  if (!pos) {
    throw new Error('Could not get a location fix (timed out). Try again outdoors or with GPS on.');
  }

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
