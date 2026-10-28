import type { Calendar, CalendarEvent, RecurrenceRule } from "./types";
import {
  coreCalendarNameById,
  coreCalendarParse,
  coreCalendarWrite,
  coreEventParse,
  coreEventWrite,
} from "./wasm";
import type { CoreCalendar, CoreCalendarEvent, CoreRecurrence } from "./wasm";

// Mirrors of the Rust constants in `sealbook-core`'s `calendars` module. They
// stay literals here because module scope runs before `initWasm`, and
// `calendarParity.test.ts` asserts every one of them against core so they
// cannot drift. Same arrangement as the note constants in `note.ts`.
export const DEFAULT_CALENDAR_NAME = "Default Calendar";
export const DEFAULT_CALENDAR_ID = "00000000-0000-0000-0000-000000000003";
export const UNTITLED_CALENDAR_NAME = "Untitled calendar";
export const UNTITLED_EVENT_TITLE = "Untitled event";

/**
 * The wire form of a calendar and of an event.
 *
 * Both the writer and the reader are core's as of the client unification's
 * phase 8, so the owned key sets, the trimming, the fallback names and the
 * omit-rather-than-null rule are one implementation rather than three. What
 * stays here is this client's view model and everything above the payload:
 * sorting, the archived/active split and which calendars are drawn.
 *
 * Core filters the fields it is handed down to the owned keys, which is what
 * closes the hole this function used to have: it took `Omit<Calendar, "id">`
 * and spread the rest, so a caller handing it a whole `Calendar` wrote the
 * object id into the plaintext, and TypeScript's excess-property check does not
 * catch that through a variable.
 */
export function serializeCalendar(calendar: Omit<Calendar, "id">): string {
  return coreCalendarWrite({
    name: calendar.name,
    color: calendar.color,
    favorite: calendar.favorite === true,
    archived: calendar.archived === true,
    raw: calendar.raw,
  });
}

export function parseCalendar(id: string, raw: string): Calendar {
  return calendarFrom(coreCalendarParse(id, raw));
}

function calendarFrom(calendar: CoreCalendar): Calendar {
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color,
    favorite: calendar.favorite,
    archived: calendar.archived,
    readable: calendar.readable,
    raw: calendar.raw,
  };
}

/**
 * Writes an event's plaintext through core.
 *
 * `unreadableRecurrence` is the one field nothing in this client reads: it is
 * the stored repeat rule core could not name, carried back so the write puts it
 * where it was. Dropping it turned a series written by a newer client into a
 * single event everywhere, which is what Android did.
 */
export function serializeEvent(event: Omit<CalendarEvent, "id">): string {
  return coreEventWrite({
    title: event.title,
    start: event.start,
    end: event.end,
    notes: event.notes,
    location: event.location,
    participants: event.participants ?? [],
    timezone: event.timezone,
    calendar_id: event.calendarId,
    recurrence: event.recurrence ? recurrenceTo(event.recurrence) : undefined,
    unreadable_recurrence: event.unreadableRecurrence,
    raw: event.raw,
  });
}

export function parseEvent(id: string, raw: string): CalendarEvent {
  return eventFrom(coreEventParse(id, raw));
}

function eventFrom(event: CoreCalendarEvent): CalendarEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    notes: event.notes,
    location: event.location,
    participants: event.participants.length ? event.participants : undefined,
    timezone: event.timezone,
    calendarId: event.calendar_id,
    recurrence: event.recurrence ? recurrenceFrom(event.recurrence) : undefined,
    unreadableRecurrence: event.unreadable_recurrence,
    readable: event.readable,
    raw: event.raw,
  };
}

// Core's records are snake_case on the TypeScript boundary, as every core record
// is, and this client's rule is camelCase and read all over the composer.
export function recurrenceFrom(rule: CoreRecurrence): RecurrenceRule {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    until: rule.until,
    count: rule.count,
    weekdays: rule.weekdays.length > 0 ? rule.weekdays : undefined,
    dayOfMonth: rule.day_of_month,
    nthWeekday: rule.nth_weekday
      ? { ordinal: rule.nth_weekday.ordinal as 1 | 2 | 3 | 4 | 5, weekday: rule.nth_weekday.weekday }
      : undefined,
  };
}

export function recurrenceTo(rule: RecurrenceRule): CoreRecurrence {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    until: rule.until,
    count: rule.count,
    weekdays: rule.weekdays ?? [],
    day_of_month: rule.dayOfMonth,
    nth_weekday: rule.nthWeekday,
  };
}

/** The name to show for an event's calendar, against the list in hand. */
export function calendarNameById(calendars: Calendar[], calendarId?: string): string | undefined {
  return coreCalendarNameById(
    calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      favorite: calendar.favorite === true,
      archived: calendar.archived === true,
      readable: calendar.readable !== false,
      raw: calendar.raw ?? "",
    })),
    calendarId,
  );
}

export function sortCalendars(calendars: Calendar[]): Calendar[] {
  return [...calendars].sort((a, b) => {
    if (a.id === DEFAULT_CALENDAR_ID) return -1;
    if (b.id === DEFAULT_CALENDAR_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** The calendars in play: an archived one is out of the list and the pickers. */
export function activeCalendars(calendars: Calendar[]): Calendar[] {
  return calendars.filter((calendar) => calendar.archived !== true);
}

export function archivedCalendars(calendars: Calendar[]): Calendar[] {
  return calendars.filter((calendar) => calendar.archived === true);
}

/**
 * Whether a calendar is drawn on the grid.
 *
 * The two sets are each the exception to their group's default, which is what
 * lets one toggle serve both: a calendar in play shows unless it is in
 * `hidden`, and an archived one hides unless it is in `shownArchived`. So an
 * archived calendar can be switched on for a look without being restored.
 */
export function isCalendarVisible(
  calendar: Calendar,
  hidden: ReadonlySet<string>,
  shownArchived: ReadonlySet<string>,
): boolean {
  return calendar.archived === true ? shownArchived.has(calendar.id) : !hidden.has(calendar.id);
}

/** The ids [isCalendarVisible] holds for, as the event filters want them. */
export function visibleCalendarIds(
  calendars: Calendar[],
  hidden: ReadonlySet<string>,
  shownArchived: ReadonlySet<string>,
): Set<string> {
  return new Set(
    calendars.filter((calendar) => isCalendarVisible(calendar, hidden, shownArchived)).map((calendar) => calendar.id),
  );
}
