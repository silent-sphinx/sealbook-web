import type { CalendarEvent } from "./types";
import { utcToLocalInput } from "./timezone";
import { expandCalendarEvents } from "./recurrence";

export function keyFor(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

export function shiftEndWithStart(previousStart: string, previousEnd: string, nextStart: string, allDay: boolean): string {
  if (!previousEnd) return previousEnd;
  if (allDay) {
    const startDate = new Date(`${previousStart.slice(0, 10)}T00:00:00Z`);
    const endDate = new Date(`${previousEnd.slice(0, 10)}T00:00:00Z`);
    const dayOffset = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
    const nextEnd = new Date(`${nextStart.slice(0, 10)}T00:00:00Z`);
    nextEnd.setUTCDate(nextEnd.getUTCDate() + dayOffset);
    return `${nextEnd.getUTCFullYear()}-${String(nextEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(nextEnd.getUTCDate()).padStart(2, "0")}T23:59`;
  }
  const wallTime = (value: string) => {
    const [datePart, timePart = "00:00"] = value.slice(0, 16).split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    return Date.UTC(year, month - 1, day, hour, minute);
  };
  const duration = wallTime(previousEnd) - wallTime(previousStart);
  if (!Number.isFinite(duration)) return previousEnd;
  const shifted = new Date(wallTime(nextStart) + duration);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}T${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

export type EventSpan = {
  startKey: string;
  endKey: string;
  bar: boolean;
  timeLabel: string | null;
};

function previousDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return keyFor(new Date(year, month - 1, day - 1));
}

export function computeSpan(event: CalendarEvent, fallbackTimezone: string): EventSpan {
  if (!event.start.includes("T")) {
    const startKey = event.start.slice(0, 10);
    const rawEnd = event.end?.slice(0, 10) || startKey;
    return { startKey, endKey: rawEnd < startKey ? startKey : rawEnd, bar: true, timeLabel: null };
  }

  const tz = event.timezone ?? fallbackTimezone;
  const startLocal = utcToLocalInput(event.start, tz);
  const startKey = startLocal.slice(0, 10);
  let endKey = startKey;
  if (event.end?.includes("T")) {
    const endLocal = utcToLocalInput(event.end, tz);
    endKey = endLocal.slice(0, 10);
    if (endKey > startKey && endLocal.slice(11, 16) === "00:00") {
      endKey = previousDayKey(endKey);
    }
  }
  if (endKey < startKey) endKey = startKey;

  const [year, month, day] = startKey.split("-").map(Number);
  const [hour, minute] = startLocal.slice(11, 16).split(":").map(Number);
  const timeLabel = new Date(year, month - 1, day, hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { startKey, endKey, bar: endKey > startKey, timeLabel };
}

export function spanCoversDay(span: EventSpan, day: Date): boolean {
  const dayKey = keyFor(day);
  return dayKey >= span.startKey && dayKey <= span.endKey;
}

/** `Date.getDay()` of the day a calendar week opens on: 0 Sunday, 1 Monday. */
export type WeekStart = 0 | 1;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday column headings, opening on `weekStart`. */
export function weekdayLabels(weekStart: WeekStart, length: "short" | "narrow" = "short"): string[] {
  const labels = [...WEEKDAY_SHORT.slice(weekStart), ...WEEKDAY_SHORT.slice(0, weekStart)];
  return length === "narrow" ? labels.map((label) => label[0]) : labels;
}

/** How far `day` sits into a week that opens on `weekStart`. */
export function weekdayIndex(day: Date, weekStart: WeekStart): number {
  return (day.getDay() - weekStart + 7) % 7;
}

export function monthDays(month: Date, weekStart: WeekStart = 0): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - weekdayIndex(first, weekStart));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function weekDays(day: Date, weekStart: WeekStart = 0): Date[] {
  const start = new Date(day);
  start.setDate(day.getDate() - weekdayIndex(day, weekStart));
  return Array.from({ length: 7 }, (_, index) => {
    const entry = new Date(start);
    entry.setDate(start.getDate() + index);
    return entry;
  });
}

export function shiftDays(day: Date, delta: number): Date {
  const next = new Date(day);
  next.setDate(day.getDate() + delta);
  return next;
}

export function formatWeekRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString([], sameMonth
    ? { day: "numeric" }
    : sameYear
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" });
  const endLabel = end.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return keyFor(a) === keyFor(b);
}

export const HOUR_HEIGHT = 48;
export const DAY_MINUTES = 24 * 60;

export function minutesOf(localInput: string): number {
  const [hour, minute] = localInput.slice(11, 16).split(":").map(Number);
  return hour * 60 + minute;
}

export function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
}

