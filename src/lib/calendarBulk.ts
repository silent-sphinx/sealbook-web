import { utcToLocalInput } from "./timezone";
import type { CalendarEvent } from "./types";

export type TitleMatch = "prefix" | "contains" | "suffix" | "exact";

/** `calendarId` is "all", "none" for events with no calendar, or a calendar id. */
export type EventFilter = {
  text: string;
  match: TitleMatch;
  caseSensitive: boolean;
  calendarId: string;
  from?: string;
  to?: string;
};

export type TitleEdit =
  | { kind: "keep" }
  | { kind: "strip" }
  | { kind: "replace"; find: string; replace: string }
  | { kind: "prefix"; text: string }
  | { kind: "suffix"; text: string }
  | { kind: "set"; text: string };

export type BulkEdit = {
  title: TitleEdit;
  /** Target calendar id, or undefined to leave each event where it is. */
  calendarId?: string;
};

export type PlannedChange = {
  event: CalendarEvent;
  title: string;
  calendarId: string | undefined;
  changed: boolean;
};

const SEPARATORS = "\\s\\-\\u2013\\u2014:|/\\u00b7.,;";
const LEADING_SEPARATORS = new RegExp(`^[${SEPARATORS}]+`);
const TRAILING_SEPARATORS = new RegExp(`[${SEPARATORS}]+$`);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fold(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLocaleLowerCase();
}

export function matchesTitle(title: string, filter: Pick<EventFilter, "text" | "match" | "caseSensitive">): boolean {
  if (!filter.text) return true;
  const haystack = fold(title, filter.caseSensitive);
  const needle = fold(filter.text, filter.caseSensitive);
  switch (filter.match) {
    case "prefix":
      return haystack.startsWith(needle);
    case "suffix":
      return haystack.endsWith(needle);
    case "exact":
      return haystack === needle;
    default:
      return haystack.includes(needle);
  }
}

/** The event's start as a local calendar day, YYYY-MM-DD. */
export function eventDay(event: CalendarEvent, timezone: string): string {
  if (!event.start.includes("T")) return event.start.slice(0, 10);
  return utcToLocalInput(event.start, event.timezone || timezone).slice(0, 10);
}

export function filterEvents(events: CalendarEvent[], filter: EventFilter, timezone: string): CalendarEvent[] {
  return events
    .filter((event) => {
      if (filter.calendarId === "none" && event.calendarId) return false;
      if (filter.calendarId !== "all" && filter.calendarId !== "none" && event.calendarId !== filter.calendarId) {
        return false;
      }
      if (!matchesTitle(event.title, filter)) return false;
      if (filter.from || filter.to) {
        const day = eventDay(event, timezone);
        if (filter.from && day < filter.from) return false;
        if (filter.to && day > filter.to) return false;
      }
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/**
 * Removes the filter's text from a title, then the separators the cut leaves
 * behind, so "HOL - Paris" less "HOL" reads "Paris". A title that would end
 * up empty is returned unchanged.
 */
export function stripMatch(title: string, filter: Pick<EventFilter, "text" | "match" | "caseSensitive">): string {
  const { text, match, caseSensitive } = filter;
  if (!text || match === "exact" || !matchesTitle(title, filter)) return title;
  let next: string;
  if (match === "prefix") {
    next = title.slice(text.length).replace(LEADING_SEPARATORS, "");
  } else if (match === "suffix") {
    next = title.slice(0, title.length - text.length).replace(TRAILING_SEPARATORS, "");
  } else {
    const pattern = new RegExp(escapeRegExp(text), caseSensitive ? "g" : "gi");
    next = title
      .replace(pattern, " ")
      .replace(/\s{2,}/g, " ")
      .replace(LEADING_SEPARATORS, "")
      .replace(TRAILING_SEPARATORS, "");
  }
  return next.trim() ? next.trim() : title;
}

export function editTitle(title: string, edit: TitleEdit, filter: EventFilter): string {
  switch (edit.kind) {
    case "strip":
      return stripMatch(title, filter);
    case "replace": {
      if (!edit.find) return title;
      const pattern = new RegExp(escapeRegExp(edit.find), filter.caseSensitive ? "g" : "gi");
      const next = title.replace(pattern, () => edit.replace).replace(/\s{2,}/g, " ").trim();
      return next || title;
    }
    case "prefix":
      return edit.text ? `${edit.text}${title}` : title;
    case "suffix":
      return edit.text ? `${title}${edit.text}` : title;
    case "set":
      return edit.text.trim() || title;
    default:
      return title;
  }
}

export function planBulkEdit(events: CalendarEvent[], edit: BulkEdit, filter: EventFilter): PlannedChange[] {
  return events.map((event) => {
    const title = editTitle(event.title, edit.title, filter);
    const calendarId = edit.calendarId ?? event.calendarId;
    return {
      event,
      title,
      calendarId,
      changed: title !== event.title || calendarId !== event.calendarId,
    };
  });
}
