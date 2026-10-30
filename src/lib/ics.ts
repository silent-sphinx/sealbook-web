import { coreEventDraftOf, recurrenceFrom } from "./calendar";
import { localInputToUtc } from "./timezone";
import type { CalendarEvent } from "./types";
import { coreIcsParse, coreIcsWrite } from "./wasm";

export type CalendarImportResult = {
  events: Omit<CalendarEvent, "id">[];
  /**
   * Entries dropped for being unusable, so the UI can say so rather than lose
   * them quietly. One unreadable date in an export of hundreds must not cost
   * the rest.
   */
  skipped: { title: string; reason: string }[];
};

/**
 * A time core left as local wall-clock text, as the instant it names in `zone`.
 * A date or an instant is already final. Whole seconds, as every client writes.
 */
function resolved(value: string, zone: string): string {
  if (!value.includes("T") || value.endsWith("Z")) return value;
  return localInputToUtc(value.slice(0, 16), zone).replace(/\.\d+Z$/, "Z");
}

export function parseIcs(input: string, timezone: string, calendarId?: string): CalendarImportResult {
  const { events, skipped } = coreIcsParse(input);
  return {
    events: events.map((event) => ({
      title: event.title,
      start: resolved(event.start, event.start_zone ?? timezone),
      end: event.end === undefined ? undefined : resolved(event.end, event.end_zone ?? timezone),
      notes: event.notes,
      location: event.location,
      participants: event.participants.length ? event.participants : undefined,
      timezone: event.start_zone ?? timezone,
      calendarId,
      recurrence: event.recurrence ? recurrenceFrom(event.recurrence) : undefined,
    })),
    skipped,
  };
}

function titleOf(value: Record<string, unknown>): string {
  return typeof value.title === "string" && value.title.trim() ? value.title : "Untitled event";
}

export function parseCalendarImport(input: string, timezone: string, calendarId?: string): CalendarImportResult {
  if (!input.trimStart().startsWith("[") && !input.trimStart().startsWith("{")) {
    return parseIcs(input, timezone, calendarId);
  }

  const parsed: unknown = JSON.parse(input);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const events: Omit<CalendarEvent, "id">[] = [];
  const skipped: CalendarImportResult["skipped"] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      skipped.push({ title: "Untitled event", reason: "it is not an event" });
      continue;
    }
    const record = entry as Record<string, unknown>;
    let payload: unknown = record;
    if (typeof record.payload === "string") {
      try {
        payload = JSON.parse(record.payload);
      } catch {
        skipped.push({ title: titleOf(record), reason: "its payload could not be read" });
        continue;
      }
    }
    if (!payload || typeof payload !== "object") {
      skipped.push({ title: titleOf(record), reason: "its payload is not an event" });
      continue;
    }
    const event = payload as Record<string, unknown>;
    if (typeof event.title !== "string" || typeof event.start !== "string") {
      skipped.push({ title: titleOf(event), reason: "it has no title or start date" });
      continue;
    }
    events.push({
      title: event.title,
      start: event.start,
      end: typeof event.end === "string" ? event.end : undefined,
      notes: typeof event.notes === "string" ? event.notes : undefined,
      location: typeof event.location === "string" ? event.location : undefined,
      participants: Array.isArray(event.participants)
        ? event.participants.filter((participant): participant is string => typeof participant === "string")
        : undefined,
      timezone: typeof event.timezone === "string" ? event.timezone : timezone,
      calendarId: calendarId || (typeof event.calendarId === "string" ? event.calendarId : undefined),
      recurrence: event.recurrence as CalendarEvent["recurrence"],
    });
  }
  return { events, skipped };
}

/** Serializes events as an RFC 5545 calendar, written by core. */
export function formatIcs(events: CalendarEvent[], calendarName = "Sealbook"): string {
  return coreIcsWrite(
    events.map((event) => ({ id: event.id, event: coreEventDraftOf(event) })),
    calendarName,
    new Date().toISOString(),
  );
}
