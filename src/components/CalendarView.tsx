import { useMemo, useState } from "react";
import {
  deleteCalendarEvent,
  putCalendar,
  putCalendarEvent,
  type Session,
} from "../lib/client";
import type { Calendar, CalendarEvent } from "../lib/types";

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

function eventCoversDay(event: CalendarEvent, day: Date): boolean {
  const dayKey = keyFor(day);
  const startKey = event.start.slice(0, 10);
  const endKey = event.end?.slice(0, 10) || startKey;
  return dayKey >= startKey && dayKey <= endKey;
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

function Icon({ name, className = "h-4 w-4" }: { name: "plus" | "search" | "chevron" | "x" | "eye" | "eyeOff"; className?: string }) {
  const content = {
    plus: <path d="M8 2.5v11M2.5 8h11" />,
    search: <><circle cx="6.5" cy="6.5" r="4" /><path d="m10 10 3.5 3.5" /></>,
    chevron: <path d="m6.5 3.5 5 5-5 5" />,
    x: <><path d="m3.5 3.5 9 9M12.5 3.5l-9 9" /></>,
    eye: <><path d="M1.5 8s2.25-4 6.5-4 6.5 4 6.5 4-2.25 4-6.5 4-6.5-4-6.5-4Z" /><circle cx="8" cy="8" r="1.75" /></>,
    eyeOff: <><path d="m2.5 2.5 11 11M6.6 4.2C7.05 4.07 7.52 4 8 4c4.25 0 6.5 4 6.5 4a12.5 12.5 0 0 1-2.08 2.48M4.3 5.3C2.57 6.3 1.5 8 1.5 8s2.25 4 6.5 4c.48 0 .95-.07 1.4-.2" /></>,
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
  onRefresh,
}: {
  session: Session;
  calendars: Calendar[];
  events: CalendarEvent[];
  busy: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => monthDays(month), [month]);
  const filtered = useMemo(
    () => events.filter((event) => !event.calendarId || !hiddenCalendarIds.has(event.calendarId))
      .filter((event) => event.title.toLowerCase().includes(search.trim().toLowerCase())),
    [events, hiddenCalendarIds, search],
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
    setAllDay(false);
    setEventCalendarId(calendars[0]?.id ?? "");
    setError(null);
    setComposer(true);
  }

  function openEditTask(event: CalendarEvent) {
    setEditingEvent(event);
    setTitle(event.title);
    setStart(event.start);
    setEnd(event.end ?? "");
    setAllDay(!event.start.includes("T"));
    setNotes(event.notes ?? "");
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
          start: allDay ? day : start,
          end: allDay ? end.slice(0, 10) || day : end || undefined,
          notes: notes.trim() || undefined,
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
      await putCalendar(session, { name: calendarName.trim(), color: calendarColor });
      setCalendarName("");
      setCalendarColor("#7aa2f7");
      setCalendarComposer(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="calendar-view -mt-6 min-h-[calc(100vh-74px)] overflow-hidden bg-bg text-text">
      <div className="grid min-h-[calc(100vh-74px)] lg:grid-cols-[244px_minmax(0,1fr)]">
        <aside className="bg-panel px-6 py-7 lg:min-h-full">
          <div className="flex items-center justify-between">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-mute">My calendar</p><h2 className="mt-1 text-lg font-semibold">Calendar</h2></div>
            <button type="button" onClick={openNewTask} className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-text hover:bg-elevated" aria-label="Create event"><Icon name="plus" /></button>
          </div>
          <MiniMonth month={month} selected={selected} events={filtered} onSelect={selectDay} />
          <div className="mt-8 border-t border-line pt-5">
            <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-mute">Calendars</p><button type="button" onClick={() => setCalendarComposer(true)} className="flex h-6 w-6 items-center justify-center rounded-md text-mute hover:bg-surface hover:text-text" aria-label="Add calendar"><Icon name="plus" /></button></div>
            <div className="mt-3 space-y-3">{calendars.length === 0 ? <p className="text-xs text-mute">No calendars yet.</p> : calendars.map((calendar) => { const hidden = hiddenCalendarIds.has(calendar.id); return <div key={calendar.id} className={`flex items-center gap-2 text-xs ${hidden ? "text-mute" : "text-text"}`}><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} /><span className="min-w-0 flex-1 truncate">{calendar.name}</span><button type="button" onClick={() => toggleCalendar(calendar.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mute hover:bg-surface hover:text-text" aria-label={`${hidden ? "Show" : "Hide"} ${calendar.name} calendar`} title={`${hidden ? "Show" : "Hide"} calendar`}><Icon name={hidden ? "eyeOff" : "eye"} className="h-3.5 w-3.5" /></button></div>; })}</div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-panel px-5 py-4 lg:px-8">
            <div className="flex items-center gap-2"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-mute hover:bg-surface" aria-label="Previous month"><Icon name="chevron" /></button><button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today); }} className="h-8 rounded-md border border-line px-3 text-xs text-mute hover:bg-surface">Today</button><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-mute hover:bg-surface" aria-label="Next month"><Icon name="chevron" /></button><h1 className="ml-2 text-lg font-semibold">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h1></div>
            <div className="flex items-center gap-3"><div className="relative hidden sm:block"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="h-8 w-48 rounded-md border border-line bg-bg pl-9 pr-3 text-xs text-text outline-none placeholder:text-mute focus:border-accent" /></div><div className="flex rounded-md border border-line bg-bg p-0.5">{(["day", "week", "month", "year"] as ViewMode[]).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`h-7 px-3 text-[11px] capitalize ${mode === item ? "rounded bg-accent font-semibold text-bg" : "text-mute hover:text-text"}`}>{item}</button>)}</div></div>
          </header>
          <div className="flex items-center justify-between border-b border-line bg-bg px-5 py-2.5 lg:px-8"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">{filtered.length} event{filtered.length === 1 ? "" : "s"}</p><button type="button" onClick={openNewTask} className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-text"><Icon name="plus" /> New event</button></div>
          {mode === "month" ? <MonthGrid month={month} days={days} selected={selected} todayKey={todayKey} events={filtered} calendars={calendars} onSelect={selectDay} onEdit={openEditTask} /> : <div className="p-10 text-sm text-mute">{mode[0].toUpperCase() + mode.slice(1)} view is ready for the next calendar iteration.</div>}
        </section>
      </div>

      {composer ? <TaskDialog editing={editingEvent !== null} title={title} start={start} end={end} notes={notes} allDay={allDay} calendarId={eventCalendarId} calendars={calendars} busy={busy} error={error} onClose={closeTaskDialog} onSave={() => void saveEvent()} onDelete={editingEvent ? () => void removeEvent() : undefined} onTitleChange={setTitle} onStartChange={setStart} onEndChange={setEnd} onNotesChange={setNotes} onAllDayChange={setAllDay} onCalendarChange={setEventCalendarId} /> : null}
      {calendarComposer ? <CalendarDialog name={calendarName} color={calendarColor} busy={busy} error={error} onClose={() => setCalendarComposer(false)} onSave={() => void saveCalendar()} onNameChange={setCalendarName} onColorChange={setCalendarColor} /> : null}
    </main>
  );
}

function eventSegmentClass(event: CalendarEvent, day: Date): string {
  const dayKey = keyFor(day);
  const startsHere = event.start.slice(0, 10) === dayKey;
  const endsHere = (event.end?.slice(0, 10) || event.start.slice(0, 10)) === dayKey;
  return `relative z-10 -mx-2 block truncate bg-surface px-2 py-1 text-[10px] font-medium text-text ${startsHere ? "rounded-l-sm" : "rounded-l-none"} ${endsHere ? "rounded-r-sm" : "rounded-r-none"}`;
}

function MonthGrid({ month, days, selected, todayKey, events, calendars, onSelect, onEdit }: { month: Date; days: Date[]; selected: string; todayKey: string; events: CalendarEvent[]; calendars: Calendar[]; onSelect: (day: Date) => void; onEdit: (event: CalendarEvent) => void }) {
  return <div className="overflow-x-auto"><div className="min-w-[720px]"><div className="grid grid-cols-7 border-b border-line bg-panel">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-mute">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => { const key = keyFor(day); const dayEvents = events.filter((event) => eventCoversDay(event, day)); return <button key={key} type="button" onClick={() => onSelect(day)} className={`relative min-h-[112px] border-b border-r border-line bg-bg p-2 text-left align-top hover:bg-surface ${day.getMonth() !== month.getMonth() ? "bg-panel text-mute/50" : "text-text"} ${key === selected ? "z-10 ring-2 ring-inset ring-accent" : ""}`}><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${key === todayKey ? "bg-accent font-semibold text-bg" : ""}`}>{day.getDate()}</span><span className="mt-1 block space-y-1">{dayEvents.slice(0, 3).map((event) => <span key={event.id} role="button" tabIndex={0} onClick={(click) => { click.stopPropagation(); onEdit(event); }} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); keyEvent.stopPropagation(); onEdit(event); } }} className={eventSegmentClass(event, day)} style={{ backgroundColor: calendars.find((calendar) => calendar.id === event.calendarId)?.color }}>{event.title}</span>)}</span></button>; })}</div></div></div>;
}

function TaskDialog({ editing, title, start, end, notes, allDay, calendarId, calendars, busy, error, onClose, onSave, onDelete, onTitleChange, onStartChange, onEndChange, onNotesChange, onAllDayChange, onCalendarChange }: { editing: boolean; title: string; start: string; end: string; notes: string; allDay: boolean; calendarId: string; calendars: Calendar[]; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onDelete?: () => void; onTitleChange: (value: string) => void; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onNotesChange: (value: string) => void; onAllDayChange: (value: boolean) => void; onCalendarChange: (value: string) => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"><section className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">{editing ? "Edit task" : "New task"}</p><h3 className="mt-1 text-lg font-semibold">{editing ? "Edit task" : "Add task"}</h3></div><button type="button" onClick={onClose} className="text-mute hover:text-text" aria-label="Close"><Icon name="x" /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-medium text-mute">Task title<input autoFocus value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Task title" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Calendar<select value={calendarId} onChange={(event) => onCalendarChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent">{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-text"><input type="checkbox" checked={allDay} onChange={(event) => onAllDayChange(event.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />All day</label>{allDay ? <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-mute">Starts<input type="date" value={start.slice(0, 10)} onChange={(event) => onStartChange(`${event.target.value}T09:00`)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Ends<input type="date" value={end.slice(0, 10) || start.slice(0, 10)} onChange={(event) => onEndChange(`${event.target.value}T23:59`)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label></div> : <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-mute">Starts<input type="datetime-local" value={start} onChange={(event) => onStartChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Ends<input type="datetime-local" value={end} onChange={(event) => onEndChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /></label></div>}<label className="block text-xs font-medium text-mute">Notes<textarea value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Optional notes" className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-line bg-bg p-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label>{error ? <p className="text-xs text-danger">{error}</p> : null}<div className="flex items-center gap-3 pt-1">{onDelete ? <button type="button" onClick={onDelete} disabled={busy} className="rounded-lg border border-danger/50 px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50">Delete</button> : null}<button type="button" onClick={onSave} disabled={busy || !title.trim() || !calendarId} className="ml-auto rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50">{editing ? "Save changes" : "Save task"}</button></div></div></section></div>;
}

function CalendarDialog({ name, color, busy, error, onClose, onSave, onNameChange, onColorChange }: { name: string; color: string; busy: boolean; error: string | null; onClose: () => void; onSave: () => void; onNameChange: (value: string) => void; onColorChange: (value: string) => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"><section className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">New calendar</p><h3 className="mt-1 text-lg font-semibold">Create calendar</h3></div><button type="button" onClick={onClose} className="text-mute hover:text-text" aria-label="Close"><Icon name="x" /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-medium text-mute">Name<input autoFocus value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Personal" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Colour<div className="mt-1.5 flex items-center gap-3"><input type="color" value={color} onChange={(event) => onColorChange(event.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-line bg-bg p-1" /><span className="font-mono text-xs text-mute">{color}</span></div></label>{error ? <p className="text-xs text-danger">{error}</p> : null}<button type="button" onClick={onSave} disabled={busy || !name.trim()} className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50">Create calendar</button></div></section></div>;
}

function MiniMonth({ month, selected, events, onSelect }: { month: Date; selected: string; events: CalendarEvent[]; onSelect: (day: Date) => void }) {
  const days = monthDays(month);
  return <div className="mt-5"><div className="mb-3 flex items-center justify-between text-[11px] font-semibold"><span>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span><span className="text-[9px] uppercase tracking-[0.16em] text-mute">{month.toLocaleDateString([], { month: "short" })}</span></div><div className="grid grid-cols-7 gap-y-1 text-center text-[9px] text-mute">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}{days.map((day) => { const key = keyFor(day); const marked = events.some((event) => eventCoversDay(event, day)); return <button key={key} type="button" onClick={() => onSelect(day)} className={`relative flex h-6 items-center justify-center rounded-full text-[10px] ${day.getMonth() === month.getMonth() ? "text-text" : "text-mute/40"} ${selected === key ? "bg-accent font-bold text-bg" : "hover:bg-surface"}`}><span>{day.getDate()}</span>{marked && selected !== key ? <i className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-accent" /> : null}</button>; })}</div></div>;
}
