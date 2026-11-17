import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import {
  deleteCalendarEvent,
  deleteCalendar,
  ensureDefaultCalendar,
  putCalendar,
  putCalendarEvent,
  type Session,
} from "../lib/client";
import type { Calendar, CalendarEvent, Contact, EventAlert, RecurrenceRule, Task } from "../lib/types";
import { ReminderField } from "./ReminderField";
import { dueTaskMarks } from "../lib/taskCalendar";
import { DEFAULT_CALENDAR_ID, UNTITLED_EVENT_TITLE, activeCalendars, archivedCalendars, isCalendarVisible, nextCalendarColor, retimeAlerts, visibleCalendarIds } from "../lib/calendar";
import { friendlyError } from "../lib/errors";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import { Modal } from "./Modal";
import { localInputToUtc, utcToLocalInput } from "../lib/timezone";
import {
  btnDanger,
  btnHeader,
  btnPrimary,
  btnSecondary,
  focusRing,
  paneTitle,
  searchClear,
  searchField,
  searchIcon,
  sidebarHeaderAction,
  sidebarMark,
} from "../lib/styles";
import { VisibilityBox } from "./ContainerList";
import { CalendarSections } from "./CalendarSidebar";
import { DayView as ExtractedDayView, MonthGrid as ExtractedMonthGrid, WeekView as ExtractedWeekView, YearView as ExtractedYearView } from "./CalendarViews";
import {
  dateFromKey,
  formatWeekRange,
  keyFor,
  monthDays,
  occurrencesIn,
  shiftDays,
  shiftEndWithStart,
  weekDays,
  type WeekStart,
} from "../lib/calendarModel";
import { resolveEvent, searchEvents, type SearchResult } from "../lib/calendarSearch";
import {
  HIDDEN_CALENDARS,
  SHOWN_ARCHIVED_CALENDARS,
  TASKS_OVERLAY,
  loadCalendarFlag,
  loadCalendarIds,
  storeCalendarFlag,
  storeCalendarIds,
} from "../lib/calendarVisibility";
import { Icon } from "./Icon";
import { ErrorMessage } from "./ErrorMessage";

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

  const [expanded, setExpanded] = useState(false);
  const close = useCallback(() => { setOpen(false); setCursor(-1); }, []);

  useEffect(() => {
    if (query.trim()) { setOpen(true); setCursor(-1); }
    else close();
  }, [query, close]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
        if (!query.trim()) setExpanded(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close, query]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  function collapse() {
    onQueryChange("");
    close();
    setExpanded(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && cursor >= 0) { e.preventDefault(); pick(results[cursor]); }
    else if (e.key === "Escape") { close(); inputRef.current?.blur(); }
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && !open) collapse();
    else handleKeyDown(e);
  }

  function pick(result: SearchResult) {
    collapse();
    onPick(result);
  }

  return (
    <div ref={containerRef} className={`relative shrink-0 transition-[width] @min-[36rem]:ml-auto @min-[36rem]:w-44 @min-[36rem]:focus-within:w-64 ${expanded ? "@max-[36rem]:animate-search-pop @max-[36rem]:absolute @max-[36rem]:inset-0 @max-[36rem]:z-20 @max-[36rem]:flex @max-[36rem]:items-center @max-[36rem]:gap-2 @max-[36rem]:bg-bg" : ""}`}>
      <button type="button" onClick={() => setExpanded(true)} aria-label="Search events" className={`h-8 w-8 items-center justify-center rounded-lg border border-line text-mute transition-colors hover:bg-surface hover:text-text ${expanded ? "hidden" : "flex @min-[36rem]:hidden"} ${focusRing}`}><Icon name="search" className="h-3.5 w-3.5" /></button>
      <div className={`relative items-center ${expanded ? "flex flex-1" : "hidden @min-[36rem]:flex"}`}>
        <Icon name="search" className={searchIcon} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          onFocus={() => { if (query.trim() && results.length > 0) setOpen(true); }}
          placeholder="Search events"
          aria-label="Search events"
          className={searchField}
        />
        {query ? (
          <button type="button" onClick={() => { onQueryChange(""); close(); }} className={searchClear} aria-label="Clear search" title="Clear search">
            <Icon name="close" className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {expanded ? <button type="button" onClick={collapse} className={`shrink-0 rounded-lg px-1 text-xs font-medium text-mute hover:text-text @min-[36rem]:hidden ${focusRing}`}>Cancel</button> : null}
      {open && results.length > 0 ? (
        <div role="listbox" className="origin-top animate-scale-in [animation-duration:120ms] absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-bg shadow-lg sm:w-80 @max-[36rem]:left-0 @max-[36rem]:w-auto">
          {results.map((result, i) => (
            <div
              key={`${result.event.id}-${result.date.toISOString()}`}
              role="option"
              aria-selected={i === cursor}
              onPointerDown={(e) => { e.preventDefault(); pick(result); }}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors ${i === cursor ? "bg-surface" : "hover:bg-surface/60"}`}
            >
              <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: result.color }} />
              <span className="min-w-0 flex-1 truncate font-medium">{result.event.title || UNTITLED_EVENT_TITLE}</span>
              <span className="shrink-0 text-[11px] text-mute">{result.dateLabel}</span>
            </div>
          ))}
        </div>
      ) : open && query.trim() ? (
        <div className="origin-top animate-scale-in [animation-duration:120ms] absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-line bg-bg px-3 py-2.5 text-xs text-mute shadow-lg sm:w-80 @max-[36rem]:left-0 @max-[36rem]:w-auto">
          No events match &ldquo;{query.trim()}&rdquo;
        </div>
      ) : null}
    </div>
  );
}


export function CalendarView({
  session,
  calendars,
  events,
  contacts,
  busy,
  timezone,
  weekStart = 0,
  onRefresh,
  readOnly,
  sidebar,
  dueTasks,
  onOpenTask,
  focusEventId,
  onFocusHandled,
}: {
  session: Session;
  calendars: Calendar[];
  events: CalendarEvent[];
  contacts: Contact[];
  busy: boolean;
  timezone: string;
  weekStart?: WeekStart;
  onRefresh: () => Promise<void>;
  readOnly?: boolean;
  /** Shared with the rest of the shell; the header owns the control. */
  sidebar: Sidebar;
  /** Absent when the tasks feature is off, which also hides the overlay's switch. */
  dueTasks?: Task[];
  onOpenTask?: (id: string) => void;
  /** An event to show on its day and open, as `TasksView`'s `focusTaskId`. */
  focusEventId?: string;
  onFocusHandled?: () => void;
}) {
  const today = new Date();
  const todayKey = keyFor(today);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);
  const [mode, setMode] = useState<ViewMode>("month");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
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
  const [eventCalendarId, setEventCalendarId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(`${todayKey}T09:00`);
  const [end, setEnd] = useState(`${todayKey}T10:00`);
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [alerts, setAlerts] = useState<EventAlert[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>("none");
  const [customFrequency, setCustomFrequency] = useState<"daily" | "weekly" | "monthly" | "yearly">("weekly");
  const [customInterval, setCustomInterval] = useState(1);
  const [repeatEnd, setRepeatEnd] = useState<RepeatEnd>("never");
  const [repeatCount, setRepeatCount] = useState(DEFAULT_REPEAT_COUNT);
  const [repeatUntil, setRepeatUntil] = useState("");
  // A stored rule is written back as it is unless the repeat controls or the
  // start day change, since the controls cannot show every rule.
  const [repeatTouched, setRepeatTouched] = useState(false);
  const [openedDay, setOpenedDay] = useState("");
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

  const days = useMemo(() => monthDays(month, weekStart), [month, weekStart]);
  const activeCals = useMemo(() => activeCalendars(calendars), [calendars]);
  const archivedCals = useMemo(() => archivedCalendars(calendars), [calendars]);
  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      if (event.calendarId) counts.set(event.calendarId, (counts.get(event.calendarId) ?? 0) + 1);
    }
    return counts;
  }, [events]);
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
  const week = useMemo(() => weekDays(selectedDate, weekStart), [selectedDate, weekStart]);
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

  const viewKey = `${mode}:${keyFor(rangeStart)}`;
  const [shownView, setShownView] = useState({ key: viewKey, mode, start: rangeStart.getTime(), motion: "" });
  if (shownView.key !== viewKey) {
    const motion = shownView.mode !== mode ? "animate-view-fade" : rangeStart.getTime() > shownView.start ? "animate-view-next" : "animate-view-prev";
    setShownView({ key: viewKey, mode, start: rangeStart.getTime(), motion });
  }

  const heading = mode === "year"
    ? String(month.getFullYear())
    : mode === "day"
      ? selectedDate.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : mode === "week"
        ? formatWeekRange(week[0], week[6])
        : month.toLocaleDateString([], { month: "long", year: "numeric" });
  const shortHeading = mode === "year"
    ? heading
    : mode === "day"
      ? selectedDate.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : mode === "week"
        ? formatWeekRange(week[0], week[6], "short")
        : month.toLocaleDateString([], { month: "short", year: "numeric" });

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

  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  if (!focusEventId && handledFocus !== null) {
    setHandledFocus(null);
  } else if (focusEventId && focusEventId !== handledFocus) {
    setHandledFocus(focusEventId);
    const target = events.find((event) => event.id === focusEventId);
    if (target) revealEvent(resolveEvent(target, calendars, today, timezone));
  }

  useEffect(() => {
    if (focusEventId) onFocusHandled?.();
  }, [focusEventId, onFocusHandled]);

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
    setAlerts([]);
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
    setRepeatTouched(false);
    setError(null);
    setComposer(true);
  }

  function openEditTask(event: CalendarEvent) {
    setEditingEvent(event);
    setTitle(event.title);
    const openedStart = event.start.includes("T") ? utcToLocalInput(event.start, event.timezone ?? timezone) : event.start;
    setStart(openedStart);
    setOpenedDay(openedStart.slice(0, 10));
    setRepeatTouched(false);
    setEnd(event.end?.includes("T") ? utcToLocalInput(event.end, event.timezone ?? timezone) : event.end ?? "");
    setAllDay(!event.start.includes("T"));
    setNotes(event.notes ?? "");
    setLocation(event.location ?? "");
    setAlerts(event.alerts ?? []);
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

  function touched<T>(set: (value: T) => void): (value: T) => void {
    return (value) => {
      setRepeatTouched(true);
      set(value);
    };
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
      const kept = !repeatTouched && day === openedDay ? editingEvent?.recurrence : undefined;
      if (!kept && pattern && repeatEnd === "date") {
        if (!repeatUntil) {
          setError("Choose the last date the event should repeat on.");
          return;
        }
        if (repeatUntil < day) {
          setError("The repeat end date cannot be before the event start date.");
          return;
        }
      }
      const recurrence: RecurrenceRule | undefined = kept ? kept
        : !pattern ? undefined
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
          alerts,
          // None of these is shown or edited: the composer rebuilds the event from
          // its fields, so without these a save drops every key this build does
          // not own and any stored rule core could not name.
          unreadableRecurrence: recurrence ? undefined : editingEvent?.unreadableRecurrence,
          unreadableAlerts: editingEvent?.unreadableAlerts,
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

  /** Writes a calendar with `changes` applied, keeping every field it does not touch. */
  async function writeCalendar(calendar: Calendar | null, changes: Partial<Omit<Calendar, "id">>): Promise<boolean> {
    if (saving) return false;
    setError(null);
    setSaving(true);
    try {
      await putCalendar(
        session,
        {
          name: calendar?.name ?? "",
          color: calendar?.color ?? nextCalendarColor(calendars),
          favorite: calendar?.favorite ?? false,
          archived: calendar?.archived ?? false,
          raw: calendar?.raw,
          ...changes,
        },
        calendar?.id,
      );
      await onRefresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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
    if (await writeCalendar(calendar, { archived: archiving })) {
      forgetCalendarToggle(calendar.id, archiving ? HIDDEN_CALENDARS : SHOWN_ARCHIVED_CALENDARS);
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
      setEditingCalendar(null);
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
    <main className="flex flex-col pb-[env(safe-area-inset-bottom)] text-text lg:h-[calc(100dvh-var(--sb-header-h,74px))] lg:overflow-hidden lg:pb-0">
      {error && !composer ? (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6">
          {error}
        </p>
      ) : null}
      <div className="sb-shell grid min-h-0 flex-1 lg:h-full" style={sidebar.cols}>
        <SidebarDrawer title="Calendars" sidebar={sidebar}>
          <SidebarHeader
            title="Calendar"
            action={!readOnlyMode ? <button type="button" onClick={() => openNewTask()} className={sidebarHeaderAction} aria-label="Create event"><Icon name="plus" className="h-4 w-4" /></button> : null}
          />
          <CalendarSections
            calendars={activeCals}
            archived={archivedCals}
            isVisible={(calendar) => isCalendarVisible(calendar, hiddenCalendarIds, shownArchivedIds)}
            eventCounts={eventCounts}
            readOnly={readOnlyMode}
            canArchive={activeCals.length > 1}
            busy={busy || saving}
            onToggle={toggleCalendar}
            onShowAll={showAllCalendars}
            onCreate={(name) => writeCalendar(null, { name })}
            onRename={(calendar, name) => writeCalendar(calendar, { name })}
            onRecolor={(calendar, color) => writeCalendar(calendar, { color })}
            onToggleFavorite={(calendar) => void writeCalendar(calendar, { favorite: !calendar.favorite })}
            onToggleArchived={(calendar) => void toggleArchived(calendar)}
            onPurge={(calendar) => { setEditingCalendar(calendar); setConfirmPurgeEvents(true); }}
            onDelete={(calendar) => { setEditingCalendar(calendar); setConfirmDeleteCalendar(true); }}
          />
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

        <section className="@container order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
          <header className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:px-5 lg:px-6 lg:py-3.5 @min-[60rem]:flex-row @min-[60rem]:items-center @min-[60rem]:justify-between @min-[60rem]:gap-4">
            <div className="flex min-w-0 items-center justify-between gap-3 @min-[60rem]:justify-start">
              <h1 className={`min-w-0 ${paneTitle}`}><span className="@max-[36rem]:hidden">{heading}</span><span className="@min-[36rem]:hidden">{shortHeading}</span></h1>
              <div className="flex h-8 shrink-0 items-stretch divide-x divide-line overflow-hidden rounded-lg border border-line @min-[60rem]:order-first">
                <button type="button" onClick={() => shiftView(-1)} className={`flex h-full w-8 items-center justify-center text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`} aria-label={`Previous ${mode}`}><Icon name="chevron" className="h-3.5 w-3.5 rotate-180" /></button>
                <button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today); }} className={`px-3 text-xs font-medium text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}>Today</button>
                <button type="button" onClick={() => shiftView(1)} className={`flex h-full w-8 items-center justify-center text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`} aria-label={`Next ${mode}`}><Icon name="chevron" className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="relative flex items-center gap-2">
              {!readOnlyMode ? <button type="button" onClick={() => openNewTask()} aria-label="New event" className={`${btnHeader} @max-[36rem]:w-8 @max-[36rem]:px-0`}><Icon name="plus" className="h-3.5 w-3.5" /><span className="@max-[36rem]:hidden">New event</span></button> : null}
              <ViewSwitcher mode={mode} onChange={setMode} />
              <EventSearch query={search} results={searchResults} onQueryChange={setSearch} onPick={revealEvent} />
            </div>
          </header>
          <div key={viewKey} className={`flex min-h-0 min-w-0 flex-1 flex-col ${shownView.motion}`}>
          {mode === "month" ? (
            <ExtractedMonthGrid month={month} days={days} weekStart={weekStart} selected={selected} todayKey={todayKey} events={visibleEvents} spans={spans} calendars={calendars} onSelect={selectDay} onAdd={readOnlyMode ? () => undefined : (day) => openNewTask(day)} onEdit={editOccurrence} taskMarks={taskMarks} onOpenTask={onOpenTask} />
          ) : mode === "day" ? (
            <ExtractedDayView day={selectedDate} events={visibleEvents} spans={spans} calendars={calendars} timezone={timezone} todayKey={todayKey} nowMinutes={nowMinutes} onAdd={readOnlyMode ? () => undefined : openNewTask} onEdit={editOccurrence} taskMarks={taskMarks} onOpenTask={onOpenTask} />
          ) : mode === "week" ? (
            <ExtractedWeekView days={week} selected={selected} todayKey={todayKey} events={visibleEvents} spans={spans} calendars={calendars} timezone={timezone} nowMinutes={nowMinutes} onSelect={selectDay} onAdd={readOnlyMode ? () => undefined : openNewTask} onEdit={editOccurrence} taskMarks={taskMarks} onOpenTask={onOpenTask} />
          ) : (
            <ExtractedYearView months={yearMonths} weekStart={weekStart} today={today} selected={selected} events={visibleEvents} spans={spans} onOpenDay={openDay} />
          )}
          </div>
        </section>
      </div>

      {composer ? <TaskDialog editing={editingEvent !== null} title={title} start={start} end={end} notes={notes} location={location} alerts={alerts} participants={participants} contacts={contacts} allDay={allDay} calendarId={eventCalendarId} calendars={composerCalendars} repeatChoice={repeatChoice} customFrequency={customFrequency} customInterval={customInterval} repeatEnd={repeatEnd} repeatCount={repeatCount} repeatUntil={repeatUntil} minRepeatUntil={start.slice(0, 10)} busy={busy} saving={saving} removing={removingEvent} error={error} onClose={() => { if (!saving && !removingEvent) closeTaskDialog(); }} onSave={() => void saveEvent()} onDelete={editingEvent ? () => void removeEvent() : undefined} onTitleChange={setTitle} onStartChange={updateStart} onEndChange={setEnd} onNotesChange={setNotes} onLocationChange={setLocation} onAlertsChange={setAlerts} onParticipantsChange={setParticipants} onAllDayChange={(value) => { if (value !== allDay) setAlerts((current) => retimeAlerts(current, value)); setAllDay(value); }} onCalendarChange={setEventCalendarId} onRepeatChange={touched(setRepeatChoice)} onCustomFrequencyChange={touched(setCustomFrequency)} onCustomIntervalChange={touched(setCustomInterval)} onRepeatEndChange={touched(setRepeatEnd)} onRepeatCountChange={touched(setRepeatCount)} onRepeatUntilChange={touched(setRepeatUntil)} /> : null}
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
          onClose={() => { setConfirmDeleteCalendar(false); setEditingCalendar(null); }}
        />
      ) : null}
      {confirmPurgeEvents && editingCalendar ? (
        <ConfirmDialog
          title="Purge Events"
          heading={`Purge Events from “${editingCalendar.name}”?`}
          body={`This permanently deletes all ${events.filter((event) => event.calendarId === editingCalendar.id).length} event${events.filter((event) => event.calendarId === editingCalendar.id).length === 1 ? "" : "s"} in this calendar. The calendar itself will remain.`}
          confirmLabel="Purge Events"
          onConfirm={() => void purgeEvents()}
          onClose={() => { setConfirmPurgeEvents(false); setEditingCalendar(null); }}
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
    <div>
      <div ref={containerRef} className="relative">
        <div
          className="flex min-h-10 w-full flex-wrap items-center gap-1.5 py-2"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          {participants.map((name, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full bg-surface py-1 pl-2.5 pr-1.5 text-xs text-text">
              {name}
              <button
                type="button"
                onClick={() => removeParticipant(i)}
                className={`relative flex h-4 w-4 items-center justify-center rounded-full text-mute transition-colors hover:bg-elevated hover:text-text hit-area ${focusRing}`}
                aria-label={`Remove ${name}`}
              >
                <Icon name="close" className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Participants"
            placeholder={participants.length === 0 ? "Add people" : "Add another"}
            className="h-7 min-w-24 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-mute"
          />
        </div>
        {open && suggestions.length > 0 ? (
          <div role="listbox" className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
            {suggestions.map((contact, i) => (
              <div
                key={contact.id}
                role="option"
                aria-selected={i === cursor}
                onPointerDown={(e) => { e.preventDefault(); addParticipant(contact.name); }}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition-colors ${i === cursor ? "bg-surface" : "hover:bg-surface/60"}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-text">{contact.name}</span>
                {contact.email ? <span className="shrink-0 text-mute">{contact.email}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const rowGroup = "divide-y divide-line rounded-xl border border-line bg-bg";
const rowControl = "h-10 w-full min-w-0 bg-transparent text-sm text-text outline-none placeholder:text-mute";
const rowValue = "h-10 min-w-0 bg-transparent text-right text-sm tabular-nums text-text outline-none";
const rowInset = "h-8 w-16 rounded-md border border-line bg-panel px-2 text-center text-sm tabular-nums text-text outline-none focus:border-accent-dim";

function FieldRow({ icon, top = false, children }: { icon?: ReactNode; top?: boolean; children: ReactNode }) {
  return (
    <div className={`flex gap-3 px-3.5 transition-colors first:rounded-t-xl last:rounded-b-xl focus-within:bg-surface/30 ${top ? "items-start" : "items-center"}`}>
      <span className={`flex w-4 shrink-0 items-center justify-center text-mute ${top ? "h-10" : ""}`}>{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function RowSelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0 flex-1">
      <select {...props} className={`row-select ${rowControl} cursor-pointer truncate pr-6 ${className}`}>{children}</select>
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex h-10 cursor-pointer items-center justify-between gap-3 text-sm text-text">
      {label}
      <span className="relative inline-flex h-5 w-9 shrink-0">
        <input type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 cursor-pointer appearance-none rounded-full bg-line transition-colors checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg" />
        <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-text shadow-sm transition-transform peer-checked:translate-x-4 peer-checked:bg-bg" />
      </span>
    </label>
  );
}

function TaskDialog({ editing, title, start, end, notes, location, alerts, participants, contacts, allDay, calendarId, calendars, repeatChoice, customFrequency, customInterval, repeatEnd, repeatCount, repeatUntil, minRepeatUntil, busy, saving, removing, error, onClose, onSave, onDelete, onTitleChange, onStartChange, onEndChange, onNotesChange, onLocationChange, onAlertsChange, onParticipantsChange, onAllDayChange, onCalendarChange, onRepeatChange, onCustomFrequencyChange, onCustomIntervalChange, onRepeatEndChange, onRepeatCountChange, onRepeatUntilChange }: { editing: boolean; title: string; start: string; end: string; notes: string; location: string; alerts: EventAlert[]; participants: string[]; contacts: Contact[]; allDay: boolean; calendarId: string; calendars: Calendar[]; repeatChoice: RepeatChoice; customFrequency: "daily" | "weekly" | "monthly" | "yearly"; customInterval: number; repeatEnd: RepeatEnd; repeatCount: number; repeatUntil: string; minRepeatUntil: string; busy: boolean; saving: boolean; removing: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onTitleChange: (value: string) => void; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onNotesChange: (value: string) => void; onLocationChange: (value: string) => void; onAlertsChange: (value: EventAlert[]) => void; onParticipantsChange: (value: string[]) => void; onAllDayChange: (value: boolean) => void; onCalendarChange: (value: string) => void; onRepeatChange: (value: RepeatChoice) => void; onCustomFrequencyChange: (value: "daily" | "weekly" | "monthly" | "yearly") => void; onCustomIntervalChange: (value: number) => void; onRepeatEndChange: (value: "never" | "count" | "date") => void; onRepeatCountChange: (value: number) => void; onRepeatUntilChange: (value: string) => void }) {
  const calendarColor = calendars.find((cal) => cal.id === calendarId)?.color ?? "var(--color-accent)";
  return (
    <Modal title={editing ? "Edit event" : "New event"} onClose={onClose}>
        <div className="event-dialog flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-3 pb-1">
            <span aria-hidden="true" className="h-7 w-1 shrink-0 rounded-full transition-colors" style={{ background: calendarColor }} />
            <input autoFocus value={title} onChange={(e) => onTitleChange(e.target.value)} aria-label="Event title" placeholder="Event title" className="h-10 w-full min-w-0 bg-transparent text-xl font-semibold tracking-tight text-text outline-none placeholder:text-mute/60" />
          </div>

          <div className={rowGroup}>
            <FieldRow icon={<Icon name="clock" />}>
              <Switch label="All day" checked={allDay} onChange={onAllDayChange} />
            </FieldRow>
            <FieldRow>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-mute">Starts</span>
                {allDay
                  ? <input type="date" value={start.slice(0, 10)} onChange={(e) => onStartChange(`${e.target.value}T09:00`)} className={rowValue} />
                  : <input type="datetime-local" value={start} onChange={(e) => onStartChange(e.target.value)} className={rowValue} />}
              </label>
            </FieldRow>
            <FieldRow>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-mute">Ends</span>
                {allDay
                  ? <input type="date" value={end.slice(0, 10) || start.slice(0, 10)} onChange={(e) => onEndChange(`${e.target.value}T23:59`)} className={rowValue} />
                  : <input type="datetime-local" value={end} onChange={(e) => onEndChange(e.target.value)} className={rowValue} />}
              </label>
            </FieldRow>
            <FieldRow icon={<Icon name="repeat" />}>
              <RowSelect aria-label="Repeat event" value={repeatChoice} onChange={(e) => onRepeatChange(e.target.value as RepeatChoice)}>
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="weekday">Every weekday Monday - Friday</option>
                <option value="weekly">Every week on the selected weekday</option>
                <option value="monthly-date">Every month on the selected date</option>
                <option value="monthly-nth">Every month on the ordinal weekday</option>
                <option value="yearly">Every year</option>
                <option value="custom">Custom...</option>
              </RowSelect>
            </FieldRow>
            {repeatChoice === "custom" ? <FieldRow>
              <div className="flex h-10 items-center gap-2 text-sm text-mute">
                Every
                <input type="number" min="1" max="99" aria-label="Repeat interval" value={customInterval} onChange={(e) => onCustomIntervalChange(Number(e.target.value) || 1)} className={rowInset} />
                <select aria-label="Repeat period" value={customFrequency} onChange={(e) => onCustomFrequencyChange(e.target.value as typeof customFrequency)} className={`${rowInset} w-auto cursor-pointer pl-2 pr-7 text-left`}><option value="daily">day(s)</option><option value="weekly">week(s)</option><option value="monthly">month(s)</option><option value="yearly">year(s)</option></select>
              </div>
            </FieldRow> : null}
            {repeatChoice !== "none" ? <FieldRow>
              <div className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-sm text-mute">Until</span>
                <RowSelect aria-label="Repeat until" value={repeatEnd} onChange={(e) => onRepeatEndChange(e.target.value as RepeatEnd)} className="text-right">
                  <option value="never">Forever</option>
                  <option value="count">After a number of occurrences</option>
                  <option value="date">On a date</option>
                </RowSelect>
              </div>
            </FieldRow> : null}
            {repeatChoice !== "none" && repeatEnd === "count" ? <FieldRow>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-mute">Occurrences</span>
                <input type="number" min="1" max="999" value={repeatCount} onChange={(e) => onRepeatCountChange(Number(e.target.value) || 1)} className={rowInset} />
              </label>
            </FieldRow> : null}
            {repeatChoice !== "none" && repeatEnd === "date" ? <FieldRow>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-mute">Last date</span>
                <input type="date" min={minRepeatUntil} value={repeatUntil} onChange={(e) => onRepeatUntilChange(e.target.value)} className={rowValue} />
              </label>
            </FieldRow> : null}
            <FieldRow icon={<Icon name="bell" />}>
              <ReminderField alerts={alerts} allDay={allDay} onChange={onAlertsChange} />
            </FieldRow>
          </div>

          <div className={rowGroup}>
            <FieldRow icon={<span className="h-2.5 w-2.5 rounded-full" style={{ background: calendarColor }} />}>
              <RowSelect aria-label="Calendar" value={calendarId} onChange={(e) => onCalendarChange(e.target.value)}>{calendars.map((cal) => <option key={cal.id} value={cal.id}>{cal.name}</option>)}</RowSelect>
            </FieldRow>
            <FieldRow icon={<Icon name="pin" />}>
              <input value={location} onChange={(e) => onLocationChange(e.target.value)} aria-label="Location" placeholder="Add location" className={rowControl} />
            </FieldRow>
            <FieldRow icon={<Icon name="people" />}>
              <ParticipantPicker participants={participants} contacts={contacts} onChange={onParticipantsChange} />
            </FieldRow>
          </div>

          <div className={rowGroup}>
            <FieldRow icon={<Icon name="text" />} top>
              <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} aria-label="Notes" placeholder="Add notes" rows={2} className="block w-full resize-none bg-transparent py-2.5 text-sm leading-relaxed text-text outline-none placeholder:text-mute" />
            </FieldRow>
          </div>

          {error ? <ErrorMessage size="xs">{error}</ErrorMessage> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <div>{onDelete ? <button type="button" onClick={onDelete} disabled={busy || saving || removing} aria-busy={removing} className={btnDanger}>{removing ? "Deleting…" : "Delete"}</button> : null}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={saving || removing} className={btnSecondary}>Cancel</button>
            <button type="button" onClick={onSave} disabled={busy || saving || removing || !title.trim() || !calendarId} aria-busy={saving} className={btnPrimary}>{saving ? "Saving…" : editing ? "Save changes" : "Save event"}</button>
          </div>
        </div>
    </Modal>
  );
}

const VIEW_MODES: ViewMode[] = ["day", "week", "month", "year"];

function ViewSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const buttons = useRef<Partial<Record<ViewMode, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const node = buttons.current[mode];
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPill({ left: node.offsetLeft, width: node.offsetWidth }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode]);

  return (
    <div className="relative flex h-8 shrink-0 rounded-lg border border-line bg-surface/40 p-0.5 @max-[36rem]:flex-1">
      {pill ? <span aria-hidden="true" className="absolute inset-y-0.5 rounded-md bg-surface shadow-sm transition-[left,width] duration-150 ease-[cubic-bezier(0.2,0,0,1)]" style={{ left: pill.left, width: pill.width }} /> : null}
      {VIEW_MODES.map((item) => (
        <button
          key={item}
          ref={(node) => { buttons.current[item] = node; }}
          type="button"
          onClick={() => onChange(item)}
          aria-pressed={mode === item}
          className={`relative h-full rounded-md px-2.5 text-xs capitalize transition-colors @max-[36rem]:flex-1 ${mode === item ? `font-medium text-text ${pill ? "" : "bg-surface shadow-sm"}` : "text-mute hover:text-text"} ${focusRing}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function ImportProgressModal({ title, description, current, total }: { title: string; description: string; current: number; total: number }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-black/70 p-4 backdrop-blur-md"><section role="dialog" aria-modal="true" className="glow-edge relative animate-scale-in w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/50"><h3 className="text-base font-semibold text-text">{title}</h3><p className="mt-1 text-xs text-mute">{description}</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} /></div><p className="mt-2 text-right text-[11px] tabular-nums text-mute">{total ? `${current} of ${total}` : "Preparing..."}</p></section></div>;
}
