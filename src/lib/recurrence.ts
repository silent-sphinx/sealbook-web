import type { CalendarEvent, RecurrenceRule } from "./types";
import { localInputToUtc, utcToLocalInput } from "./timezone";

export type CalendarOccurrence = CalendarEvent & {
  sourceId: string;
  occurrenceKey: string;
};

const MAX_RECURRENCE_ITERATIONS = 10_000;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAt(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
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

function nthWeekdayDate(year: number, month: number, ordinal: number, weekday: number): Date | null {
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (ordinal - 1) * 7;
  return day <= new Date(year, month + 1, 0).getDate() ? dateAt(year, month, day) : null;
}

function matchesRule(date: Date, anchor: Date, rule: RecurrenceRule): boolean {
  const interval = Math.max(1, rule.interval ?? 1);
  const dayDelta = Math.floor((date.getTime() - anchor.getTime()) / 86400000);
  if (rule.frequency === "daily") return dayDelta >= 0 && dayDelta % interval === 0;
  if (rule.frequency === "weekly") {
    const weeks = Math.floor(dayDelta / 7);
    const weekdays = rule.weekdays?.length ? rule.weekdays : [anchor.getDay()];
    return weeks >= 0 && weeks % interval === 0 && weekdays.includes(date.getDay());
  }
  if (rule.frequency === "monthly") {
    const months = (date.getFullYear() - anchor.getFullYear()) * 12 + date.getMonth() - anchor.getMonth();
    if (months < 0 || months % interval !== 0) return false;
    if (rule.nthWeekday) {
      const occurrence = nthWeekdayDate(date.getFullYear(), date.getMonth(), rule.nthWeekday.ordinal, rule.nthWeekday.weekday);
      return occurrence !== null && date.getTime() === occurrence.getTime();
    }
    return date.getDate() === (rule.dayOfMonth ?? anchor.getDate());
  }
  const years = date.getFullYear() - anchor.getFullYear();
  return years >= 0 && years % interval === 0 && date.getMonth() === anchor.getMonth() && date.getDate() === anchor.getDate();
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
    const until = rule.until ? new Date(`${rule.until}T23:59:59`) : null;
    let occurrenceCount = 0;
    const cursor = new Date(Math.max(anchor.getTime(), from.getTime()));
    cursor.setHours(0, 0, 0, 0);
    let iterations = 0;
    while (cursor <= to && iterations < MAX_RECURRENCE_ITERATIONS) {
      iterations += 1;
      if (until && cursor > until) break;
      if (matchesRule(cursor, anchor, rule)) {
        occurrenceCount += 1;
        if (cursor >= from && (!rule.count || occurrenceCount <= rule.count)) output.push(sameTime(event, cursor, timezone));
        if (rule.count && occurrenceCount >= rule.count) break;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return output;
}