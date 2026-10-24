import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCalendarEvent,
  deleteCalendar,
  ensureDefaultCalendar,
  putCalendar,
  putCalendarEvent,
  type Session,
} from "../lib/client";
import type { Calendar, CalendarEvent, Contact, RecurrenceRule, Task } from "../lib/types";
import { dueTaskMarks } from "../lib/taskCalendar";
import { DEFAULT_CALENDAR_COLOR } from "../lib/types";
import { DEFAULT_CALENDAR_ID, activeCalendars, archivedCalendars, isCalendarVisible, visibleCalendarIds } from "../lib/calendar";
import { friendlyError } from "../lib/errors";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import { Modal } from "./Modal";
import { localInputToUtc, utcToLocalInput } from "../lib/timezone";
import { btnDanger, btnPrimary, field, focusRing, sidebarHeaderAction, sidebarMark, sidebarSectionAction } from "../lib/styles";
import { VisibilityBox } from "./ContainerList";
import { CalendarList } from "./CalendarSidebar";
import { DayView as ExtractedDayView, MonthGrid as ExtractedMonthGrid, WeekView as ExtractedWeekView, YearView as ExtractedYearView } from "./CalendarViews";
import {
  dateFromKey,
  EventSpan,
  formatWeekRange,
  keyFor,
  monthDays,
  occurrencesIn,
  shiftDays,
  shiftEndWithStart,
  spanCoversDay,
  weekDays,
} from "../lib/calendarModel";
import { searchEvents, type SearchResult } from "../lib/calendarSearch";
import {
  HIDDEN_CALENDARS,
  SHOWN_ARCHIVED_CALENDARS,
  TASKS_OVERLAY,
  loadCalendarFlag,
  loadCalendarIds,
  storeCalendarFlag,
  storeCalendarIds,
} from "../lib/calendarVisibility";

type ViewMode = "day" | "week" | "month" | "year";
type RepeatChoice = "none" | "daily" | "weekday" | "weekly" | "monthly-date" | "monthly-nth" | "yearly" | "custom";
type RepeatEnd = "never" | "count" | "date";

const DEFAULT_REPEAT_COUNT = 10;

