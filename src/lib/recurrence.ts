import type { CalendarEvent, RecurrenceRule } from "./types";
import { localInputToUtc, utcToLocalInput } from "./timezone";

export type CalendarOccurrence = CalendarEvent & {
  sourceId: string;
  occurrenceKey: string;
};

/**
 * Periods a rule has no date in are walked past, so a rule with no date in any
 * of them needs this to stop.
 */
const MAX_RECURRENCE_PERIODS = 10_000;

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

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Whole local days between two dates.
 *
 * Both ends are normalised to midnight first. Subtracting raw timestamps would
 * measure from the anchor's wall-clock time, so a 10:00 event compared against
 * its own midnight came out as -1 day: the first occurrence was dropped and
 * every later one landed a day late. Rounding rather than flooring also keeps
 * the 23- and 25-hour days around a DST change on whole-day boundaries.
 */
function dayDeltaBetween(date: Date, anchor: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(anchor).getTime()) / 86400000);
}

type RecurrencePeriod = {
  start: Date;
  dates: Date[];
};

function ruleWeekdays(anchor: Date, rule: RecurrenceRule): number[] {
  const named = rule.weekdays?.length ? rule.weekdays : [anchor.getDay()];
  return [...new Set(named)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
}

/**
 * The `index`th period of the rule, counted from the one holding the anchor.
 *
 * `dates` is empty for a period the rule cannot land in, such as the 31st in a
 * short month, a fifth weekday the month does not have, or a leap day in a
 * common year, so `start` is what bounds the walk across those.
 */
function periodOf(anchor: Date, rule: RecurrenceRule, index: number): RecurrencePeriod {
  const offset = index * Math.max(1, rule.interval ?? 1);
  if (rule.frequency === "daily") {
    const date = new Date(anchor);
    date.setDate(date.getDate() + offset);
    return { start: date, dates: [date] };
  }
  if (rule.frequency === "weekly") {
    const start = new Date(anchor);
    start.setDate(start.getDate() + offset * 7);
    const dates = ruleWeekdays(anchor, rule).map((weekday) => {
      const date = new Date(start);
      date.setDate(date.getDate() + ((weekday - start.getDay() + 7) % 7));
      return date;
    });
    return { start, dates: dates.sort((a, b) => a.getTime() - b.getTime()) };
  }
  if (rule.frequency === "monthly") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
    let date: Date | null;
    if (rule.nthWeekday) {
      date = nthWeekdayDate(start.getFullYear(), start.getMonth(), rule.nthWeekday.ordinal, rule.nthWeekday.weekday);
    } else {
      const day = rule.dayOfMonth ?? anchor.getDate();
      const candidate = dateAt(start.getFullYear(), start.getMonth(), day);
      date = candidate.getDate() === day ? candidate : null;
    }
    // The anchor's own period runs from the anchor, not from the 1st.
    return { start, dates: date && date >= anchor ? [date] : [] };
  }
  const year = anchor.getFullYear() + offset;
  const date = dateAt(year, anchor.getMonth(), anchor.getDate());
  return { start: new Date(year, 0, 1), dates: date.getDate() === anchor.getDate() ? [date] : [] };
}

/**
 * The last period starting at or before `from`.
 *
 * A period starts no later than any of its own dates, so beginning the walk
 * here cannot step over an occurrence inside the window.
 */
function firstPeriodIndex(anchor: Date, rule: RecurrenceRule, from: Date): number {
  if (from <= anchor) return 0;
  const units = rule.frequency === "daily"
    ? dayDeltaBetween(from, anchor)
    : rule.frequency === "weekly"
      ? Math.floor(dayDeltaBetween(from, anchor) / 7)
      : rule.frequency === "monthly"
        ? (from.getFullYear() - anchor.getFullYear()) * 12 + from.getMonth() - anchor.getMonth()
        : from.getFullYear() - anchor.getFullYear();
  return Math.max(0, Math.floor(units / Math.max(1, rule.interval ?? 1)));
}

/** Occurrences in the periods before `index`, which `count` has to include. */
function occurrencesBefore(anchor: Date, rule: RecurrenceRule, index: number): number {
  if (rule.frequency === "daily") return index;
  if (rule.frequency === "weekly") return index * ruleWeekdays(anchor, rule).length;
  let total = 0;
  for (let period = 0; period < index; period += 1) total += periodOf(anchor, rule, period).dates.length;
  return total;
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
    const untilKey = rule.until?.slice(0, 10);
    const anchorDay = startOfDay(anchor);
    const first = firstPeriodIndex(anchorDay, rule, from);
    let occurrenceCount = rule.count ? occurrencesBefore(anchorDay, rule, first) : 0;
    walk: for (let index = first; index < first + MAX_RECURRENCE_PERIODS; index += 1) {
      const period = periodOf(anchorDay, rule, index);
      if (period.start > to) break;
      for (const date of period.dates) {
        if (date > to) break walk;
        if (untilKey && dateKey(date) > untilKey) break walk;
        occurrenceCount += 1;
        if (date >= from && (!rule.count || occurrenceCount <= rule.count)) {
          output.push(sameTime(event, date, timezone));
        }
        if (rule.count && occurrenceCount >= rule.count) break walk;
      }
    }
  }
  return output.filter((event) => {
    const untilKey = event.recurrence?.until?.slice(0, 10);
    return !untilKey || event.occurrenceKey <= untilKey;
  });
}
