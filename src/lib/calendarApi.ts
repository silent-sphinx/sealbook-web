import { LEGACY_ACCOUNT_SETTINGS_ID } from "./accountSettings";
import {
  DEFAULT_CALENDAR_ID,
  DEFAULT_CALENDAR_NAME,
  serializeCalendar,
  sortCalendars,
} from "./calendar";
import { putAccountSettings, listVault, putSealed } from "./client";
import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import type { Calendar, CalendarEvent } from "./types";
import { DEFAULT_CALENDAR_COLOR } from "./types";
import { newUuid } from "./wasm";
import type { Session } from "./client";

export const CALENDAR_EVENT_CONTENT_TYPE = "application/sealbook.calendar-event+json";
export const CALENDAR_CONTENT_TYPE = "application/sealbook.calendar+json";

/** Every key this build writes for an event. See `mergePayload`. */
export const CALENDAR_EVENT_KEYS = [
  "@type",
  "version",
  "title",
  "start",
  "end",
  "notes",
  "location",
  "participants",
  "timezone",
  "calendarId",
  "recurrence",
] as const;

export async function putCalendarEvent(session: Session, event: Omit<CalendarEvent, "id">, existingId?: string): Promise<string> {
  const id = existingId ?? newUuid();
  // `raw` is what the merge reads, not a field of the payload itself.
  const { raw, ...fields } = event;
  const plaintext = mergePayload(
    raw,
    { "@type": "CalendarEvent", version: PAYLOAD_SCHEMA_VERSION, ...fields },
    CALENDAR_EVENT_KEYS,
  );
  await putSealed(session, id, CALENDAR_EVENT_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function putCalendar(session: Session, calendar: Omit<Calendar, "id">, existingId?: string): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(session, id, CALENDAR_CONTENT_TYPE, false, serializeCalendar(calendar));
  return id;
}

export async function deleteCalendarEvent(session: Session, id: string): Promise<void> {
  await putSealed(session, id, CALENDAR_EVENT_CONTENT_TYPE, true, "");
}

/**
 * Returns the calendar list with the default one present, creating it if needed.
 *
 * Called when the Calendar tab is first opened rather than on every vault
 * refresh, for the reason `ensureDefaultNotebook` gives: a write here can fail,
 * and on the refresh path that failure would stop the whole vault loading.
 */
export async function ensureDefaultCalendar(
  session: Session,
  calendars: Calendar[],
): Promise<Calendar[]> {
  if (calendars.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID)) {
    return sortCalendars(calendars);
  }
  // The caller's list can predate the first vault read, and the write below is
  // to a fixed id: on an account that already has a default calendar it would
  // overwrite it, undoing a rename or a colour. So the absence is confirmed
  // against the vault before anything is written.
  const listed = await listVault(session);
  if (listed.calendars.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID)) {
    return listed.calendars;
  }
  // This id holds the settings on an account sealed before they moved off it,
  // and the write below would reset every preference. Copied first, so the
  // calendar only lands once they are safe.
  if (listed.accountSettingsId === LEGACY_ACCOUNT_SETTINGS_ID) {
    await putAccountSettings(session, listed.accountSettings, listed.accountSettingsRaw);
  }
  const body = {
    name: DEFAULT_CALENDAR_NAME,
    color: DEFAULT_CALENDAR_COLOR,
    favorite: false,
  };
  await putCalendar(session, body, DEFAULT_CALENDAR_ID);
  return sortCalendars([{ id: DEFAULT_CALENDAR_ID, ...body }, ...listed.calendars]);
}

export async function deleteCalendar(session: Session, id: string): Promise<void> {
  await putSealed(session, id, CALENDAR_CONTENT_TYPE, true, "");
}