function EventSearch({
  query,
  results,
  onQueryChange,
  onPick,
}: {
  query: string;
  results: SearchResult[];
  onQueryChange: (q: string) => void;
  onPick: (result: SearchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { setOpen(false); setCursor(-1); }, []);

  useEffect(() => {
    if (query.trim()) { setOpen(true); setCursor(-1); }
    else close();
  }, [query, close]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && cursor >= 0) { e.preventDefault(); pick(results[cursor]); }
    else if (e.key === "Escape") { close(); inputRef.current?.blur(); }
  }

  function pick(result: SearchResult) {
    onQueryChange("");
    close();
    onPick(result);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Icon name="search" className="h-3.5 w-3.5" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim() && results.length > 0) setOpen(true); }}
          placeholder="Search events"
          aria-label="Search events"
          className={`h-8 w-40 rounded-lg border border-line bg-surface/40 pl-8 pr-3 text-xs text-text placeholder-mute transition-all focus:w-56 focus:border-line-light focus:bg-surface focus:outline-none sm:w-44 sm:focus:w-64 ${focusRing}`}
        />
        {query ? (
          <button type="button" onClick={() => { onQueryChange(""); close(); }} className="absolute right-2 text-mute hover:text-text" aria-label="Clear search">
            <Icon name="x" className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {open && results.length > 0 ? (
        <ul role="listbox" className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-bg shadow-lg sm:w-80">
          {results.map((result, i) => (
            <li
              key={`${result.event.id}-${result.date.toISOString()}`}
              role="option"
              aria-selected={i === cursor}
              onPointerDown={(e) => { e.preventDefault(); pick(result); }}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors ${i === cursor ? "bg-surface" : "hover:bg-surface/60"}`}
            >
              <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: result.color }} />
              <span className="min-w-0 flex-1 truncate font-medium">{result.event.title || "Untitled"}</span>
              <span className="shrink-0 text-[11px] text-mute">{result.dateLabel}</span>
            </li>
          ))}
        </ul>
      ) : open && query.trim() ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-line bg-bg px-3 py-2.5 text-xs text-mute shadow-lg sm:w-80">
          No events match &ldquo;{query.trim()}&rdquo;
        </div>
      ) : null}
    </div>
  );
}

function Icon({ name, className = "h-4 w-4" }: { name: "plus" | "search" | "chevron" | "pencil" | "star" | "x" | "archive" | "unarchive"; className?: string }) {
  const content = {
    plus: <path d="M8 2.5v11M2.5 8h11" />,
    search: <><circle cx="6.5" cy="6.5" r="4" /><path d="m10 10 3.5 3.5" /></>,
    chevron: <path d="m6.5 3.5 5 5-5 5" />,
    x: <path d="m4 4 8 8M12 4l-8 8" />,
    pencil: <><path d="m10.75 2.75 2.5 2.5M3 13l1.5-3.75 6.25-6.25a1.77 1.77 0 0 1 2.5 2.5L7 11.75 3 13Z" /></>,
    star: <path d="m8 1.75 1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62L8 1.75Z" fill="currentColor" />,
    archive: <><path d="M2 3.5h12v3H2z" /><path d="M3.5 6.5v6h9v-6" /><path d="M6.5 9h3" /></>,
    unarchive: <><path d="M2 3.5h12v3H2z" /><path d="M3.5 6.5v6h9v-6" /><path d="M8 11.5V8m-1.5 1.5L8 8l1.5 1.5" /></>,
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
  contacts,
  busy,
  timezone,
  onRefresh,
  readOnly,
  sidebar,
  dueTasks,
  onOpenTask,
}: {
  session: Session;
  calendars: Calendar[];
  events: CalendarEvent[];
  contacts: Contact[];
  busy: boolean;
  timezone: string;
  onRefresh: () => Promise<void>;
  readOnly?: boolean;
  /** Shared with the rest of the shell; the header owns the control. */
  sidebar: Sidebar;
  /** Absent when the tasks feature is off, which also hides the overlay's switch. */
  dueTasks?: Task[];
  onOpenTask?: (id: string) => void;
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
  const [showTasks, setShowTasks] = useState(() => loadCalendarFlag(session.state.collection_id, TASKS_OVERLAY, true));
  const taskMarks = useMemo(
    () => (dueTasks && showTasks ? dueTaskMarks(dueTasks, new Date(), timezone) : undefined),
    [dueTasks, showTasks, timezone],
  );
  function toggleTasks(next: boolean) {
    setShowTasks(next);
    storeCalendarFlag(session.state.collection_id, TASKS_OVERLAY, next);
  }
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(() => loadCalendarIds(session.state.collection_id, HIDDEN_CALENDARS));
  const [shownArchivedIds, setShownArchivedIds] = useState<Set<string>>(() => loadCalendarIds(session.state.collection_id, SHOWN_ARCHIVED_CALENDARS));
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
  const [participants, setParticipants] = useState<string[]>([]);
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>("none");
  const [customFrequency, setCustomFrequency] = useState<"daily" | "weekly" | "monthly" | "yearly">("weekly");
  const [customInterval, setCustomInterval] = useState(1);
  const [repeatEnd, setRepeatEnd] = useState<RepeatEnd>("never");
  const [repeatCount, setRepeatCount] = useState(DEFAULT_REPEAT_COUNT);
  const [repeatUntil, setRepeatUntil] = useState("");
  const [deletingCalendar, setDeletingCalendar] = useState(false);
  const [confirmDeleteCalendar, setConfirmDeleteCalendar] = useState(false);
  const [confirmPurgeEvents, setConfirmPurgeEvents] = useState(false);
  const [purgingEvents, setPurgingEvents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingEvent, setRemovingEvent] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => today.getHours() * 60 + today.getMinutes());
  const readOnlyMode = readOnly === true;

  useEffect(() => {
    const tick = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(tick);
  }, []);

  const ensuredRef = useRef(false);
  useEffect(() => {
    if (readOnlyMode || ensuredRef.current) return;
    ensuredRef.current = true;
    if (calendars.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID)) return;
    void (async () => {
      try {
        await ensureDefaultCalendar(session, calendars);
        await onRefresh();
      } catch (err) {
        setError(friendlyError(err));
      }
    })();
  }, [calendars, onRefresh, readOnlyMode, session]);

  const days = useMemo(() => monthDays(month), [month]);
  const activeCals = useMemo(() => activeCalendars(calendars), [calendars]);
  const archivedCals = useMemo(() => archivedCalendars(calendars), [calendars]);
  const visibleIds = useMemo(
    () => visibleCalendarIds(calendars, hiddenCalendarIds, shownArchivedIds),
    [calendars, hiddenCalendarIds, shownArchivedIds],
  );
  const searchable = useMemo(
    () => events.filter((event) => !event.calendarId
      || !archivedCals.some((calendar) => calendar.id === event.calendarId && !visibleIds.has(calendar.id))),
    [archivedCals, events, visibleIds],
  );
  const filtered = useMemo(
    () => events
      // An event whose calendar is missing or switched off is left out; one
      // belonging to no calendar at all is kept.
      .filter((event) => !event.calendarId || visibleIds.has(event.calendarId))
      .sort((a, b) => {
        const aStart = a.start;
        const bStart = b.start;
        if (aStart !== bStart) return aStart.localeCompare(bStart);
        const aEnd = a.end || a.start;
        const bEnd = b.end || b.start;
        return bEnd.localeCompare(aEnd);
      }),
    [events, visibleIds],
  );
  const composerCalendars = useMemo(() => {
    const current = calendars.find((calendar) => calendar.id === eventCalendarId);
    return current && current.archived === true ? [...activeCals, current] : activeCals;
  }, [activeCals, calendars, eventCalendarId]);
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
    () => searchEvents(searchable, calendars, search, today, timezone),
    // `today` is recreated each render but only its date matters, so the key
    // stands in for it to avoid recomputing the whole search every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendars, search, searchable, timezone, todayKey],
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

  /**
   * Switches one calendar on or off on the grid. Which set the id moves in and
   * out of depends on the calendar's own default, so an archived calendar can
   * be switched on without being restored.
   */
  function toggleCalendar(calendarId: string) {
    const archived = calendars.some((calendar) => calendar.id === calendarId && calendar.archived === true);
    const group = archived ? SHOWN_ARCHIVED_CALENDARS : HIDDEN_CALENDARS;
    const update = archived ? setShownArchivedIds : setHiddenCalendarIds;
    update((current) => {
      const next = new Set(current);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      storeCalendarIds(session.state.collection_id, group, next);
      return next;
    });
  }

  /** Clears the switched-off calendars in play. The archive is left as it is. */
  function showAllCalendars() {
    setHiddenCalendarIds(new Set());
    storeCalendarIds(session.state.collection_id, HIDDEN_CALENDARS, new Set());
  }

  /**
   * Drops a calendar's recorded exception so it starts at the default of the
   * group it is moving into: archiving one hides it, restoring one shows it.
   */
  function forgetCalendarToggle(calendarId: string, group: string) {
    const update = group === SHOWN_ARCHIVED_CALENDARS ? setShownArchivedIds : setHiddenCalendarIds;
    update((current) => {
      if (!current.has(calendarId)) return current;
      const next = new Set(current);
      next.delete(calendarId);
      storeCalendarIds(session.state.collection_id, group, next);
      return next;
    });
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
    setParticipants([]);
    setAllDay(false);
    setEventCalendarId(activeCals[0]?.id ?? "");
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
    setParticipants(event.participants ?? []);
    setEventCalendarId(event.calendarId ?? activeCals[0]?.id ?? "");
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
    if (saving || removingEvent) return;
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
      setSaving(true);
      await putCalendarEvent(
        session,
        {
          title: title.trim(),
          start: allDay ? day : localInputToUtc(start, timezone),
          end: allDay ? end.slice(0, 10) || day : end ? localInputToUtc(end, timezone) : undefined,
          notes: notes.trim() || undefined,
          location: location.trim() || undefined,
          participants: participants.filter(Boolean),
          timezone,
          calendarId: eventCalendarId || undefined,
          recurrence,
          raw: editingEvent?.raw,
        },
        editingEvent?.id,
      );
      await onRefresh();
      closeTaskDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent() {
    if (!editingEvent || saving || removingEvent) return;
    setError(null);
    setRemovingEvent(true);
    try {
      await deleteCalendarEvent(session, editingEvent.id);
      await onRefresh();
      closeTaskDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingEvent(false);
    }
  }

  async function saveCalendar() {
    if (!calendarName.trim() || saving) return;
    setError(null);
    setSaving(true);
    try {
      await putCalendar(
        session,
        {
          name: calendarName.trim(),
          color: calendarColor,
          favorite: editingCalendar?.favorite ?? false,
          archived: editingCalendar?.archived ?? false,
          raw: editingCalendar?.raw,
        },
        editingCalendar?.id,
      );
      await onRefresh();
      setCalendarName("");
      setCalendarColor(DEFAULT_CALENDAR_COLOR);
      setEditingCalendar(null);
      setCalendarComposer(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite(calendar: Calendar) {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await putCalendar(
        session,
        { name: calendar.name, color: calendar.color, favorite: !calendar.favorite, archived: calendar.archived, raw: calendar.raw },
        calendar.id,
      );
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Moves a calendar in or out of the archive.
   *
   * Refused where it would leave no calendar in play, since a new event would
   * then have nowhere to go. An archived calendar stays readable: it drops out
   * of the list and the pickers and off the grid, and can be switched back on
   * from the archived group without being restored.
   */
  async function toggleArchived(calendar: Calendar) {
    if (saving) return;
    const archiving = calendar.archived !== true;
    if (archiving && activeCals.length <= 1) {
      setError(`“${calendar.name}” is your only calendar in use. Create or restore another one before archiving it.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await putCalendar(
        session,
        { name: calendar.name, color: calendar.color, favorite: calendar.favorite, archived: archiving, raw: calendar.raw },
        calendar.id,
      );
      forgetCalendarToggle(calendar.id, archiving ? HIDDEN_CALENDARS : SHOWN_ARCHIVED_CALENDARS);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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

  async function purgeEvents() {
    if (!editingCalendar) return;
    setConfirmPurgeEvents(false);
    setError(null);
    setPurgingEvents(true);
    const calendarEvents = events.filter((item) => item.calendarId === editingCalendar.id);
    setDeleteProgress({ current: 0, total: calendarEvents.length });
    try {
      for (let index = 0; index < calendarEvents.length; index += 1) {
        await deleteCalendarEvent(session, calendarEvents[index].id);
        setDeleteProgress({ current: index + 1, total: calendarEvents.length });
      }
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPurgingEvents(false);
      setDeleteProgress({ current: 0, total: 0 });
    }
  }

  return (
    // Full-bleed: the month grid uses the whole viewport width rather than
    // sitting in a card. The sidebar keeps a translucent panel fill so it still
    // separates from the grid without reintroducing an opaque chrome column.
    <main className="flex flex-col bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:h-[calc(100dvh-var(--sb-header-h,74px))] lg:overflow-hidden lg:pb-0">
      <div className="sb-shell grid min-h-0 flex-1 lg:h-full" style={sidebar.cols}>
        <SidebarDrawer title="Calendars" sidebar={sidebar}>
          <SidebarHeader
            eyebrow="My calendar"
            title="Calendar"
            action={!readOnlyMode ? <button type="button" onClick={() => openNewTask()} className={sidebarHeaderAction} aria-label="Create event"><Icon name="plus" /></button> : null}
          />
          <MiniMonth month={month} selected={selected} events={miniEvents} spans={miniSpans} onSelect={(day) => { selectDay(day); sidebar.close(); }} />
          <SidebarSection
            label="Calendars"
            action={!readOnlyMode ? <button type="button" onClick={openNewCalendar} className={sidebarSectionAction} aria-label="Add calendar"><Icon name="plus" className="h-3 w-3" /></button> : null}
          >
            <CalendarList calendars={activeCals} archived={archivedCals} isVisible={(calendar) => isCalendarVisible(calendar, hiddenCalendarIds, shownArchivedIds)} readOnly={readOnlyMode} canArchive={activeCals.length > 1} onToggle={toggleCalendar} onShowAll={showAllCalendars} onToggleFavorite={(calendar) => void toggleFavorite(calendar)} onToggleArchived={(calendar) => void toggleArchived(calendar)} onEdit={openEditCalendar} onCreate={openNewCalendar} />
          </SidebarSection>
          {dueTasks ? (
            <SidebarSection label="Tasks">
              <label className={`mt-2.5 -mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors hover:bg-surface/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-ring ${showTasks ? "text-text" : "text-mute hover:text-text"}`}>
                <input type="checkbox" checked={showTasks} onChange={(event) => toggleTasks(event.target.checked)} className="sr-only" />
                <span className={sidebarMark}><VisibilityBox shown={showTasks} /></span>
                Show tasks with a due date
              </label>
            </SidebarSection>
          ) : null}
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
            <ExtractedMonthGrid month={month} days={days} selected={selected} todayKey={todayKey} events={visibleEvents} spans={spans} calendars={calendars} onSelect={selectDay} onAdd={readOnlyMode ? () => undefined : (day) => openNewTask(day)} onEdit={editOccurrence} taskMarks={taskMarks} onOpenTask={onOpenTask} />
          ) : mode === "day" ? (
            <ExtractedDayView day={selectedDate} events={visibleEvents} spans={spans} calendars={calendars} timezone={timezone} todayKey={todayKey} nowMinutes={nowMinutes} onAdd={readOnlyMode ? () => undefined : openNewTask} onEdit={editOccurrence} taskMarks={taskMarks} onOpenTask={onOpenTask} />
          ) : mode === "week" ? (
            <ExtractedWeekView days={week} selected={selected} todayKey={todayKey} events={visibleEvents} spans={spans} calendars={calendars} timezone={timezone} nowMinutes={nowMinutes} onSelect={selectDay} onAdd={readOnlyMode ? () => undefined : openNewTask} onEdit={editOccurrence} taskMarks={taskMarks} onOpenTask={onOpenTask} />
          ) : (
            <ExtractedYearView months={yearMonths} today={today} selected={selected} events={visibleEvents} spans={spans} onOpenDay={openDay} />
          )}
        </section>
      </div>

      {composer ? <TaskDialog editing={editingEvent !== null} title={title} start={start} end={end} notes={notes} location={location} participants={participants} contacts={contacts} allDay={allDay} calendarId={eventCalendarId} calendars={composerCalendars} repeatChoice={repeatChoice} customFrequency={customFrequency} customInterval={customInterval} repeatEnd={repeatEnd} repeatCount={repeatCount} repeatUntil={repeatUntil} minRepeatUntil={start.slice(0, 10)} busy={busy} saving={saving} removing={removingEvent} error={error} onClose={() => { if (!saving && !removingEvent) closeTaskDialog(); }} onSave={() => void saveEvent()} onDelete={editingEvent ? () => void removeEvent() : undefined} onTitleChange={setTitle} onStartChange={updateStart} onEndChange={setEnd} onNotesChange={setNotes} onLocationChange={setLocation} onParticipantsChange={setParticipants} onAllDayChange={setAllDay} onCalendarChange={setEventCalendarId} onRepeatChange={setRepeatChoice} onCustomFrequencyChange={setCustomFrequency} onCustomIntervalChange={setCustomInterval} onRepeatEndChange={setRepeatEnd} onRepeatCountChange={setRepeatCount} onRepeatUntilChange={setRepeatUntil} /> : null}
      {calendarComposer ? <CalendarDialog editing={editingCalendar !== null} name={calendarName} color={calendarColor} busy={busy || purgingEvents} saving={saving} error={error} eventCount={editingCalendar ? events.filter((event) => event.calendarId === editingCalendar.id).length : 0} onClose={() => { if (saving) return; setCalendarComposer(false); setEditingCalendar(null); }} onSave={() => void saveCalendar()} onDelete={editingCalendar && editingCalendar.id !== DEFAULT_CALENDAR_ID ? () => setConfirmDeleteCalendar(true) : undefined} onPurge={editingCalendar ? () => setConfirmPurgeEvents(true) : undefined} onNameChange={setCalendarName} onColorChange={setCalendarColor} /> : null}
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
      {confirmPurgeEvents && editingCalendar ? (
        <ConfirmDialog
          title="Purge Events"
          heading={`Purge Events from “${editingCalendar.name}”?`}
          body={`This permanently deletes all ${events.filter((event) => event.calendarId === editingCalendar.id).length} event${events.filter((event) => event.calendarId === editingCalendar.id).length === 1 ? "" : "s"} in this calendar. The calendar itself will remain.`}
          confirmLabel="Purge Events"
          onConfirm={() => void purgeEvents()}
          onClose={() => setConfirmPurgeEvents(false)}
        />
      ) : null}
      {deletingCalendar ? <ImportProgressModal title="Deleting calendar" description="Removing events and calendar data. Keep this window open." current={deleteProgress.current} total={deleteProgress.total} /> : null}
      {purgingEvents ? <ImportProgressModal title="Purging Events" description="Removing events from this calendar. Keep this window open." current={deleteProgress.current} total={deleteProgress.total} /> : null}
    </main>
  );
}

function ParticipantPicker({
  participants,
  contacts,
  onChange,
}: {
  participants: string[];
  contacts: Contact[];
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeContacts = useMemo(
    () => contacts.filter((c) => c.archived !== true),
    [contacts],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return activeContacts
      .filter((c) => {
        const name = c.name.toLowerCase();
        const email = (c.email ?? "").toLowerCase();
        return (name.includes(q) || email.includes(q)) && !participants.includes(c.name);
      })
      .slice(0, 6);
  }, [query, activeContacts, participants]);

  useEffect(() => {
    if (suggestions.length > 0 && query.trim()) setOpen(true);
    else setOpen(false);
    setCursor(-1);
  }, [suggestions, query]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function addParticipant(name: string) {
    const trimmed = name.trim();
    if (trimmed && !participants.includes(trimmed)) {
      onChange([...participants, trimmed]);
    }
    setQuery("");
    setOpen(false);
    setCursor(-1);
    inputRef.current?.focus();
  }

  function removeParticipant(index: number) {
    onChange(participants.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && cursor >= 0 && suggestions[cursor]) {
        addParticipant(suggestions[cursor].name);
      } else if (query.trim()) {
        addParticipant(query);
      }
    } else if (e.key === "," || e.key === "Tab") {
      if (query.trim()) {
        e.preventDefault();
        addParticipant(query);
      }
    } else if (e.key === "Backspace" && !query && participants.length > 0) {
      onChange(participants.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setCursor(-1);
    }
  }

  return (
    <div className="block text-[11px] font-medium text-mute">
      Participants
      <div ref={containerRef} className="relative mt-1">
        <div
          className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-bg px-2 py-1.5 focus-within:border-accent"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          {participants.map((name, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-[11px] text-text">
              {name}
              <button
                type="button"
                onClick={() => removeParticipant(i)}
                className="text-mute hover:text-text"
                aria-label={`Remove ${name}`}
              >
                <Icon name="x" className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={participants.length === 0 ? "Search contacts or type a name" : ""}
            className="min-w-24 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-mute"
          />
        </div>
        {open && suggestions.length > 0 ? (
          <ul role="listbox" className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
            {suggestions.map((contact, i) => (
              <li
                key={contact.id}
                role="option"
                aria-selected={i === cursor}
                onPointerDown={(e) => { e.preventDefault(); addParticipant(contact.name); }}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition-colors ${i === cursor ? "bg-surface" : "hover:bg-surface/60"}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-text">{contact.name}</span>
                {contact.email ? <span className="shrink-0 text-mute">{contact.email}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TaskDialog({ editing, title, start, end, notes, location, participants, contacts, allDay, calendarId, calendars, repeatChoice, customFrequency, customInterval, repeatEnd, repeatCount, repeatUntil, minRepeatUntil, busy, saving, removing, error, onClose, onSave, onDelete, onTitleChange, onStartChange, onEndChange, onNotesChange, onLocationChange, onParticipantsChange, onAllDayChange, onCalendarChange, onRepeatChange, onCustomFrequencyChange, onCustomIntervalChange, onRepeatEndChange, onRepeatCountChange, onRepeatUntilChange }: { editing: boolean; title: string; start: string; end: string; notes: string; location: string; participants: string[]; contacts: Contact[]; allDay: boolean; calendarId: string; calendars: Calendar[]; repeatChoice: RepeatChoice; customFrequency: "daily" | "weekly" | "monthly" | "yearly"; customInterval: number; repeatEnd: RepeatEnd; repeatCount: number; repeatUntil: string; minRepeatUntil: string; busy: boolean; saving: boolean; removing: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onTitleChange: (value: string) => void; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onNotesChange: (value: string) => void; onLocationChange: (value: string) => void; onParticipantsChange: (value: string[]) => void; onAllDayChange: (value: boolean) => void; onCalendarChange: (value: string) => void; onRepeatChange: (value: RepeatChoice) => void; onCustomFrequencyChange: (value: "daily" | "weekly" | "monthly" | "yearly") => void; onCustomIntervalChange: (value: number) => void; onRepeatEndChange: (value: "never" | "count" | "date") => void; onRepeatCountChange: (value: number) => void; onRepeatUntilChange: (value: string) => void }) {
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
          <ParticipantPicker participants={participants} contacts={contacts} onChange={onParticipantsChange} />

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
          <div>{onDelete ? <button type="button" onClick={onDelete} disabled={busy || saving || removing} aria-busy={removing} className={btnDanger}>{removing ? "Deleting…" : "Delete"}</button> : null}</div>
          <button type="button" onClick={onSave} disabled={busy || saving || removing || !title.trim() || !calendarId} aria-busy={saving} className={btnPrimary}>{saving ? "Saving…" : editing ? "Save changes" : "Save event"}</button>
        </div>
    </Modal>
  );
}

function CalendarDialog({ editing, name, color, busy, saving, error, eventCount, onClose, onSave, onDelete, onPurge, onNameChange, onColorChange }: { editing: boolean; name: string; color: string; busy: boolean; saving: boolean; error: string | null; eventCount: number; onClose: () => void; onSave: () => void; onDelete?: () => void; onPurge?: () => void; onNameChange: (value: string) => void; onColorChange: (value: string) => void }) {
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
            {onPurge ? (
              <button type="button" onClick={onPurge} disabled={busy || saving || eventCount === 0} className={btnDanger}>
                Purge Events
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy || saving}
                className={`${btnDanger} ml-2`}
              >
                Delete calendar
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || saving || !name.trim()}
            aria-busy={saving}
            className={btnPrimary}
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create calendar"}
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