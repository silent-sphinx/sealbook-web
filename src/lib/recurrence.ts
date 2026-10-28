import { recurrenceTo } from "./calendar";
import type { CalendarEvent, RecurrenceRule } from "./types";
import { localInputToUtc, utcToLocalInput } from "./timezone";
import { coreRecurrenceDays, coreRecurrenceNext } from "./wasm";

export type CalendarOccurrence = CalendarEvent & {
  sourceId: string;
  occurrenceKey: string;
};

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sameTime(source: CalendarEvent, date: Date, timezone: string): CalendarOccurrence {
  const key = dateKey(date);
  const sourceLocal = source.start.includes("T") ? utcToLocalInput(source.start, timezone) : `${source.start}T00:00`;
  const startSuffix = sourceLocal.slice(10);
  const duration = source.end && source.end.includes("T")
    ? new Date(source.end).getTime() - new Date(source.start).getTime()
    : source.end && !source.end.includes("T")
      ? (new Date(`${source.end}T00:00`).getTime() - new Date(`${source.start}T00:00`).getTime())
      : 0;
  const localStart = `${key}${startSuffix}`;
  const start = source.start.includes("T") ? localInputToUtc(localStart, timezone) : key;
  let end: string | undefined;
  if (source.end) {
    if (!source.end.includes("T")) {
      const endDate = new Date(`${key}T00:00`);
      endDate.setDate(endDate.getDate() + Math.max(0, Math.round(duration / 86400000)));
      end = dateKey(endDate);
    } else {
      end = new Date(new Date(start).getTime() + duration).toISOString();
    }
  }
  return { ...source, id: `${source.id}:${key}`, sourceId: source.id, occurrenceKey: key, start, end };
}

function dayAt(key: string): Date {
  return new Date(`${key}T00:00`);
}

export function expandCalendarEvents(events: CalendarEvent[], from: Date, to: Date, fallbackTimezone: string): CalendarOccurrence[] {
  const output: CalendarOccurrence[] = [];
  for (const event of events) {
    const timezone = event.timezone ?? fallbackTimezone;
    const anchorInput = event.start.includes("T") ? utcToLocalInput(event.start, timezone) : `${event.start}T00:00`;
    const anchor = new Date(anchorInput);
    if (Number.isNaN(anchor.getTime())) continue;
    const rule = event.recurrence;
    if (!rule) {
      if (anchor <= to && anchor >= from) output.push({ ...event, sourceId: event.id, occurrenceKey: dateKey(anchor) });
      continue;
    }
    const core = recurrenceTo(rule);
    for (const key of coreRecurrenceDays(dateKey(anchor), core, dateKey(from), dateKey(to))) {
      output.push(sameTime(event, dayAt(key), timezone));
    }
  }
  return output;
}

/**
 * The first occurrence of `rule` on a later day than `after`, at local midnight,
 * or null once the rule is spent.
 *
 * `count` is read as occurrences from `anchor` inclusive, the same as for an
 * event, so a caller that re-anchors on the date this returns has to take one
 * off `count` itself.
 */
export function nextOccurrence(anchor: Date, rule: RecurrenceRule, after: Date): Date | null {
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(after.getTime())) return null;
  const next = coreRecurrenceNext(dateKey(anchor), recurrenceTo(rule), dateKey(after));
  return next ? dayAt(next) : null;
}