export function occurrencesIn(
  events: CalendarEvent[],
  from: Date,
  to: Date,
  maxSpanDays: number,
  fallbackTimezone: string,
): { visibleEvents: CalendarEvent[]; spans: Map<string, EventSpan> } {
  const occurrences = expandCalendarEvents(events, shiftDays(from, -maxSpanDays), to, fallbackTimezone);
  const spans = new Map(occurrences.map((event) => [event.id, computeSpan(event, fallbackTimezone)] as const));
  const fromKey = keyFor(from);
  const toKey = keyFor(to);
  const visibleEvents = occurrences.filter((event) => {
    const span = spans.get(event.id);
    return span !== undefined && span.endKey >= fromKey && span.startKey <= toKey;
  });
  return { visibleEvents, spans };
}

export type TimedBlock = {
  event: CalendarEvent;
  startMinutes: number;
  endMinutes: number;
  lane: number;
  lanes: number;
};

export function timedEventsForDay(
  events: CalendarEvent[],
  spans: Map<string, EventSpan>,
  day: Date,
  fallbackTimezone: string,
): TimedBlock[] {
  const dayKey = keyFor(day);
  const blocks = events
    .filter((event) => {
      const span = spans.get(event.id);
      return span !== undefined && !span.bar && span.startKey === dayKey;
    })
    .map((event) => {
      const tz = event.timezone ?? fallbackTimezone;
      const startMinutes = minutesOf(utcToLocalInput(event.start, tz));
      let endMinutes = startMinutes + 60;
      if (event.end?.includes("T")) {
        endMinutes = minutesOf(utcToLocalInput(event.end, tz));
      }
      if (endMinutes <= startMinutes) endMinutes = startMinutes + 30;
      return { event, startMinutes, endMinutes: Math.min(endMinutes, DAY_MINUTES), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);

  const laid: TimedBlock[] = [];
  let cluster: TimedBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const block of cluster) {
      let lane = laneEnds.findIndex((end) => end <= block.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(block.endMinutes);
      } else {
        laneEnds[lane] = block.endMinutes;
      }
      block.lane = lane;
    }
    for (const block of cluster) laid.push({ ...block, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const block of blocks) {
    if (cluster.length > 0 && block.startMinutes >= clusterEnd) flush();
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMinutes);
  }
  flush();
  return laid;
}

export function buildDaySlots(days: Date[], events: CalendarEvent[], spans: Map<string, EventSpan>): Map<string, (CalendarEvent | null)[]> {
  const map = new Map<string, (CalendarEvent | null)[]>();
  const activeSlots: (CalendarEvent | null)[] = [];

  for (const day of days) {
    const dayKey = keyFor(day);
    const dayEvents = events
      .filter((event) => {
        const span = spans.get(event.id);
        return span ? spanCoversDay(span, day) : false;
      })
      .sort((a, b) => Number(spans.get(b.id)?.bar ?? false) - Number(spans.get(a.id)?.bar ?? false));

    for (let index = 0; index < activeSlots.length; index += 1) {
      if (activeSlots[index] && !dayEvents.some((event) => event.id === activeSlots[index]!.id)) {
        activeSlots[index] = null;
      }
    }

    for (const event of dayEvents) {
      if (!activeSlots.some((slot) => slot && slot.id === event.id)) {
        let placed = false;
        for (let index = 0; index < activeSlots.length; index += 1) {
          if (!activeSlots[index]) {
            activeSlots[index] = event;
            placed = true;
            break;
          }
        }
        if (!placed) activeSlots.push(event);
      }
    }

    while (activeSlots.length > 0 && activeSlots[activeSlots.length - 1] === null) {
      activeSlots.pop();
    }

    map.set(dayKey, [...activeSlots]);
  }
  return map;
}