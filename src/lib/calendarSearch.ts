import { DEFAULT_CALENDAR_COLOR } from "./types";
import type { Calendar, CalendarEvent } from "./types";
import { expandCalendarEvents } from "./recurrence";
import { dateFromKey } from "./calendarModel";
import { utcToLocalInput } from "./timezone";

export type SearchResult = {
  event: CalendarEvent;
  date: Date;
  dateLabel: string;
  timeLabel: string | null;
  color: string;
  calendarName: string | null;
};

function matchesQuery(event: CalendarEvent, query: string): boolean {
  if (event.title.toLowerCase().includes(query)) return true;
  if (event.location?.toLowerCase().includes(query)) return true;
  if (event.notes?.toLowerCase().includes(query)) return true;
  return event.participants?.some((participant) => participant.toLowerCase().includes(query)) ?? false;
}

const SEARCH_SCAN_LIMIT = 80;
export const SEARCH_RESULT_LIMIT = 25;

/**
 * Where an event lands for a search: the day it next falls on from today for a
 * recurring one, else its own start, with the labels a result row shows.
 */
export function resolveEvent(
  event: CalendarEvent,
  calendars: Calendar[],
  today: Date,
  fallbackTimezone: string,
): SearchResult {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let startValue = event.start;
  if (event.recurrence) {
    const horizon = new Date(startOfToday);
    horizon.setFullYear(horizon.getFullYear() + 2);
    const next = expandCalendarEvents([event], startOfToday, horizon, fallbackTimezone)[0];
    if (next) startValue = next.start;
  }
  const allDay = !startValue.includes("T");
  const local = allDay
    ? `${startValue.slice(0, 10)}T00:00`
    : utcToLocalInput(startValue, event.timezone ?? fallbackTimezone);
  const date = dateFromKey(local.slice(0, 10));
  const calendar = calendars.find((entry) => entry.id === event.calendarId);
  return {
    event,
    date,
    dateLabel: date.toLocaleDateString([], date.getFullYear() === today.getFullYear()
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" }),
    timeLabel: allDay
      ? "All day"
      : new Date(`${local}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    color: calendar?.color ?? DEFAULT_CALENDAR_COLOR,
    calendarName: calendar?.name ?? null,
  };
}

export function searchEvents(
  events: CalendarEvent[],
  calendars: Calendar[],
  rawQuery: string,
  today: Date,
  fallbackTimezone: string,
): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const resolved = events
    .filter((event) => matchesQuery(event, query))
    .slice(0, SEARCH_SCAN_LIMIT)
    .map((event) => resolveEvent(event, calendars, today, fallbackTimezone));

  return resolved
    .sort((a, b) => {
      const aAhead = a.date >= startOfToday;
      const bAhead = b.date >= startOfToday;
      if (aAhead !== bAhead) return aAhead ? -1 : 1;
      return aAhead ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime();
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}