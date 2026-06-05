import * as ExpoCalendar from 'expo-calendar';

/**
 * Device calendar access (expo-calendar). Free, no OAuth — gives the agent
 * context about the user's schedule. Google Calendar can be added later as a
 * backend integration behind the same tool shapes.
 *
 * Exposed to the agent as client-action tools (calendar_list_events /
 * calendar_create_event), executed on the device via the pause/resume pattern.
 */
export interface CalEvent {
  id: string;
  title: string;
  start: number; // UTC epoch ms
  end: number;
  location?: string;
  notes?: string;
  allDay?: boolean;
}

export async function requestPermission(): Promise<boolean> {
  const { status } = await ExpoCalendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

async function eventCalendarIds(): Promise<string[]> {
  const cals = await ExpoCalendar.getCalendarsAsync(ExpoCalendar.EntityTypes.EVENT);
  return cals.map((c) => c.id);
}

/** Lists events between two UTC-epoch-ms bounds (default: next 7 days). */
export async function listEvents(
  startMs?: number,
  endMs?: number,
): Promise<CalEvent[]> {
  if (!(await requestPermission())) {
    throw new Error('Calendar permission denied.');
  }
  const now = startMs ?? Date.now();
  const end = endMs ?? now + 7 * 24 * 60 * 60 * 1000;
  const ids = await eventCalendarIds();
  if (ids.length === 0) return [];
  const events = await ExpoCalendar.getEventsAsync(
    ids,
    new Date(now),
    new Date(end),
  );
  return events.map((e) => ({
    id: e.id,
    title: e.title ?? '(sin título)',
    start: new Date(e.startDate as string).getTime(),
    end: new Date(e.endDate as string).getTime(),
    location: e.location ?? undefined,
    notes: e.notes ?? undefined,
    allDay: e.allDay ?? undefined,
  }));
}

/** Creates an event in the device's default calendar. */
export async function createEvent(input: {
  title: string;
  start: number;
  end: number;
  location?: string;
  notes?: string;
}): Promise<{ id: string }> {
  if (!(await requestPermission())) {
    throw new Error('Calendar permission denied.');
  }
  const def = await ExpoCalendar.getDefaultCalendarAsync().catch(() => null);
  let calendarId = def?.id;
  if (!calendarId) {
    const ids = await eventCalendarIds();
    calendarId = ids[0];
  }
  if (!calendarId) throw new Error('No writable calendar found.');
  const id = await ExpoCalendar.createEventAsync(calendarId, {
    title: input.title,
    startDate: new Date(input.start),
    endDate: new Date(input.end),
    location: input.location,
    notes: input.notes,
  });
  return { id };
}
