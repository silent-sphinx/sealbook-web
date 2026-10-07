import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  deleteCalendarEvent,
  deleteCalendar,
  putCalendar,
  putCalendarEvent,
  type Session,
} from "../lib/client";
import type { Calendar, CalendarEvent, RecurrenceRule } from "../lib/types";
import { DEFAULT_CALENDAR_COLOR } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarDrawer, type Sidebar } from "./SidebarDrawer";
import { Modal } from "./Modal";
import { localInputToUtc, utcToLocalInput } from "../lib/timezone";
import { btnDanger, btnPrimary, field, focusRing } from "../lib/styles";
import { expandCalendarEvents } from "../lib/recurrence";

type ViewMode = "day" | "week" | "month" | "year";
type RepeatChoice = "none" | "daily" | "weekday" | "weekly" | "monthly-date" | "monthly-nth" | "yearly" | "custom";
type RepeatEnd = "never" | "count" | "date";

const DEFAULT_REPEAT_COUNT = 10;

function hiddenCalendarStorageKey(collectionId: string): string {
  return `sealbook.hidden-calendars.${collectionId}`;
}

function loadHiddenCalendarIds(collectionId: string): Set<string> {
  try {
    const stored = sessionStorage.getItem(hiddenCalendarStorageKey(collectionId));
    const ids = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function keyFor(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function shiftEndWithStart(previousStart: string, previousEnd: string, nextStart: string, allDay: boolean): string {
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

/**
 * Where an event sits on the calendar, in local calendar days.
 * `bar` is true for all-day events and for timed events that span more than
 * one day; those render as a solid multi-day line instead of "time + title".
 */
type EventSpan = {
  startKey: string;
  endKey: string;
  bar: boolean;
  timeLabel: string | null;
};

function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return keyFor(new Date(y, m - 1, d - 1));
}

function computeSpan(event: CalendarEvent, fallbackTimezone: string): EventSpan {
  // All-day events store plain dates; the end date is inclusive.
  if (!event.start.includes("T")) {
    const startKey = event.start.slice(0, 10);
    const rawEnd = event.end?.slice(0, 10) || startKey;
    return { startKey, endKey: rawEnd < startKey ? startKey : rawEnd, bar: true, timeLabel: null };
  }

  // Timed events are stored in UTC; work out their local calendar days
  // the same way the edit dialog does.
  const tz = event.timezone ?? fallbackTimezone;
  const startLocal = utcToLocalInput(event.start, tz);
  const startKey = startLocal.slice(0, 10);
  let endKey = startKey;
  if (event.end?.includes("T")) {
    const endLocal = utcToLocalInput(event.end, tz);
    endKey = endLocal.slice(0, 10);
    // An event ending exactly at midnight does not occupy the new day.
    if (endKey > startKey && endLocal.slice(11, 16) === "00:00") {
      endKey = previousDayKey(endKey);
    }
  }
  if (endKey < startKey) endKey = startKey;

  const [y, mo, d] = startKey.split("-").map(Number);
  const [h, mi] = startLocal.slice(11, 16).split(":").map(Number);
  const timeLabel = new Date(y, mo - 1, d, h, mi).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return { startKey, endKey, bar: endKey > startKey, timeLabel };
}

function spanCoversDay(span: EventSpan, day: Date): boolean {
  const dayKey = keyFor(day);
  return dayKey >= span.startKey && dayKey <= span.endKey;
}

function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The Sunday-to-Saturday week containing `day`, matching the month grid's week start. */
function weekDays(day: Date): Date[] {
  const start = new Date(day);
  start.setDate(day.getDate() - day.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const entry = new Date(start);
    entry.setDate(start.getDate() + index);
    return entry;
  });
}

function shiftDays(day: Date, delta: number): Date {
  const next = new Date(day);
  next.setDate(day.getDate() + delta);
  return next;
}

/** "5 – 11 October 2026", collapsing the parts the two ends share. */
function formatWeekRange(start: Date, end: Date): string {
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

function sameDay(a: Date, b: Date): boolean {
  return keyFor(a) === keyFor(b);
}

/** Row height of one hour in the day and week timelines, in pixels. */
const HOUR_HEIGHT = 48;
const DAY_MINUTES = 24 * 60;

function minutesOf(localInput: string): number {
  const [hour, minute] = localInput.slice(11, 16).split(":").map(Number);
  return hour * 60 + minute;
}

function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
}

/**
 * Occurrences overlapping [from, to], with their spans. The search window is
 * padded backwards by `maxSpanDays` because expandCalendarEvents only yields
 * occurrences that start inside it, which would otherwise drop an event that
 * was already under way when the window opened.
 */
function occurrencesIn(
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

type TimedBlock = {
  event: CalendarEvent;
  startMinutes: number;
  endMinutes: number;
  lane: number;
  lanes: number;
};

/**
 * Timed, single-day events for one column of the day/week timeline, with their
 * local start and end in minutes past midnight. Events that render as bars
 * (all-day, or spanning more than one day) belong in the all-day strip instead.
 */
function timedEventsForDay(
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
      // A zero-length or inverted event still needs a clickable height.
      if (endMinutes <= startMinutes) endMinutes = startMinutes + 30;
      return { event, startMinutes, endMinutes: Math.min(endMinutes, DAY_MINUTES), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);

  // Events that overlap in time share the column width. Each run of mutually
  // overlapping events is packed into the fewest lanes that keep them apart,
  // and every event in that run is drawn at the same width.
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

/**
 * Packs multi-day and all-day events into stable rows across a run of days, so
 * a bar keeps the same row for its whole length. Shared by the month grid and
 * the all-day strip above the week and day timelines.
 */
function buildDaySlots(days: Date[], events: CalendarEvent[], spans: Map<string, EventSpan>): Map<string, (CalendarEvent | null)[]> {
  const map = new Map<string, (CalendarEvent | null)[]>();
  const activeSlots: (CalendarEvent | null)[] = [];

  for (const day of days) {
    const dayKey = keyFor(day);
    // Bars sort ahead of single-day timed events so they claim the top slots.
    // Array.sort is stable, so the existing order is kept otherwise.
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

function Icon({ name, className = "h-4 w-4" }: { name: "plus" | "search" | "chevron" | "pencil" | "star" | "x"; className?: string }) {
  const content = {
    plus: <path d="M8 2.5v11M2.5 8h11" />,
    search: <><circle cx="6.5" cy="6.5" r="4" /><path d="m10 10 3.5 3.5" /></>,
    chevron: <path d="m6.5 3.5 5 5-5 5" />,
    x: <path d="m4 4 8 8M12 4l-8 8" />,
    pencil: <><path d="m10.75 2.75 2.5 2.5M3 13l1.5-3.75 6.25-6.25a1.77 1.77 0 0 1 2.5 2.5L7 11.75 3 13Z" /></>,
    star: <path d="m8 1.75 1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62L8 1.75Z" fill="currentColor" />,
  }[name];
  const resolvedClassName = name === "search"
    ? `${className} pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute`
    : className;
  return <svg className={resolvedClassName} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{content}</svg>;
}

export function CalendarView({
  session,
  calendars,
  events,
  busy,
  timezone,
  onRefresh,
  readOnly,
  sidebar,
}: {
  session: Session;
  calendars: Calendar[];
  events: CalendarEvent[];
  busy: boolean;
  timezone: string;
  onRefresh: () => Promise<void>;
  readOnly?: boolean;
  /** Shared with the rest of the shell; the header owns the control. */
  sidebar: Sidebar;
}) {
  const today = new Date();
  const todayKey = keyFor(today);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);
  const [mode, setMode] = useState<ViewMode>("month");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
  const [calendarComposer, setCalendarComposer] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null);
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(() => loadHiddenCalendarIds(session.state.collection_id));
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [calendarName, setCalendarName] = useState("");
  const [calendarColor, setCalendarColor] = useState(DEFAULT_CALENDAR_COLOR);
  const [eventCalendarId, setEventCalendarId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(`${todayKey}T09:00`);
  const [end, setEnd] = useState(`${todayKey}T10:00`);
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState("");
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>("none");
  const [customFrequency, setCustomFrequency] = useState<"daily" | "weekly" | "monthly" | "yearly">("weekly");
  const [customInterval, setCustomInterval] = useState(1);
  const [repeatEnd, setRepeatEnd] = useState<RepeatEnd>("never");
  const [repeatCount, setRepeatCount] = useState(DEFAULT_REPEAT_COUNT);
  const [repeatUntil, setRepeatUntil] = useState("");
  const [deletingCalendar, setDeletingCalendar] = useState(false);
  const [confirmDeleteCalendar, setConfirmDeleteCalendar] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  // Minutes past midnight, for the "now" rule on today's timeline column.
  const [nowMinutes, setNowMinutes] = useState(() => today.getHours() * 60 + today.getMinutes());
  const readOnlyMode = readOnly === true;

  useEffect(() => {
    const tick = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(tick);
  }, []);
  const days = useMemo(() => monthDays(month), [month]);
  const filtered = useMemo(
    () => events
      .filter((event) => !event.calendarId || calendars.some((calendar) => calendar.id === event.calendarId))
      .filter((event) => !event.calendarId || !hiddenCalendarIds.has(event.calendarId))
      .sort((a, b) => {
        const aStart = a.start;
        const bStart = b.start;
        if (aStart !== bStart) return aStart.localeCompare(bStart);
        const aEnd = a.end || a.start;
        const bEnd = b.end || b.start;
        return bEnd.localeCompare(aEnd);
      }),
    [calendars, events, hiddenCalendarIds],
  );
  const selectedDate = useMemo(() => dateFromKey(selected), [selected]);
  const week = useMemo(() => weekDays(selectedDate), [selectedDate]);
  const yearMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => new Date(month.getFullYear(), index, 1)),
    [month],
  );

  // Each mode expands recurrences over just the window it draws, so the year
  // view does not pay for a month view and vice versa.
  const [rangeStart, rangeEnd] = useMemo((): [Date, Date] => {
    if (mode === "day") return [selectedDate, selectedDate];
    if (mode === "week") return [week[0], week[6]];
    if (mode === "year") return [new Date(month.getFullYear(), 0, 1), new Date(month.getFullYear(), 11, 31)];
    return [days[0], days[days.length - 1]];
  }, [days, mode, month, selectedDate, week]);

  // expandCalendarEvents only yields occurrences that *start* inside the window,
  // so an event already under way when the window opens would be missed. Asking
  // for a window padded by the longest event, then keeping whatever overlaps,
  // covers that without widening the search further than it needs to go.
  const maxSpanDays = useMemo(
    () => filtered.reduce((longest, event) => {
      const from = Date.parse(`${event.start.slice(0, 10)}T00:00:00Z`);
      const to = Date.parse(`${(event.end ?? event.start).slice(0, 10)}T00:00:00Z`);
      const days = Math.round((to - from) / 86400000);
      return Number.isFinite(days) && days > longest ? days : longest;
    }, 0),
    [filtered],
  );

  const { visibleEvents, spans } = useMemo(
    () => occurrencesIn(filtered, rangeStart, rangeEnd, maxSpanDays, timezone),
    [filtered, maxSpanDays, rangeEnd, rangeStart, timezone],
  );

  // The sidebar mini-month always shows its own month, independent of the mode
  // the main area is in, so it needs occurrences expanded over that window.
  const { visibleEvents: miniEvents, spans: miniSpans } = useMemo(
    () => occurrencesIn(filtered, days[0], days[days.length - 1], maxSpanDays, timezone),
    [days, filtered, maxSpanDays, timezone],
  );

  const heading = mode === "year"
    ? String(month.getFullYear())
    : mode === "day"
      ? selectedDate.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : mode === "week"
        ? formatWeekRange(week[0], week[6])
        : month.toLocaleDateString([], { month: "long", year: "numeric" });

  /** Steps the view by one of whatever it is currently showing. */
  function shiftView(direction: 1 | -1) {
    if (mode === "month") {
      setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1));
      return;
    }
    if (mode === "year") {
      setMonth(new Date(month.getFullYear() + direction, month.getMonth(), 1));
      return;
    }
    selectDay(shiftDays(selectedDate, direction * (mode === "week" ? 7 : 1)));
  }

  const searchResults = useMemo(
    () => searchEvents(events, calendars, search, today, timezone),
    // `today` is recreated each render but only its date matters, so the key
    // stands in for it to avoid recomputing the whole search every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendars, events, search, timezone, todayKey],
  );

  /**
   * Opens a search result: moves the calendar to the day it falls on, so
   * closing the dialog leaves you looking at the right place.
   */
  function revealEvent(result: SearchResult) {
    selectDay(result.date);
    if (!readOnlyMode) openEditTask(result.event);
  }

  /** Drill down from the year view into a single day. */
  function openDay(day: Date) {
    selectDay(day);
    setMode("day");
  }

  /**
   * Recurring events are drawn as generated occurrences whose ids are the base
   * id plus a suffix; editing one has to reach back to the stored event.
   */
  const editOccurrence = readOnlyMode
    ? () => undefined
    : (event: CalendarEvent) =>
      openEditTask(events.find((source) => event.id === source.id || event.id.startsWith(`${source.id}:`)) ?? event);

  function toggleCalendar(calendarId: string) {
    setHiddenCalendarIds((current) => {
      const next = new Set(current);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      try {
        sessionStorage.setItem(hiddenCalendarStorageKey(session.state.collection_id), JSON.stringify([...next]));
      } catch {
      }
      return next;
    });
  }

  function showAllCalendars() {
    setHiddenCalendarIds(new Set());
    try {
      sessionStorage.setItem(hiddenCalendarStorageKey(session.state.collection_id), "[]");
    } catch {
    }
  }

  function openNewCalendar() {
    setEditingCalendar(null);
    setCalendarName("");
    setCalendarColor(DEFAULT_CALENDAR_COLOR);
    setError(null);
    setCalendarComposer(true);
  }

  function openEditCalendar(calendar: Calendar) {
    setEditingCalendar(calendar);
    setCalendarName(calendar.name);
    setCalendarColor(calendar.color);
    setError(null);
    setCalendarComposer(true);
  }

  function selectDay(day: Date) {
    const key = keyFor(day);
    setSelected(key);
    setStart(`${key}T09:00`);
    setEnd(`${key}T10:00`);
    if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }

  /** `hour` comes from clicking an empty slot in the day or week timeline. */
  function openNewTask(day?: Date, hour?: number) {
    const dayKey = day ? keyFor(day) : todayKey;
    if (day) selectDay(day);
    setEditingEvent(null);
    setTitle("");
    setNotes("");
    setLocation("");
    setParticipants("");
    setAllDay(false);
    setEventCalendarId(calendars[0]?.id ?? "");
    const startHour = hour === undefined ? 9 : Math.min(23, Math.max(0, hour));
    setStart(`${dayKey}T${String(startHour).padStart(2, "0")}:00`);
    // The last hour of the day ends at 23:59 rather than rolling past midnight.
    setEnd(`${dayKey}T${startHour === 23 ? "23:59" : `${String(startHour + 1).padStart(2, "0")}:00`}`);
    setRepeatChoice("none");
    setCustomFrequency("weekly");
    setCustomInterval(1);
    setRepeatEnd("never");
    setRepeatCount(DEFAULT_REPEAT_COUNT);
    setRepeatUntil("");
    setError(null);
    setComposer(true);
  }

  function openEditTask(event: CalendarEvent) {
    setEditingEvent(event);
    setTitle(event.title);
    setStart(event.start.includes("T") ? utcToLocalInput(event.start, event.timezone ?? timezone) : event.start);
    setEnd(event.end?.includes("T") ? utcToLocalInput(event.end, event.timezone ?? timezone) : event.end ?? "");
    setAllDay(!event.start.includes("T"));
    setNotes(event.notes ?? "");
    setLocation(event.location ?? "");
    setParticipants(event.participants?.join(", ") ?? "");
    setEventCalendarId(event.calendarId ?? calendars[0]?.id ?? "");
    const rule = event.recurrence;
    if (!rule) {
      setRepeatChoice("none");
    } else if (rule.frequency === "daily" && (rule.interval ?? 1) === 1) {
      setRepeatChoice("daily");
    } else if (rule.frequency === "weekly" && rule.weekdays?.length === 5 && rule.weekdays.every((day, index) => day === index + 1)) {
      setRepeatChoice("weekday");
    } else if (rule.frequency === "weekly" && (rule.interval ?? 1) === 1) {
      setRepeatChoice("weekly");
    } else if (rule.frequency === "monthly" && rule.nthWeekday) {
      setRepeatChoice("monthly-nth");
    } else if (rule.frequency === "monthly") {
      setRepeatChoice("monthly-date");
    } else if (rule.frequency === "yearly" && (rule.interval ?? 1) === 1) {
      setRepeatChoice("yearly");
    } else {
      setRepeatChoice("custom");
      setCustomFrequency(rule.frequency);
      setCustomInterval(rule.interval ?? 1);
    }
    if (rule?.count) {
      setRepeatEnd("count");
      setRepeatCount(rule.count);
      setRepeatUntil("");
    } else if (rule?.until) {
      setRepeatEnd("date");
      setRepeatCount(DEFAULT_REPEAT_COUNT);
      setRepeatUntil(rule.until.slice(0, 10));
    } else {
      setRepeatEnd("never");
      setRepeatCount(DEFAULT_REPEAT_COUNT);
      setRepeatUntil("");
    }
    setError(null);
    setComposer(true);
  }

  function closeTaskDialog() {
    setComposer(false);
    setEditingEvent(null);
    setError(null);
  }

  function updateStart(nextStart: string) {
    setEnd((currentEnd) => shiftEndWithStart(start, currentEnd, nextStart, allDay));
    setStart(nextStart);
  }

  async function saveEvent() {
    if (!title.trim() || calendars.length === 0 || !calendars.some((calendar) => calendar.id === eventCalendarId)) return;
    setError(null);
    try {
      const day = start.slice(0, 10);
      const startDate = new Date(`${day}T00:00`);
      const weekday = startDate.getDay();
      const ordinal = Math.ceil(startDate.getDate() / 7) as 1 | 2 | 3 | 4 | 5;
      const pattern = repeatChoice === "none" ? undefined
        : repeatChoice === "daily" ? { frequency: "daily" as const }
          : repeatChoice === "weekday" ? { frequency: "weekly" as const, weekdays: [1, 2, 3, 4, 5] }
            : repeatChoice === "weekly" ? { frequency: "weekly" as const, weekdays: [weekday] }
              : repeatChoice === "monthly-date" ? { frequency: "monthly" as const, dayOfMonth: startDate.getDate() }
                : repeatChoice === "monthly-nth" ? { frequency: "monthly" as const, nthWeekday: { ordinal, weekday } }
                  : repeatChoice === "yearly" ? { frequency: "yearly" as const }
                    : { frequency: customFrequency, interval: Math.max(1, customInterval), ...(customFrequency === "weekly" ? { weekdays: [weekday] } : {}) };
      // Both guards keep "On a date" from falling back to repeating forever: a
      // missing date, and one before the first occurrence, which would instead
      // hide the event entirely.
      if (pattern && repeatEnd === "date") {
        if (!repeatUntil) {
          setError("Choose the last date the event should repeat on.");
          return;
        }
        if (repeatUntil < day) {
          setError("The repeat end date cannot be before the event start date.");
          return;
        }
      }
      const recurrence: RecurrenceRule | undefined = !pattern ? undefined
        : repeatEnd === "count" ? { ...pattern, count: Math.max(1, Math.round(repeatCount) || 1) }
          : repeatEnd === "date" ? { ...pattern, until: repeatUntil }
            : pattern;
      await putCalendarEvent(
        session,
        {
          title: title.trim(),
          start: allDay ? day : localInputToUtc(start, timezone),
          end: allDay ? end.slice(0, 10) || day : end ? localInputToUtc(end, timezone) : undefined,
          notes: notes.trim() || undefined,
          location: location.trim() || undefined,
          participants: participants.split(",").map((participant) => participant.trim()).filter(Boolean),
          timezone: allDay ? timezone : timezone,
          calendarId: eventCalendarId || undefined,
          recurrence,
        },
        editingEvent?.id,
      );
      closeTaskDialog();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeEvent() {
    if (!editingEvent) return;
    setError(null);
    try {
      await deleteCalendarEvent(session, editingEvent.id);
      closeTaskDialog();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveCalendar() {
    if (!calendarName.trim()) return;
    setError(null);
    try {
      await putCalendar(session, { name: calendarName.trim(), color: calendarColor, favorite: editingCalendar?.favorite ?? false }, editingCalendar?.id);
      setCalendarName("");
      setCalendarColor(DEFAULT_CALENDAR_COLOR);
      setEditingCalendar(null);
      setCalendarComposer(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleFavorite(calendar: Calendar) {
    setError(null);
    try {
      await putCalendar(session, { name: calendar.name, color: calendar.color, favorite: !calendar.favorite }, calendar.id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeCalendar() {
    if (!editingCalendar) return;
    setConfirmDeleteCalendar(false);
    setError(null);
    setDeletingCalendar(true);
    const calendarEvents = events.filter((item) => item.calendarId === editingCalendar.id);
    setDeleteProgress({ current: 0, total: calendarEvents.length + 1 });
    try {
      const calendarId = editingCalendar.id;
      for (let index = 0; index < calendarEvents.length; index += 1) {
        const event = calendarEvents[index];
        await deleteCalendarEvent(session, event.id);
        setDeleteProgress({ current: index + 1, total: calendarEvents.length + 1 });
      }
      await deleteCalendar(session, calendarId);
      setDeleteProgress({ current: calendarEvents.length + 1, total: calendarEvents.length + 1 });
      setEditingCalendar(null);
      setCalendarComposer(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingCalendar(false);
      setDeleteProgress({ current: 0, total: 0 });
    }
  }

  return (
    // Full-bleed: the month grid uses the whole viewport width rather than
    // sitting in a card. The sidebar keeps a translucent panel fill so it still
    // separates from the grid without reintroducing an opaque chrome column.
    <main className="flex flex-col bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:h-[calc(100dvh-var(--sb-header-h,74px))] lg:overflow-hidden lg:pb-0">
      <div className="sb-shell grid min-h-0 flex-1 lg:h-full" style={sidebar.cols("244px")}>
        <SidebarDrawer title="Calendars" sidebar={sidebar}>
          <div className="flex items-center justify-between">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">My calendar</p><h2 className="mt-1 text-lg font-semibold">Calendar</h2></div>
            {!readOnlyMode ? <button type="button" onClick={() => openNewTask()} className={`flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-text transition-colors hover:border-line-light hover:bg-elevated ${focusRing}`} aria-label="Create event"><Icon name="plus" /></button> : null}
          </div>
          <MiniMonth month={month} selected={selected} events={miniEvents} spans={miniSpans} onSelect={(day) => { selectDay(day); sidebar.close(); }} />
          <div className="mt-8 border-t border-line pt-5">
            <div className="flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">Calendars</p>{!readOnlyMode ? <button type="button" onClick={openNewCalendar} className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`} aria-label="Add calendar"><Icon name="plus" /></button> : null}</div>
            <CalendarList calendars={calendars} hiddenCalendarIds={hiddenCalendarIds} readOnly={readOnlyMode} onToggle={toggleCalendar} onShowAll={showAllCalendars} onToggleFavorite={(calendar) => void toggleFavorite(calendar)} onEdit={openEditCalendar} onCreate={openNewCalendar} />
          </div>
        </SidebarDrawer>

        <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
          <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-4 lg:px-6 lg:py-3.5">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={() => shiftView(-1)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-mute transition-colors hover:border-line-light hover:bg-surface hover:text-text ${focusRing}`} aria-label={`Previous ${mode}`}><Icon name="chevron" className="h-3.5 w-3.5 rotate-180" /></button>
              <button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today); }} className={`h-8 shrink-0 rounded-lg border border-line px-3 text-xs font-medium text-mute transition-colors hover:border-line-light hover:bg-surface hover:text-text sm:px-3.5 ${focusRing}`}>Today</button>
              <button type="button" onClick={() => shiftView(1)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-mute transition-colors hover:border-line-light hover:bg-surface hover:text-text ${focusRing}`} aria-label={`Next ${mode}`}><Icon name="chevron" className="h-3.5 w-3.5" /></button>
              <h1 className="ml-1 min-w-0 truncate text-base font-semibold tracking-tight sm:ml-3">{heading}</h1>
              <span className="ml-1 shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute" title={`${visibleEvents.length} event${visibleEvents.length === 1 ? "" : "s"} in view`}>{visibleEvents.length}</span>
            </div>
            <div className="flex items-center gap-2.5">
              {!readOnlyMode ? <button type="button" onClick={() => openNewTask()} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] sm:px-3.5 ${focusRing}`}><Icon name="plus" className="h-3.5 w-3.5" /><span className="hidden sm:inline">New event</span><span className="sm:hidden">New</span></button> : null}
              <EventSearch query={search} results={searchResults} onQueryChange={setSearch} onPick={revealEvent} />
              <div className="flex shrink-0 rounded-xl border border-line bg-surface/40 p-1">{(["day", "week", "month", "year"] as ViewMode[]).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`h-6 rounded-lg px-2 text-[11px] capitalize transition-colors sm:px-2.5 ${mode === item ? "bg-surface font-medium text-text" : "text-mute hover:text-text"} ${focusRing}`}>{item}</button>)}</div>
            </div>
          </header>
          {mode === "month" ? (
            <MonthGrid month={month} days={days} selected={selected} todayKey={todayKey} events={visibleEvents} spans={spans} calendars={calendars} onSelect={selectDay} onAdd={readOnlyMode ? () => undefined : (day) => openNewTask(day)} onEdit={editOccurrence} />
          ) : mode === "day" ? (
            <DayView day={selectedDate} events={visibleEvents} spans={spans} calendars={calendars} timezone={timezone} todayKey={todayKey} nowMinutes={nowMinutes} onAdd={readOnlyMode ? () => undefined : openNewTask} onEdit={editOccurrence} />
          ) : mode === "week" ? (
            <WeekView days={week} selected={selected} todayKey={todayKey} events={visibleEvents} spans={spans} calendars={calendars} timezone={timezone} nowMinutes={nowMinutes} onSelect={selectDay} onAdd={readOnlyMode ? () => undefined : openNewTask} onEdit={editOccurrence} />
          ) : (
            <YearView months={yearMonths} today={today} selected={selected} events={visibleEvents} spans={spans} onOpenDay={openDay} />
          )}
        </section>
      </div>

      {composer ? <TaskDialog editing={editingEvent !== null} title={title} start={start} end={end} notes={notes} location={location} participants={participants} allDay={allDay} calendarId={eventCalendarId} calendars={calendars} repeatChoice={repeatChoice} customFrequency={customFrequency} customInterval={customInterval} repeatEnd={repeatEnd} repeatCount={repeatCount} repeatUntil={repeatUntil} minRepeatUntil={start.slice(0, 10)} busy={busy} error={error} onClose={closeTaskDialog} onSave={() => void saveEvent()} onDelete={editingEvent ? () => void removeEvent() : undefined} onTitleChange={setTitle} onStartChange={updateStart} onEndChange={setEnd} onNotesChange={setNotes} onLocationChange={setLocation} onParticipantsChange={setParticipants} onAllDayChange={setAllDay} onCalendarChange={setEventCalendarId} onRepeatChange={setRepeatChoice} onCustomFrequencyChange={setCustomFrequency} onCustomIntervalChange={setCustomInterval} onRepeatEndChange={setRepeatEnd} onRepeatCountChange={setRepeatCount} onRepeatUntilChange={setRepeatUntil} /> : null}
      {calendarComposer ? <CalendarDialog editing={editingCalendar !== null} name={calendarName} color={calendarColor} busy={busy} error={error} onClose={() => { setCalendarComposer(false); setEditingCalendar(null); }} onSave={() => void saveCalendar()} onDelete={editingCalendar ? () => setConfirmDeleteCalendar(true) : undefined} onNameChange={setCalendarName} onColorChange={setCalendarColor} /> : null}
      {confirmDeleteCalendar && editingCalendar ? (
        <ConfirmDialog
          title="Delete calendar"
          heading={`Delete “${editingCalendar.name}”?`}
          body={(() => {
            const count = events.filter((item) => item.calendarId === editingCalendar.id).length;
            return count === 0
              ? "This calendar will be permanently removed from your encrypted vault across all paired devices. This cannot be undone."
              : `This permanently deletes the calendar and its ${count} event${count === 1 ? "" : "s"} from your encrypted vault across all paired devices. This cannot be undone.`;
          })()}
          confirmLabel="Delete calendar"
          onConfirm={() => void removeCalendar()}
          onClose={() => setConfirmDeleteCalendar(false)}
        />
      ) : null}
      {deletingCalendar ? <ImportProgressModal title="Deleting calendar" description="Removing events and calendar data. Keep this window open." current={deleteProgress.current} total={deleteProgress.total} /> : null}
    </main>
  );
}

function eventSegmentClass(span: EventSpan, day: Date): string {
  // Single-day timed events: dot + time + title, no solid bar.
  if (!span.bar) {
    return "relative z-10 block h-4 truncate rounded px-1 text-[11px] font-medium leading-4 text-text transition-colors hover:bg-surface";
  }
  const dayKey = keyFor(day);
  const startsHere = span.startKey === dayKey;
  const endsHere = span.endKey === dayKey;

  // Cells have 6px padding (p-1.5) plus a 1px right border, so a continuing
  // segment bridges 6px on its left and 7px on its right, with no overlap.
  const left = startsHere ? "rounded-l-md pl-1.5" : "-ml-1.5 rounded-l-none pl-3";
  const right = endsHere ? "rounded-r-md pr-1.5" : "-mr-[7px] rounded-r-none pr-2";

  return `relative z-10 block h-4 truncate text-[11px] font-medium leading-4 transition-colors ${left} ${right}`;
}

/** `#rrggbb` at `alpha`, falling back to the accent token for a malformed colour. */
function tint(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `color-mix(in srgb, var(--color-accent) ${Math.round(alpha * 100)}%, transparent)`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Whether a calendar colour can carry text against the dark cell background.
 * Calendar colours are user-chosen, so a dark one would otherwise render an
 * event title that is effectively invisible; those fall back to `--color-text`.
 */
function isLegibleOnDark(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return true;
  const value = Number.parseInt(match[1], 16);
  const channel = (raw: number) => {
    const scaled = raw / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance > 0.18;
}

/**
 * Multi-day and all-day events render as a tinted band with a coloured edge
 * rather than a saturated block, so a week-long event does not dominate the
 * month the way a solid fill does.
 */
function eventSegmentStyle(span: EventSpan, day: Date, color: string): CSSProperties | undefined {
  if (!span.bar) return undefined;
  const startsHere = span.startKey === keyFor(day);
  return {
    backgroundColor: tint(color, 0.22),
    color: isLegibleOnDark(color) ? color : "var(--color-text)",
    boxShadow: startsHere ? `inset 2px 0 0 ${color}` : undefined,
  };
}

function MonthGrid({ month, days, selected, todayKey, events, spans, calendars, onSelect, onAdd, onEdit }: { month: Date; days: Date[]; selected: string; todayKey: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; onSelect: (day: Date) => void; onAdd: (day: Date) => void; onEdit: (event: CalendarEvent) => void }) {
  const daySlotsMap = useMemo(() => buildDaySlots(days, events, spans), [days, events, spans]);

  return <div className="flex min-w-0 flex-1 flex-col overflow-x-auto"><div className="flex min-w-[720px] flex-1 flex-col"><div className="grid grid-cols-7 border-b border-line bg-panel/40">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => <div key={day} className={`py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] ${i === 0 || i === 6 ? "text-mute/60" : "text-mute"}`}>{day}</div>)}</div><div className="grid flex-1 grid-cols-7 grid-rows-6">{days.map((day) => { const key = keyFor(day); const isWeekend = day.getDay() === 0 || day.getDay() === 6; const isOtherMonth = day.getMonth() !== month.getMonth(); const isToday = key === todayKey; const isSelected = key === selected; const slots = daySlotsMap.get(key) || []; return <button key={key} type="button" onClick={() => onSelect(day)} onDoubleClick={() => onAdd(day)} className={`cal-cell relative flex min-h-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left transition-colors ${isOtherMonth ? "bg-panel/40 text-mute/30" : isWeekend ? "bg-panel/60 text-text/70" : "bg-bg text-text"} ${isToday ? "cal-today" : ""} ${isSelected ? "z-10 ring-1 ring-inset ring-accent/60" : "hover:bg-surface/30"}`}><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${isToday ? "bg-accent font-semibold text-bg" : ""}`}>{day.getDate()}</span><span className="mt-0.5 block space-y-0.5">{slots.slice(0, 4).map((event, slotIndex) => { if (!event) return <span key={`empty-${slotIndex}`} className="block h-4 w-full" />; const span = spans.get(event.id); if (!span) return <span key={`missing-${slotIndex}`} className="block h-4 w-full" />; const color = calendars.find((calendar) => calendar.id === event.calendarId)?.color; const startsHere = span.startKey === key; const showText = startsHere || day.getDay() === 0 || !span.bar; return <span key={event.id} role="button" tabIndex={0} onClick={(click) => { click.stopPropagation(); onEdit(event); }} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); keyEvent.stopPropagation(); onEdit(event); } }} className={eventSegmentClass(span, day)} style={eventSegmentStyle(span, day, color ?? DEFAULT_CALENDAR_COLOR)}>{!span.bar && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: color ?? DEFAULT_CALENDAR_COLOR }} />}{!span.bar && <span className="mr-1 opacity-60">{span.timeLabel}</span>}{showText ? event.title : "\u00A0"}</span>; })}</span></button>; })}</div></div></div>;
}

/**
 * Opens a timeline on the part of the day people actually use rather than at
 * midnight, re-anchoring when the visible day or week changes but not as the
 * clock ticks, so it never yanks the view out from under a scroll.
 */
function useTimelineScroll(scrollKey: string, targetMinutes: number) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef(targetMinutes);
  target.current = targetMinutes;
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = Math.max(0, (target.current / 60) * HOUR_HEIGHT - HOUR_HEIGHT);
  }, [scrollKey]);
  return ref;
}

/** Earliest timed event across `days`, or 8am when there is nothing to show. */
function firstEventMinutes(days: Date[], events: CalendarEvent[], spans: Map<string, EventSpan>, timezone: string): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const day of days) {
    for (const block of timedEventsForDay(events, spans, day, timezone)) {
      earliest = Math.min(earliest, block.startMinutes);
    }
  }
  return Number.isFinite(earliest) ? earliest : 8 * 60;
}

type SearchResult = {
  /** The stored event, so opening a result edits the real thing. */
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

/** How many matches to resolve dates for, and how many of those to show. */
const SEARCH_SCAN_LIMIT = 80;
const SEARCH_RESULT_LIMIT = 25;

/**
 * Searches every stored event rather than the visible window, so a result can
 * be in a month you are not looking at — that is the point of searching. A
 * recurring event is reported at its next occurrence from today, since its
 * stored start may be years in the past.
 */
function searchEvents(
  events: CalendarEvent[],
  calendars: Calendar[],
  rawQuery: string,
  today: Date,
  fallbackTimezone: string,
): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const horizon = new Date(startOfToday);
  horizon.setFullYear(horizon.getFullYear() + 2);

  const resolved = events
    .filter((event) => matchesQuery(event, query))
    .slice(0, SEARCH_SCAN_LIMIT)
    .map((event): SearchResult => {
      let startValue = event.start;
      if (event.recurrence) {
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
    });

  // Upcoming first, nearest ahead; then past, most recent first. Plain date
  // order would bury what you are most likely looking for under old events.
  return resolved
    .sort((a, b) => {
      const aAhead = a.date >= startOfToday;
      const bAhead = b.date >= startOfToday;
      if (aAhead !== bAhead) return aAhead ? -1 : 1;
      return aAhead ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime();
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}

/**
 * Search box with a results panel. It reveals events rather than filtering the
 * grid, so the calendar underneath never changes while you type.
 */
function EventSearch({ query, results, onQueryChange, onPick }: { query: string; results: SearchResult[]; onQueryChange: (value: string) => void; onPick: (result: SearchResult) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelOpen = open && query.trim().length > 0;

  useEffect(() => setActive(0), [results]);

  useEffect(() => {
    if (!panelOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [panelOpen]);

  function choose(result: SearchResult) {
    setOpen(false);
    onPick(result);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (query) onQueryChange("");
      setOpen(false);
      return;
    }
    if (!panelOpen || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <div ref={boxRef} className="relative hidden sm:block">
      <Icon name="search" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => { onQueryChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search events"
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls="calendar-search-results"
        aria-autocomplete="list"
        className="h-8 w-52 rounded-xl border border-line bg-panel pl-8 pr-7 text-xs text-text outline-none transition-colors duration-150 placeholder:text-mute/60 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
      />
      {query ? (
        <button
          type="button"
          onClick={() => { onQueryChange(""); inputRef.current?.focus(); }}
          aria-label="Clear search"
          className={`absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
        >
          <Icon name="x" className="h-3 w-3" />
        </button>
      ) : null}

      {panelOpen ? (
        <div
          id="calendar-search-results"
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-40 max-h-[60vh] w-[22rem] overflow-y-auto rounded-xl border border-line bg-panel py-1 shadow-2xl shadow-black/50 animate-fade-in-up"
        >
          {results.length === 0 ? (
            <p className="px-3.5 py-5 text-center text-xs text-mute">No events match “{query.trim()}”.</p>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.event.id}-${keyFor(result.date)}`}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(result)}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors ${index === active ? "bg-surface" : ""}`}
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: result.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-text">{result.event.title}</span>
                  <span className="block truncate text-[11px] text-mute">
                    {result.dateLabel}
                    {result.timeLabel ? ` · ${result.timeLabel}` : ""}
                    {result.event.location ? ` · ${result.event.location}` : ""}
                  </span>
                </span>
                {result.calendarName ? <span className="mt-0.5 max-w-[6rem] shrink-0 truncate text-[10px] text-mute/70">{result.calendarName}</span> : null}
              </button>
            ))
          )}
          {results.length >= SEARCH_RESULT_LIMIT ? (
            <p className="border-t border-line px-3.5 py-1.5 text-[10px] text-mute">Showing the first {SEARCH_RESULT_LIMIT} matches.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Colour swatch doubling as the visibility checkbox: filled with a tick when
 * the calendar is showing, a hollow ring in its colour when hidden. Merging the
 * two means the row needs no separate eye button, and the colour — the thing
 * that identifies a calendar on the grid — carries the state.
 */
function CalendarSwatch({ color, hidden }: { color: string; hidden: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors duration-150"
      style={{ borderColor: color, backgroundColor: hidden ? "transparent" : color }}
    >
      {hidden ? null : (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke={isLegibleOnDark(color) ? "var(--color-bg)" : "var(--color-text)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m1.5 5.2 2.2 2.2L8.5 2.6" />
        </svg>
      )}
    </span>
  );
}

function CalendarList({ calendars, hiddenCalendarIds, readOnly, onToggle, onShowAll, onToggleFavorite, onEdit, onCreate }: { calendars: Calendar[]; hiddenCalendarIds: Set<string>; readOnly: boolean; onToggle: (calendarId: string) => void; onShowAll: () => void; onToggleFavorite: (calendar: Calendar) => void; onEdit: (calendar: Calendar) => void; onCreate: () => void }) {
  const ordered = useMemo(
    () => [...calendars].sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true)),
    [calendars],
  );
  const anyHidden = calendars.some((calendar) => hiddenCalendarIds.has(calendar.id));

  if (calendars.length === 0) {
    return readOnly
      ? <p className="mt-3 text-xs text-mute">No calendars yet.</p>
      : (
        <button type="button" onClick={onCreate} className={`mt-3 w-full rounded-lg border border-dashed border-line px-3 py-3 text-xs text-mute transition-colors hover:border-line-light hover:text-text ${focusRing}`}>
          Create your first calendar
        </button>
      );
  }

  return (
    <>
      <div className="mt-2.5 space-y-0.5">
        {ordered.map((calendar) => {
          const hidden = hiddenCalendarIds.has(calendar.id);
          return (
            <div key={calendar.id} className="list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors hover:bg-surface/40">
              <button
                type="button"
                onClick={() => onToggle(calendar.id)}
                aria-pressed={!hidden}
                title={`${hidden ? "Show" : "Hide"} ${calendar.name}`}
                className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing}`}
              >
                <CalendarSwatch color={calendar.color} hidden={hidden} />
                <span className={`min-w-0 flex-1 truncate font-medium transition-colors ${hidden ? "text-mute" : "text-text"}`}>{calendar.name}</span>
              </button>

              {/* Fixed-width slot so swapping count for actions never shifts the name. */}
              <span className="relative flex h-7 w-[50px] shrink-0 items-center justify-end">
                <span className="list-row-rest absolute inset-0 flex items-center justify-end pr-1">
                  {calendar.favorite ? <Icon name="star" className="h-3 w-3 text-accent" /> : null}
                </span>
                {readOnly ? null : (
                  <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(calendar)}
                      aria-pressed={calendar.favorite === true}
                      title={`${calendar.favorite ? "Unfavourite" : "Favourite"} calendar`}
                      aria-label={`${calendar.favorite ? "Remove" : "Add"} ${calendar.name} ${calendar.favorite ? "from" : "to"} favourites`}
                      className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-elevated ${calendar.favorite ? "text-accent" : "text-mute hover:text-text"} ${focusRing}`}
                    >
                      <Icon name="star" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(calendar)}
                      title="Edit calendar"
                      aria-label={`Edit ${calendar.name} calendar`}
                      className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}
                    >
                      <Icon name="pencil" className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {anyHidden ? (
        <button type="button" onClick={onShowAll} className={`-ml-2 mt-2.5 rounded-md px-2 py-1 text-[11px] text-mute transition-colors hover:text-accent ${focusRing}`}>
          Show all calendars
        </button>
      ) : null}
    </>
  );
}

/** Hour labels down the left of the day and week timelines. */
function HourGutter() {
  return (
    <div className="w-16 shrink-0 border-r border-line">
      {Array.from({ length: 24 }, (_, hour) => (
        <div key={hour} className="relative border-b border-line/40" style={{ height: HOUR_HEIGHT }}>
          <span className="absolute right-2 top-1 text-[10px] tabular-nums text-mute">{formatHour(hour)}</span>
        </div>
      ))}
    </div>
  );
}

/** Accent rule across today's column at the current local time. */
function NowIndicator({ minutes }: { minutes: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (minutes / 60) * HOUR_HEIGHT }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
      <span className="h-px flex-1 bg-danger" />
    </div>
  );
}

/**
 * One day of the timeline: an hour grid you can click to create an event, with
 * timed events positioned over it. Overlapping events share the width.
 */
function DayColumn({ day, events, spans, calendars, timezone, todayKey, nowMinutes, onAdd, onEdit }: { day: Date; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; timezone: string; todayKey: string; nowMinutes: number; onAdd: (day: Date, hour: number) => void; onEdit: (event: CalendarEvent) => void }) {
  const blocks = useMemo(() => timedEventsForDay(events, spans, day, timezone), [day, events, spans, timezone]);
  const isToday = keyFor(day) === todayKey;

  return (
    <div className={`relative min-w-0 flex-1 border-r border-line last:border-r-0 ${isToday ? "bg-accent-glow" : ""}`}>
      {Array.from({ length: 24 }, (_, hour) => (
        <button
          key={hour}
          type="button"
          onClick={() => onAdd(day, hour)}
          className="block w-full border-b border-line/40 transition-colors hover:bg-surface/30"
          style={{ height: HOUR_HEIGHT }}
          aria-label={`Add event on ${day.toLocaleDateString([], { day: "numeric", month: "long" })} at ${formatHour(hour)}`}
        />
      ))}

      {blocks.map((block) => {
        const color = calendars.find((calendar) => calendar.id === block.event.calendarId)?.color ?? DEFAULT_CALENDAR_COLOR;
        const duration = block.endMinutes - block.startMinutes;
        const laneWidth = 100 / block.lanes;
        const compact = duration < 45;
        return (
          <button
            key={block.event.id}
            type="button"
            onClick={() => onEdit(block.event)}
            className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-90"
            style={{
              top: (block.startMinutes / 60) * HOUR_HEIGHT,
              height: Math.max((duration / 60) * HOUR_HEIGHT - 2, 16),
              left: `calc(${block.lane * laneWidth}% + 2px)`,
              width: `calc(${laneWidth}% - 4px)`,
              backgroundColor: tint(color, 0.22),
              color: isLegibleOnDark(color) ? color : "var(--color-text)",
              boxShadow: `inset 2px 0 0 ${color}`,
            }}
          >
            <span className={`block truncate font-medium ${compact ? "" : "mb-0.5"}`}>{block.event.title}</span>
            {compact ? null : <span className="block truncate opacity-70">{spans.get(block.event.id)?.timeLabel}</span>}
          </button>
        );
      })}

      {isToday ? <NowIndicator minutes={nowMinutes} /> : null}
    </div>
  );
}

/**
 * All-day and multi-day events above the timeline. Reuses the month grid's row
 * packing and segment styling so a bar stays continuous across the week.
 */
function AllDayStrip({ days, events, spans, calendars, onEdit }: { days: Date[]; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; onEdit: (event: CalendarEvent) => void }) {
  const slots = useMemo(() => buildDaySlots(days, events, spans), [days, events, spans]);
  const rows = days.reduce((most, day) => Math.max(most, (slots.get(keyFor(day)) ?? []).filter(Boolean).length), 0);
  if (rows === 0) return null;

  return (
    <div className="flex shrink-0 border-b border-line">
      <div className="w-16 shrink-0 border-r border-line py-1.5 pr-2 text-right text-[10px] uppercase tracking-[0.14em] text-mute">All day</div>
      <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const key = keyFor(day);
          const daySlots = slots.get(key) ?? [];
          return (
            <div key={key} className="min-w-0 space-y-0.5 border-r border-line p-1.5 last:border-r-0">
              {Array.from({ length: rows }, (_, index) => {
                const event = daySlots[index];
                if (!event) return <span key={`empty-${index}`} className="block h-4 w-full" />;
                const span = spans.get(event.id);
                if (!span) return <span key={`missing-${index}`} className="block h-4 w-full" />;
                const color = calendars.find((calendar) => calendar.id === event.calendarId)?.color ?? DEFAULT_CALENDAR_COLOR;
                const showText = span.startKey === key || day.getDay() === 0;
                return (
                  <span
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onEdit(event)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                        keyEvent.preventDefault();
                        onEdit(event);
                      }
                    }}
                    className={eventSegmentClass(span, day)}
                    style={eventSegmentStyle(span, day, color)}
                  >
                    {showText ? event.title : " "}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ day, events, spans, calendars, timezone, todayKey, nowMinutes, onAdd, onEdit }: { day: Date; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; timezone: string; todayKey: string; nowMinutes: number; onAdd: (day: Date, hour: number) => void; onEdit: (event: CalendarEvent) => void }) {
  const isToday = keyFor(day) === todayKey;
  const scrollRef = useTimelineScroll(keyFor(day), firstEventMinutes([day], events, spans, timezone));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-line px-5 py-2.5 lg:px-6">
        <span className={`text-sm font-semibold ${isToday ? "text-accent" : "text-text"}`}>{day.toLocaleDateString([], { weekday: "long" })}</span>
        <span className="text-xs text-mute">{day.toLocaleDateString([], { day: "numeric", month: "long" })}</span>
      </div>
      <AllDayStrip days={[day]} events={events} spans={spans} calendars={calendars} onEdit={onEdit} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex">
          <HourGutter />
          <DayColumn day={day} events={events} spans={spans} calendars={calendars} timezone={timezone} todayKey={todayKey} nowMinutes={nowMinutes} onAdd={onAdd} onEdit={onEdit} />
        </div>
      </div>
    </div>
  );
}

function WeekView({ days, selected, todayKey, events, spans, calendars, timezone, nowMinutes, onSelect, onAdd, onEdit }: { days: Date[]; selected: string; todayKey: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; timezone: string; nowMinutes: number; onSelect: (day: Date) => void; onAdd: (day: Date, hour: number) => void; onEdit: (event: CalendarEvent) => void }) {
  const scrollRef = useTimelineScroll(keyFor(days[0]), firstEventMinutes(days, events, spans, timezone));
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
      <div className="flex min-w-[760px] min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 border-b border-line">
          <div className="w-16 shrink-0 border-r border-line" />
          <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {days.map((day) => {
              const key = keyFor(day);
              const isToday = key === todayKey;
              const isSelected = key === selected;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(day)}
                  className={`flex flex-col items-center gap-1 border-r border-line py-2 transition-colors last:border-r-0 hover:bg-surface/30 ${isSelected ? "bg-surface/20" : ""}`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">{day.toLocaleDateString([], { weekday: "short" })}</span>
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? "bg-accent font-semibold text-bg" : isSelected ? "font-semibold text-text" : "text-text"}`}>{day.getDate()}</span>
                </button>
              );
            })}
          </div>
        </div>
        <AllDayStrip days={days} events={events} spans={spans} calendars={calendars} onEdit={onEdit} />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex">
            <HourGutter />
            {days.map((day) => (
              <DayColumn key={keyFor(day)} day={day} events={events} spans={spans} calendars={calendars} timezone={timezone} todayKey={todayKey} nowMinutes={nowMinutes} onAdd={onAdd} onEdit={onEdit} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One month of the year view: dates only, with a dot under days that have events. */
function YearMonth({ month, today, selected, markedDays, onOpenDay }: { month: Date; today: Date; selected: string; markedDays: Set<string>; onOpenDay: (day: Date) => void }) {
  const cells = useMemo(() => monthDays(month), [month]);
  const isCurrentMonth = month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();

  return (
    <div>
      <p className={`mb-2 text-sm font-semibold ${isCurrentMonth ? "text-accent" : "text-text"}`}>{month.toLocaleDateString([], { month: "long" })}</p>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px]">
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
          <span key={`${label}-${index}`} className="pb-1 font-semibold text-mute/70">{label}</span>
        ))}
        {cells.map((day) => {
          const key = keyFor(day);
          // Neighbouring months are left blank here; at this size they add
          // noise without helping anyone read the year.
          if (day.getMonth() !== month.getMonth()) return <span key={key} />;
          const isToday = sameDay(day, today);
          const isSelected = key === selected;
          const marked = markedDays.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenDay(day)}
              className={`relative mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] transition-colors ${isToday ? "bg-accent font-semibold text-bg" : isSelected ? "bg-surface font-medium text-text" : "text-text hover:bg-surface"}`}
            >
              {day.getDate()}
              {marked && !isToday ? <i className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YearView({ months, today, selected, events, spans, onOpenDay }: { months: Date[]; today: Date; selected: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; onOpenDay: (day: Date) => void }) {
  // One pass over the year's occurrences, rather than re-scanning every event
  // for each of the ~500 day cells the twelve months add up to.
  const markedDays = useMemo(() => {
    const marked = new Set<string>();
    for (const event of events) {
      const span = spans.get(event.id);
      if (!span) continue;
      const cursor = dateFromKey(span.startKey);
      // Bounded at a year so a malformed span cannot spin forever.
      for (let step = 0; step < 366; step += 1) {
        const key = keyFor(cursor);
        if (key > span.endKey) break;
        marked.add(key);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return marked;
  }, [events, spans]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">
      <div className="grid gap-x-7 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {months.map((month) => (
          <YearMonth key={month.getMonth()} month={month} today={today} selected={selected} markedDays={markedDays} onOpenDay={onOpenDay} />
        ))}
      </div>
    </div>
  );
}

function TaskDialog({ editing, title, start, end, notes, location, participants, allDay, calendarId, calendars, repeatChoice, customFrequency, customInterval, repeatEnd, repeatCount, repeatUntil, minRepeatUntil, busy, error, onClose, onSave, onDelete, onTitleChange, onStartChange, onEndChange, onNotesChange, onLocationChange, onParticipantsChange, onAllDayChange, onCalendarChange, onRepeatChange, onCustomFrequencyChange, onCustomIntervalChange, onRepeatEndChange, onRepeatCountChange, onRepeatUntilChange }: { editing: boolean; title: string; start: string; end: string; notes: string; location: string; participants: string; allDay: boolean; calendarId: string; calendars: Calendar[]; repeatChoice: RepeatChoice; customFrequency: "daily" | "weekly" | "monthly" | "yearly"; customInterval: number; repeatEnd: RepeatEnd; repeatCount: number; repeatUntil: string; minRepeatUntil: string; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onTitleChange: (value: string) => void; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onNotesChange: (value: string) => void; onLocationChange: (value: string) => void; onParticipantsChange: (value: string) => void; onAllDayChange: (value: boolean) => void; onCalendarChange: (value: string) => void; onRepeatChange: (value: RepeatChoice) => void; onCustomFrequencyChange: (value: "daily" | "weekly" | "monthly" | "yearly") => void; onCustomIntervalChange: (value: number) => void; onRepeatEndChange: (value: RepeatEnd) => void; onRepeatCountChange: (value: number) => void; onRepeatUntilChange: (value: string) => void }) {
  return (
    <Modal title={editing ? "Edit event" : "New event"} onClose={onClose}>
        <div className="event-dialog flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Title */}
          <input autoFocus value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="Event title" className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm font-medium outline-none placeholder:text-mute focus:border-accent" />

          {/* Calendar + Location row */}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-[11px] font-medium text-mute">
              Calendar
              <select value={calendarId} onChange={(e) => onCalendarChange(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-xs outline-none focus:border-accent">{calendars.map((cal) => <option key={cal.id} value={cal.id}>{cal.name}</option>)}</select>
            </label>
            <label className="block text-[11px] font-medium text-mute">
              Location
              <input value={location} onChange={(e) => onLocationChange(e.target.value)} placeholder="Optional" className="mt-1 h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-xs outline-none placeholder:text-mute focus:border-accent" />
            </label>
          </div>

          {/* Participants */}
          <label className="block text-[11px] font-medium text-mute">
            Participants
            <input value={participants} onChange={(e) => onParticipantsChange(e.target.value)} placeholder="Names or emails, comma separated" className="mt-1 h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-xs outline-none placeholder:text-mute focus:border-accent" />
          </label>

          {/* Date/Time section */}
          <div className="rounded-lg border border-line bg-bg">
            <label className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 text-xs text-text">
              <input type="checkbox" checked={allDay} onChange={(e) => onAllDayChange(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
              All day
            </label>
            <div className="grid grid-cols-2 gap-px bg-line">
              <label className="flex flex-col gap-1 bg-bg px-3 py-2">
                <span className="text-[10px] font-medium text-mute">Starts</span>
                {allDay
                  ? <input type="date" value={start.slice(0, 10)} onChange={(e) => onStartChange(`${e.target.value}T09:00`)} className="h-7 w-full rounded border-none bg-transparent text-xs text-text outline-none" />
                  : <input type="datetime-local" value={start} onChange={(e) => onStartChange(e.target.value)} className="h-7 w-full rounded border-none bg-transparent text-xs text-text outline-none" />}
              </label>
              <label className="flex flex-col gap-1 bg-bg px-3 py-2">
                <span className="text-[10px] font-medium text-mute">Ends</span>
                {allDay
                  ? <input type="date" value={end.slice(0, 10) || start.slice(0, 10)} onChange={(e) => onEndChange(`${e.target.value}T23:59`)} className="h-7 w-full rounded border-none bg-transparent text-xs text-text outline-none" />
                  : <input type="datetime-local" value={end} onChange={(e) => onEndChange(e.target.value)} className="h-7 w-full rounded border-none bg-transparent text-xs text-text outline-none" />}
              </label>
            </div>
          </div>

          <label className="block text-[11px] font-medium text-mute">
            Repeat event
            <select value={repeatChoice} onChange={(e) => onRepeatChange(e.target.value as RepeatChoice)} className="mt-1 h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-xs outline-none focus:border-accent">
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekday">Every weekday Monday - Friday</option>
              <option value="weekly">Every week on the selected weekday</option>
              <option value="monthly-date">Every month on the selected date</option>
              <option value="monthly-nth">Every month on the ordinal weekday</option>
              <option value="yearly">Every year</option>
              <option value="custom">Custom...</option>
            </select>
          </label>
          {repeatChoice === "custom" ? <div className="grid grid-cols-[1fr_1.4fr] gap-2.5 rounded-lg border border-line bg-bg p-2.5">
            <label className="text-[11px] font-medium text-mute">Every<input type="number" min="1" max="99" value={customInterval} onChange={(e) => onCustomIntervalChange(Number(e.target.value) || 1)} className="mt-1 h-8 w-full rounded border border-line bg-panel px-2 text-xs text-text outline-none focus:border-accent" /></label>
            <label className="text-[11px] font-medium text-mute">Period<select value={customFrequency} onChange={(e) => onCustomFrequencyChange(e.target.value as typeof customFrequency)} className="mt-1 h-8 w-full rounded border border-line bg-panel px-2 text-xs outline-none focus:border-accent"><option value="daily">day(s)</option><option value="weekly">week(s)</option><option value="monthly">month(s)</option><option value="yearly">year(s)</option></select></label>
          </div> : null}
          {repeatChoice !== "none" ? <div className="space-y-2.5 rounded-lg border border-line bg-bg p-2.5">
            <label className="block text-[11px] font-medium text-mute">
              Repeat until
              <select value={repeatEnd} onChange={(e) => onRepeatEndChange(e.target.value as RepeatEnd)} className="mt-1 h-8 w-full rounded border border-line bg-panel px-2 text-xs outline-none focus:border-accent">
                <option value="never">Forever</option>
                <option value="count">After a number of occurrences</option>
                <option value="date">On a date</option>
              </select>
            </label>
            {repeatEnd === "count" ? <label className="block text-[11px] font-medium text-mute">
              Occurrences
              <input type="number" min="1" max="999" value={repeatCount} onChange={(e) => onRepeatCountChange(Number(e.target.value) || 1)} className="mt-1 h-8 w-full rounded border border-line bg-panel px-2 text-xs text-text outline-none focus:border-accent" />
            </label> : null}
            {repeatEnd === "date" ? <label className="block text-[11px] font-medium text-mute">
              Last date
              <input type="date" min={minRepeatUntil} value={repeatUntil} onChange={(e) => onRepeatUntilChange(e.target.value)} className="mt-1 h-8 w-full rounded border border-line bg-panel px-2 text-xs text-text outline-none focus:border-accent" />
            </label> : null}
          </div> : null}

          {/* Notes */}
          <label className="block text-[11px] font-medium text-mute">
            Notes
            <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} placeholder="Optional notes" rows={2} className="mt-1 w-full resize-y rounded-lg border border-line bg-bg p-2.5 text-xs leading-relaxed outline-none placeholder:text-mute focus:border-accent" />
          </label>

          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3.5">
          <div>{onDelete ? <button type="button" onClick={onDelete} disabled={busy} className={btnDanger}>Delete</button> : null}</div>
          <button type="button" onClick={onSave} disabled={busy || !title.trim() || !calendarId} className={btnPrimary}>{editing ? "Save changes" : "Save event"}</button>
        </div>
    </Modal>
  );
}

function CalendarDialog({ editing, name, color, busy, error, onClose, onSave, onDelete, onNameChange, onColorChange }: { editing: boolean; name: string; color: string; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onNameChange: (value: string) => void; onColorChange: (value: string) => void }) {
  return (
    <Modal title={editing ? "Edit calendar" : "Create calendar"} onClose={onClose}>
      <div className="space-y-4 p-6">
        <label className="block text-xs font-medium text-mute">
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Personal"
            className={field}
          />
        </label>

        <label className="block text-xs font-medium text-mute">
          Colour
          <div className="mt-1.5 flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(event) => onColorChange(event.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-line bg-bg p-1"
              aria-label="Calendar colour"
            />
            <span className="font-mono text-xs text-mute">{color}</span>
          </div>
        </label>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className={btnDanger}
              >
                Delete calendar
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !name.trim()}
            className={btnPrimary}
          >
            {editing ? "Save changes" : "Create calendar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ImportProgressModal({ title, description, current, total }: { title: string; description: string; current: number; total: number }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"><section role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/50"><h3 className="text-base font-semibold text-text">{title}</h3><p className="mt-1 text-xs text-mute">{description}</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} /></div><p className="mt-2 text-right text-[11px] tabular-nums text-mute">{total ? `${current} of ${total}` : "Preparing..."}</p></section></div>;
}

function MiniMonth({ month, selected, events, spans, onSelect }: { month: Date; selected: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; onSelect: (day: Date) => void }) {
  const days = monthDays(month);
  return <div className="mt-5"><div className="mb-3 flex items-center justify-between text-xs font-semibold"><span>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span><span className="text-[10px] uppercase tracking-[0.14em] text-mute">{month.toLocaleDateString([], { month: "short" })}</span></div><div className="grid grid-cols-7 gap-y-1 text-center text-[10px] text-mute">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}{days.map((day) => { const key = keyFor(day); const marked = events.some((event) => { const span = spans.get(event.id); return span ? spanCoversDay(span, day) : false; }); return <button key={key} type="button" onClick={() => onSelect(day)} className={`relative flex h-6 items-center justify-center rounded-full text-[11px] transition-colors ${day.getMonth() === month.getMonth() ? "text-text" : "text-mute/40"} ${selected === key ? "bg-accent font-semibold text-bg" : "hover:bg-surface"}`}><span>{day.getDate()}</span>{marked && selected !== key ? <i className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-accent" /> : null}</button>; })}</div></div>;
}