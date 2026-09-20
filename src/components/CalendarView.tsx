import { useMemo, useState } from "react";
import {
  deleteCalendarEvent,
  putCalendar,
  putCalendarEvent,
  type Session,
} from "../lib/client";
import type { Calendar, CalendarEvent } from "../lib/types";
import { localInputToUtc, utcToLocalInput } from "../lib/timezone";

type ViewMode = "day" | "week" | "month" | "year";

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

function Icon({ name, className = "h-4 w-4" }: { name: "plus" | "search" | "chevron" | "x" | "eye" | "eyeOff" | "pencil"; className?: string }) {
  const content = {
    plus: <path d="M8 2.5v11M2.5 8h11" />,
    search: <><circle cx="6.5" cy="6.5" r="4" /><path d="m10 10 3.5 3.5" /></>,
    chevron: <path d="m6.5 3.5 5 5-5 5" />,
    x: <><path d="m3.5 3.5 9 9M12.5 3.5l-9 9" /></>,
    eye: <><path d="M1.5 8s2.25-4 6.5-4 6.5 4 6.5 4-2.25 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="1.75" /></>,
    eyeOff: <><path d="m2.5 2.5 11 11M6.6 4.2C7.05 4.07 7.52 4 8 4c4.25 0 6.5 4 6.5 4a12.5 12.5 0 0 1-2.08 2.48M4.3 5.3C2.57 6.3 1.5 8 1.5 8s2.25 4 6.5 4c.48 0 .95-.07 1.4-.2" /></>,
    pencil: <><path d="m10.75 2.75 2.5 2.5M3 13l1.5-3.75 6.25-6.25a1.77 1.77 0 0 1 2.5 2.5L7 11.75 3 13Z" /></>,
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
}: {
  session: Session;
  calendars: Calendar[];
  events: CalendarEvent[];
  busy: boolean;
  timezone: string;
  onRefresh: () => Promise<void>;
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
  const [calendarColor, setCalendarColor] = useState("#7aa2f7");
  const [eventCalendarId, setEventCalendarId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(`${todayKey}T09:00`);
  const [end, setEnd] = useState(`${todayKey}T10:00`);
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState("");
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => monthDays(month), [month]);
  const filtered = useMemo(
    () => events.filter((event) => !event.calendarId || !hiddenCalendarIds.has(event.calendarId))
      .filter((event) => event.title.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        const aStart = a.start;
        const bStart = b.start;
        if (aStart !== bStart) return aStart.localeCompare(bStart);
        const aEnd = a.end || a.start;
        const bEnd = b.end || b.start;
        return bEnd.localeCompare(aEnd);
      }),
    [events, hiddenCalendarIds, search],
  );
  const spans = useMemo(
    () => new Map(filtered.map((event) => [event.id, computeSpan(event, timezone)] as const)),
    [filtered, timezone],
  );

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

  function openNewCalendar() {
    setEditingCalendar(null);
    setCalendarName("");
    setCalendarColor("#7aa2f7");
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
    if (day.getMonth() !== month.getMonth()) {
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }

  function openNewTask() {
    setEditingEvent(null);
    setTitle("");
    setNotes("");
    setLocation("");
    setParticipants("");
    setAllDay(false);
    setEventCalendarId(calendars[0]?.id ?? "");
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
    setError(null);
    setComposer(true);
  }

  function closeTaskDialog() {
    setComposer(false);
    setEditingEvent(null);
    setError(null);
  }

  async function saveEvent() {
    if (!title.trim() || calendars.length === 0) return;
    setError(null);
    try {
      const day = start.slice(0, 10);
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
      await putCalendar(session, { name: calendarName.trim(), color: calendarColor }, editingCalendar?.id);
      setCalendarName("");
      setCalendarColor("#7aa2f7");
      setEditingCalendar(null);
      setCalendarComposer(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="calendar-view -mt-6 h-[calc(100vh-74px)] overflow-hidden bg-bg text-text">
      <div className="grid h-full lg:grid-cols-[244px_minmax(0,1fr)]">
        <aside className="overflow-y-auto bg-panel px-6 py-7">
          <div className="flex items-center justify-between">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-mute">My calendar</p><h2 className="mt-1 text-lg font-semibold">Calendar</h2></div>
            <button type="button" onClick={openNewTask} className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-text hover:bg-elevated" aria-label="Create event"><Icon name="plus" /></button>
          </div>
          <MiniMonth month={month} selected={selected} events={filtered} spans={spans} onSelect={selectDay} />
          <div className="mt-8 border-t border-line pt-5">
            <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-mute">Calendars</p><button type="button" onClick={openNewCalendar} className="flex h-6 w-6 items-center justify-center rounded-md text-mute hover:bg-surface hover:text-text" aria-label="Add calendar"><Icon name="plus" /></button></div>
            <div className="mt-3 space-y-2.5">{calendars.length === 0 ? <p className="text-xs text-mute">No calendars yet.</p> : calendars.map((calendar) => { const hidden = hiddenCalendarIds.has(calendar.id); return <div key={calendar.id} className={`flex items-center gap-2.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-surface/50 ${hidden ? "text-mute opacity-50" : "text-text"}`}><i className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10" style={{ backgroundColor: calendar.color }} /><span className="min-w-0 flex-1 truncate font-medium">{calendar.name}</span><button type="button" onClick={() => openEditCalendar(calendar)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text" aria-label={`Edit ${calendar.name} calendar`} title="Edit calendar"><Icon name="pencil" className="h-3.5 w-3.5" /></button><button type="button" onClick={() => toggleCalendar(calendar.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text" aria-label={`${hidden ? "Show" : "Hide"} ${calendar.name} calendar`} title={`${hidden ? "Show" : "Hide"} calendar`}><Icon name={hidden ? "eyeOff" : "eye"} className="h-3.5 w-3.5" /></button></div>; })}</div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-panel px-5 py-3 lg:px-8">
            <div className="flex items-center gap-2"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-mute transition-colors hover:bg-surface hover:text-text" aria-label="Previous month"><Icon name="chevron" className="h-3.5 w-3.5 rotate-180" /></button><button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today); }} className="h-7 rounded-md border border-line px-3 text-[11px] font-medium text-mute transition-colors hover:bg-surface hover:text-text">Today</button><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-mute transition-colors hover:bg-surface hover:text-text" aria-label="Next month"><Icon name="chevron" className="h-3.5 w-3.5" /></button><h1 className="ml-3 text-base font-bold tracking-tight">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h1><span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-mute">{filtered.length}</span></div>
            <div className="flex items-center gap-3"><button type="button" onClick={openNewTask} className="flex h-7 items-center gap-1.5 rounded-md bg-accent/10 px-3 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20"><Icon name="plus" className="h-3.5 w-3.5" />New event</button><div className="relative hidden sm:block"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="h-7 w-40 rounded-md border border-line bg-bg pl-8 pr-3 text-[11px] text-text outline-none placeholder:text-mute focus:border-accent" /></div><div className="flex rounded-md border border-line bg-bg p-0.5">{(["day", "week", "month", "year"] as ViewMode[]).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`h-6 px-2.5 text-[10px] font-medium capitalize transition-colors ${mode === item ? "rounded bg-accent font-semibold text-bg" : "text-mute hover:text-text"}`}>{item}</button>)}</div></div>
          </header>
          {mode === "month" ? <MonthGrid month={month} days={days} selected={selected} todayKey={todayKey} events={filtered} spans={spans} calendars={calendars} onSelect={selectDay} onEdit={openEditTask} /> : <div className="flex-1 p-10 text-sm text-mute">{mode[0].toUpperCase() + mode.slice(1)} view is ready for the next calendar iteration.</div>}
        </section>
      </div>

      {composer ? <TaskDialog editing={editingEvent !== null} title={title} start={start} end={end} notes={notes} location={location} participants={participants} allDay={allDay} calendarId={eventCalendarId} calendars={calendars} busy={busy} error={error} onClose={closeTaskDialog} onSave={() => void saveEvent()} onDelete={editingEvent ? () => void removeEvent() : undefined} onTitleChange={setTitle} onStartChange={setStart} onEndChange={setEnd} onNotesChange={setNotes} onLocationChange={setLocation} onParticipantsChange={setParticipants} onAllDayChange={setAllDay} onCalendarChange={setEventCalendarId} /> : null}
      {calendarComposer ? <CalendarDialog editing={editingCalendar !== null} name={calendarName} color={calendarColor} busy={busy} error={error} onClose={() => { setCalendarComposer(false); setEditingCalendar(null); }} onSave={() => void saveCalendar()} onNameChange={setCalendarName} onColorChange={setCalendarColor} /> : null}
    </main>
  );
}

function eventSegmentClass(span: EventSpan, day: Date): string {
  // Single-day timed events: dot + time + title, no solid bar.
  if (!span.bar) {
    return "relative z-10 block h-4 truncate rounded px-1 text-[10px] font-medium leading-4 text-text transition-colors hover:bg-surface";
  }
  const dayKey = keyFor(day);
  const startsHere = span.startKey === dayKey;
  const endsHere = span.endKey === dayKey;

  // Cells have 6px padding (p-1.5) plus a 1px right border, so a continuing
  // segment bridges 6px on its left and 7px on its right, with no overlap.
  const left = startsHere ? "rounded-l pl-1.5" : "-ml-1.5 rounded-l-none pl-3";
  const right = endsHere ? "rounded-r pr-1.5" : "-mr-[7px] rounded-r-none pr-2";

  return `relative z-10 block h-4 truncate text-[10px] font-semibold leading-4 text-white/90 transition-opacity hover:opacity-90 ${left} ${right}`;
}

function MonthGrid({ month, days, selected, todayKey, events, spans, calendars, onSelect, onEdit }: { month: Date; days: Date[]; selected: string; todayKey: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; onSelect: (day: Date) => void; onEdit: (event: CalendarEvent) => void }) {
  const daySlotsMap = useMemo(() => {
    const map = new Map<string, (CalendarEvent | null)[]>();
    const activeSlots: (CalendarEvent | null)[] = [];

    for (const day of days) {
      const dayKey = keyFor(day);
      // Bars sort ahead of single-day timed events so they claim the top slots.
      // Array.sort is stable, so the existing order is kept otherwise.
      const dEvents = events
        .filter((e) => {
          const span = spans.get(e.id);
          return span ? spanCoversDay(span, day) : false;
        })
        .sort((a, b) => Number(spans.get(b.id)?.bar ?? false) - Number(spans.get(a.id)?.bar ?? false));

      for (let i = 0; i < activeSlots.length; i++) {
        if (activeSlots[i] && !dEvents.some(e => e.id === activeSlots[i]!.id)) {
          activeSlots[i] = null;
        }
      }

      for (const e of dEvents) {
        if (!activeSlots.some(a => a && a.id === e.id)) {
          let placed = false;
          for (let i = 0; i < activeSlots.length; i++) {
            if (!activeSlots[i]) {
              activeSlots[i] = e;
              placed = true;
              break;
            }
          }
          if (!placed) {
            activeSlots.push(e);
          }
        }
      }

      while (activeSlots.length > 0 && activeSlots[activeSlots.length - 1] === null) {
        activeSlots.pop();
      }

      map.set(dayKey, [...activeSlots]);
    }
    return map;
  }, [days, events, spans]);

  return <div className="flex min-w-0 flex-1 flex-col overflow-x-auto"><div className="flex min-w-[720px] flex-1 flex-col"><div className="grid grid-cols-7 border-b border-line bg-panel">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => <div key={day} className={`py-2 text-center text-[10px] font-semibold uppercase tracking-widest ${i === 0 || i === 6 ? "text-mute/60" : "text-mute"}`}>{day}</div>)}</div><div className="cal-grid grid flex-1 grid-cols-7 grid-rows-6">{days.map((day) => { const key = keyFor(day); const isWeekend = day.getDay() === 0 || day.getDay() === 6; const isOtherMonth = day.getMonth() !== month.getMonth(); const isToday = key === todayKey; const isSelected = key === selected; const slots = daySlotsMap.get(key) || []; return <button key={key} type="button" onClick={() => onSelect(day)} className={`cal-cell relative flex min-h-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left transition-colors ${isOtherMonth ? "bg-[#191919] text-mute/30" : isWeekend ? "bg-[#1a1a1c] text-text/70" : "bg-bg text-text"} ${isToday ? "cal-today" : ""} ${isSelected ? "z-10 ring-2 ring-inset ring-accent" : "hover:brightness-125"}`}><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${isToday ? "bg-accent font-bold text-bg" : ""}`}>{day.getDate()}</span><span className="mt-0.5 block space-y-0.5">{slots.slice(0, 4).map((event, slotIndex) => { if (!event) return <span key={`empty-${slotIndex}`} className="block h-4 w-full" />; const span = spans.get(event.id); if (!span) return <span key={`missing-${slotIndex}`} className="block h-4 w-full" />; const color = calendars.find((calendar) => calendar.id === event.calendarId)?.color; const startsHere = span.startKey === key; const showText = startsHere || day.getDay() === 0 || !span.bar; return <span key={event.id} role="button" tabIndex={0} onClick={(click) => { click.stopPropagation(); onEdit(event); }} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); keyEvent.stopPropagation(); onEdit(event); } }} className={eventSegmentClass(span, day)} style={span.bar ? { backgroundColor: color ?? "var(--color-accent)" } : undefined}>{!span.bar && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color ?? "var(--color-accent)" }} />}{!span.bar && <span className="mr-1 opacity-60">{span.timeLabel}</span>}{showText ? event.title : "\u00A0"}</span>; })}</span></button>; })}</div></div></div>;
}

function LegacyEventDialog({ editing, title, start, end, notes, allDay, calendarId, calendars, busy, error, onClose, onSave, onDelete, onTitleChange, onStartChange, onEndChange, onNotesChange, onAllDayChange, onCalendarChange }: { editing: boolean; title: string; start: string; end: string; notes: string; allDay: boolean; calendarId: string; calendars: Calendar[]; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onTitleChange: (value: string) => void; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onNotesChange: (value: string) => void; onAllDayChange: (value: boolean) => void; onCalendarChange: (value: string) => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"><section className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">{editing ? "Edit task" : "New task"}</p><h3 className="mt-1 text-lg font-semibold">{editing ? "Edit task" : "Add task"}</h3></div><button type="button" onClick={onClose} className="text-mute hover:text-text" aria-label="Close"><Icon name="x" /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-medium text-mute">Task title<input autoFocus value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Task title" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Calendar<select value={calendarId} onChange={(event) => onCalendarChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent">{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-text"><input type="checkbox" checked={allDay} onChange={(event) => onAllDayChange(event.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />All day</label>{allDay ? <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-mute">Starts<input type="date" value={start.slice(0, 10)} onChange={(event) => onStartChange(`${event.target.value}T09:00`)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Ends<input type="date" value={end.slice(0, 10) || start.slice(0, 10)} onChange={(event) => onEndChange(`${event.target.value}T23:59`)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label></div> : <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-mute">Starts<input type="datetime-local" value={start} onChange={(event) => onStartChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Ends<input type="datetime-local" value={end} onChange={(event) => onEndChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label></div>}<label className="block text-xs font-medium text-mute">Notes<textarea value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Optional notes" className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-line bg-bg p-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label>{error ? <p className="text-xs text-danger">{error}</p> : null}<div className="flex items-center gap-3 pt-1">{onDelete ? <button type="button" onClick={onDelete} disabled={busy} className="rounded-lg border border-danger/50 px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50">Delete</button> : null}<button type="button" onClick={onSave} disabled={busy || !title.trim() || !calendarId} className="ml-auto rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50">{editing ? "Save changes" : "Save task"}</button></div></div></section></div>;
}

void LegacyEventDialog;

function TaskDialog({ editing, title, start, end, notes, location, participants, allDay, calendarId, calendars, busy, error, onClose, onSave, onDelete, onTitleChange, onStartChange, onEndChange, onNotesChange, onLocationChange, onParticipantsChange, onAllDayChange, onCalendarChange }: { editing: boolean; title: string; start: string; end: string; notes: string; location: string; participants: string; allDay: boolean; calendarId: string; calendars: Calendar[]; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onTitleChange: (value: string) => void; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onNotesChange: (value: string) => void; onLocationChange: (value: string) => void; onParticipantsChange: (value: string) => void; onAllDayChange: (value: boolean) => void; onCalendarChange: (value: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <section className="event-dialog w-full max-w-[480px] animate-scale-in rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-[15px] font-semibold">{editing ? "Edit event" : "New event"}</h3>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text" aria-label="Close"><Icon name="x" /></button>
        </div>

        {/* Body */}
        <div className="space-y-3 px-5 py-4">
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

          {/* Notes */}
          <label className="block text-[11px] font-medium text-mute">
            Notes
            <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} placeholder="Optional notes" rows={2} className="mt-1 w-full resize-y rounded-lg border border-line bg-bg p-2.5 text-xs leading-relaxed outline-none placeholder:text-mute focus:border-accent" />
          </label>

          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
          <div>{onDelete ? <button type="button" onClick={onDelete} disabled={busy} className="rounded-lg border border-danger/50 px-3.5 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50">Delete</button> : null}</div>
          <button type="button" onClick={onSave} disabled={busy || !title.trim() || !calendarId} className="rounded-lg bg-accent px-5 py-2 text-xs font-semibold text-bg transition-all hover:brightness-110 disabled:opacity-50">{editing ? "Save changes" : "Save event"}</button>
        </div>
      </section>
    </div>
  );
}

function CalendarDialog({ editing, name, color, busy, error, onClose, onSave, onNameChange, onColorChange }: { editing: boolean; name: string; color: string; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onNameChange: (value: string) => void; onColorChange: (value: string) => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"><section className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">{editing ? "Edit calendar" : "New calendar"}</p><h3 className="mt-1 text-lg font-semibold">{editing ? "Edit calendar" : "Create calendar"}</h3></div><button type="button" onClick={onClose} className="text-mute hover:text-text" aria-label="Close"><Icon name="x" /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-medium text-mute">Name<input autoFocus value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Personal" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Colour<div className="mt-1.5 flex items-center gap-3"><input type="color" value={color} onChange={(event) => onColorChange(event.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-line bg-bg p-1" /><span className="font-mono text-xs text-mute">{color}</span></div></label>{error ? <p className="text-xs text-danger">{error}</p> : null}<button type="button" onClick={onSave} disabled={busy || !name.trim()} className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50">{editing ? "Save changes" : "Create calendar"}</button></div></section></div>;
}

function MiniMonth({ month, selected, events, spans, onSelect }: { month: Date; selected: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; onSelect: (day: Date) => void }) {
  const days = monthDays(month);
  return <div className="mt-5"><div className="mb-3 flex items-center justify-between text-[11px] font-semibold"><span>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span><span className="text-[9px] uppercase tracking-[0.16em] text-mute">{month.toLocaleDateString([], { month: "short" })}</span></div><div className="grid grid-cols-7 gap-y-1 text-center text-[9px] text-mute">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}{days.map((day) => { const key = keyFor(day); const marked = events.some((event) => { const span = spans.get(event.id); return span ? spanCoversDay(span, day) : false; }); return <button key={key} type="button" onClick={() => onSelect(day)} className={`relative flex h-6 items-center justify-center rounded-full text-[10px] ${day.getMonth() === month.getMonth() ? "text-text" : "text-mute/40"} ${selected === key ? "bg-accent font-bold text-bg" : "hover:bg-surface"}`}><span>{day.getDate()}</span>{marked && selected !== key ? <i className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-accent" /> : null}</button>; })}</div></div>;
}