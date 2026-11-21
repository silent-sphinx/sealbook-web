import { UNTITLED_EVENT_TITLE, isCalendarVisible } from "./calendar";
import { keyFor, occurrencesIn, shiftDays } from "./calendarModel";
import { dateKindLabel } from "./contact";
import type { Bookmark, Calendar, CalendarEvent, Contact, ContactDateKind, Note } from "./types";

export const AGENDA_DAYS = 7;
export const UPCOMING_DATES_WINDOW = 30;

export type AgendaEntry = {
  /** The occurrence, unique within the agenda. */
  id: string;
  /** The stored event, which is what the calendar opens. */
  eventId: string;
  title: string;
  /** Null for an all-day event, or a timed one carried over from an earlier day. */
  time: string | null;
  color?: string;
};

export type AgendaDay = { key: string; entries: AgendaEntry[] };

const DAY_MS = 86_400_000;

/**
 * The next `days` days from `today`, each with the events that fall on it.
 * Calendars the grid would hide are left out here too, so the overview never
 * shows an event the calendar itself does not. Every day is returned, empty
 * or not, so the caller decides which to show.
 */
export function agendaDays(
  events: CalendarEvent[],
  calendars: Calendar[],
  today: Date,
  timezone: string,
  days = AGENDA_DAYS,
): AgendaDay[] {
  const visible = new Set(
    calendars.filter((calendar) => isCalendarVisible(calendar, new Set())).map((calendar) => calendar.id),
  );
  const colors = new Map(calendars.map((calendar) => [calendar.id, calendar.color]));
  const shown = events.filter((event) => !event.calendarId || visible.has(event.calendarId));
  // See CalendarView: occurrences are found by start, so the window is padded by
  // the longest event to catch one already under way on the first day.
  const maxSpanDays = shown.reduce((longest, event) => {
    const from = Date.parse(`${event.start.slice(0, 10)}T00:00:00Z`);
    const to = Date.parse(`${(event.end ?? event.start).slice(0, 10)}T00:00:00Z`);
    const span = Math.round((to - from) / DAY_MS);
    return Number.isFinite(span) && span > longest ? span : longest;
  }, 0);
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const last = shiftDays(first, days - 1);
  const { visibleEvents, spans } = occurrencesIn(shown, first, last, maxSpanDays, timezone);

  return Array.from({ length: days }, (_, index) => {
    const key = keyFor(shiftDays(first, index));
    const entries = visibleEvents
      .flatMap((event) => {
        const span = spans.get(event.id);
        if (!span || key < span.startKey || key > span.endKey) return [];
        const occurrence = event as CalendarEvent & { sourceId?: string };
        const entry: AgendaEntry = {
          id: event.id,
          eventId: occurrence.sourceId ?? event.id,
          title: event.title.trim() || UNTITLED_EVENT_TITLE,
          time: span.startKey === key ? span.timeLabel : null,
          color: event.calendarId ? colors.get(event.calendarId) : undefined,
        };
        return [{ entry, start: event.start }];
      })
      .sort((a, b) => {
        if ((a.entry.time === null) !== (b.entry.time === null)) return a.entry.time === null ? -1 : 1;
        return a.start.localeCompare(b.start) || a.entry.title.localeCompare(b.entry.title);
      })
      .map(({ entry }) => entry);
    return { key, entries };
  });
}

export type UpcomingDate = {
  /** Unique within the list: a contact can have several dates on one day. */
  id: string;
  contactId: string;
  name: string;
  kind: ContactDateKind;
  label: string;
  /** The local day it next falls on, `YYYY-MM-DD`. */
  key: string;
  daysAway: number;
  /** Years since the stored year, when one is stored and it is in the past. */
  years: number | null;
};

// The date input writes `YYYY-MM-DD`; a vCard import can leave `--MM-DD` or
// `--MMDD` for a date stored without its year.
const STORED_DATE = /^(?:(\d{4})-?|--)(\d{2})-?(\d{2})$/;

function nextOn(month: number, day: number, today: Date): Date {
  const on = (year: number) => {
    const leap = new Date(year, 1, 29).getMonth() === 1;
    // A 29 February outside a leap year is marked on the 28th.
    return new Date(year, month - 1, month === 2 && day === 29 && !leap ? 28 : day);
  };
  const thisYear = on(today.getFullYear());
  return thisYear < today ? on(today.getFullYear() + 1) : thisYear;
}

/** Birthdays, anniversaries and other dates on contacts that come round within `windowDays`. */
export function upcomingDates(
  contacts: Contact[],
  today: Date,
  windowDays = UPCOMING_DATES_WINDOW,
): UpcomingDate[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const found: UpcomingDate[] = [];
  for (const contact of contacts) {
    if (contact.archived) continue;
    for (const date of contact.dates ?? []) {
      const match = STORED_DATE.exec(date.date.trim());
      if (!match) continue;
      const [, year, monthText, dayText] = match;
      const month = Number(monthText);
      const day = Number(dayText);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      if (new Date(2000, month - 1, day).getMonth() !== month - 1) continue;
      const next = nextOn(month, day, start);
      const daysAway = Math.round((next.getTime() - start.getTime()) / DAY_MS);
      if (daysAway > windowDays) continue;
      const years = year ? next.getFullYear() - Number(year) : null;
      found.push({
        id: `${contact.id}:${date.id}`,
        contactId: contact.id,
        name: contact.name || contact.derivedName || "Unnamed contact",
        kind: date.kind,
        label: dateKindLabel(date.kind, date.label),
        key: keyFor(next),
        daysAway,
        years: years !== null && years > 0 ? years : null,
      });
    }
  }
  return found.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
}

function stamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** The notes edited most recently, newest first. */
export function recentNotes(notes: Note[], limit: number): Note[] {
  return [...notes]
    .sort((a, b) => stamp(b.updatedAt ?? b.createdAt) - stamp(a.updatedAt ?? a.createdAt))
    .slice(0, limit);
}

/** The bookmarks saved most recently, newest first. */
export function recentBookmarks(bookmarks: Bookmark[], limit: number): Bookmark[] {
  return [...bookmarks]
    .sort((a, b) => stamp(b.createdAt ?? b.updatedAt) - stamp(a.createdAt ?? a.updatedAt))
    .slice(0, limit);
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}
