import { useMemo, useState } from "react";
import { putCalendar, putCalendarEvent, type Session } from "../lib/client";
import type { Calendar, CalendarEvent } from "../lib/types";

type ViewMode = "day" | "week" | "month" | "year";
const colors = ["bg-sky-100 text-sky-950", "bg-lime-100 text-lime-950", "bg-orange-100 text-orange-950", "bg-rose-100 text-rose-950"];

function keyFor(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
function Icon({ name, className = "h-4 w-4" }: { name: "plus" | "search" | "chevron" | "x"; className?: string }) {
  const content = { plus: <path d="M8 2.5v11M2.5 8h11" />, search: <><circle cx="6.5" cy="6.5" r="4" /><path d="m10 10 3.5 3.5" /></>, chevron: <path d="m6.5 3.5 5 5-5 5" />, x: <><path d="m3.5 3.5 9 9M12.5 3.5l-9 9" /></> }[name];
  const resolvedClassName = name === "search"
    ? `${className} pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute`
    : className;
  return <svg className={resolvedClassName} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{content}</svg>;
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

export function CalendarView({ session, calendars, events, busy, onRefresh }: { session: Session; calendars: Calendar[]; events: CalendarEvent[]; busy: boolean; onRefresh: () => Promise<void> }) {
  const today = new Date();
  const todayKey = keyFor(today);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);
  const [mode, setMode] = useState<ViewMode>("month");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
  const [calendarComposer, setCalendarComposer] = useState(false);
  const [calendarName, setCalendarName] = useState("");
  const [calendarColor, setCalendarColor] = useState("#7aa2f7");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(`${todayKey}T09:00`);
  const [end, setEnd] = useState(`${todayKey}T10:00`);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => monthDays(month), [month]);
  const filtered = useMemo(() => events.filter((event) => event.title.toLowerCase().includes(search.trim().toLowerCase())), [events, search]);

  function selectDay(day: Date) {
    const key = keyFor(day);
    setSelected(key); setStart(`${key}T09:00`); setEnd(`${key}T10:00`);
    if (day.getMonth() !== month.getMonth()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }
  function showToday() { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); selectDay(today); }
  async function saveEvent() {
    if (!title.trim()) return;
    setError(null);
    try { await putCalendarEvent(session, { title: title.trim(), start, end: end || undefined, notes: notes.trim() || undefined }); setTitle(""); setNotes(""); setComposer(false); await onRefresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
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
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-mute">My calendar</p><h2 className="mt-1 text-lg font-semibold">Calendar</h2></div><button type="button" onClick={() => setComposer(true)} className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-text hover:bg-elevated" aria-label="Create event"><Icon name="plus" /></button></div>
          <MiniMonth month={month} selected={selected} events={filtered} onSelect={selectDay} />
          <div className="mt-8 border-t border-line pt-5"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-mute">Calendars</p><button type="button" onClick={() => setCalendarComposer(true)} className="flex h-6 w-6 items-center justify-center rounded-md text-mute hover:bg-surface hover:text-text" aria-label="Add calendar"><Icon name="plus" /></button></div><div className="mt-3 space-y-3">{calendars.length === 0 ? <p className="text-xs text-mute">No calendars yet.</p> : calendars.map((calendar) => <p key={calendar.id} className="flex items-center gap-2 truncate text-xs text-text"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} />{calendar.name}</p>)}</div></div>
        </aside>
        <section className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-panel px-5 py-4 lg:px-8"><div className="flex items-center gap-2"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-mute hover:bg-surface" aria-label="Previous month"><Icon name="chevron" /></button><button type="button" onClick={showToday} className="h-8 rounded-md border border-line px-3 text-xs text-mute hover:bg-surface">Today</button><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-mute hover:bg-surface" aria-label="Next month"><Icon name="chevron" /></button><h1 className="ml-2 text-lg font-semibold">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h1></div><div className="flex items-center gap-3"><div className="relative hidden sm:block"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="h-8 w-48 rounded-md border border-line bg-bg pl-9 pr-3 text-xs text-text outline-none placeholder:text-mute focus:border-accent" /></div><div className="flex rounded-md border border-line bg-bg p-0.5">{(["day", "week", "month", "year"] as ViewMode[]).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`h-7 px-3 text-[11px] capitalize ${mode === item ? "rounded bg-accent font-semibold text-bg" : "text-mute hover:text-text"}`}>{item}</button>)}</div></div></header>
          <div className="flex items-center justify-between border-b border-line bg-bg px-5 py-2.5 lg:px-8"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">{filtered.length} event{filtered.length === 1 ? "" : "s"}</p><button type="button" onClick={() => setComposer(true)} className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-text"><Icon name="plus" /> New event</button></div>
          {mode === "month" ? <div className="overflow-x-auto"><div className="min-w-[720px]"><div className="grid grid-cols-7 border-b border-line bg-panel">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-mute">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => { const key = keyFor(day); const dayEvents = filtered.filter((event) => event.start.slice(0, 10) === key); return <button key={key} type="button" onClick={() => selectDay(day)} className={`relative min-h-[112px] border-b border-r border-line bg-bg p-2 text-left align-top hover:bg-surface ${day.getMonth() !== month.getMonth() ? "bg-panel text-mute/50" : "text-text"} ${key === selected ? "z-10 ring-2 ring-inset ring-accent" : ""}`}><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${key === todayKey ? "bg-accent font-semibold text-bg" : ""}`}>{day.getDate()}</span><span className="mt-1 block space-y-1">{dayEvents.slice(0, 3).map((event, index) => <span key={event.id} className={`block truncate rounded-sm px-1.5 py-1 text-[10px] font-medium ${colors[index % colors.length]}`}>{event.title}</span>)}</span></button>; })}</div></div></div> : <div className="p-10 text-sm text-mute">{mode[0].toUpperCase() + mode.slice(1)} view is ready for the next calendar iteration.</div>}
        </section>
      </div>
      {composer ? <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 p-4 sm:items-center"><section className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">New event</p><h3 className="mt-1 text-lg font-semibold">Add event</h3></div><button type="button" onClick={() => setComposer(false)} className="text-mute hover:text-text" aria-label="Close"><Icon name="x" /></button></div><div className="mt-5 space-y-3"><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-mute focus:border-accent" /><input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /><input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" /><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" className="min-h-24 w-full rounded-lg border border-line bg-bg p-3 text-sm outline-none placeholder:text-mute focus:border-accent" />{error ? <p className="text-xs text-danger">{error}</p> : null}<button type="button" onClick={() => void saveEvent()} disabled={busy || !title.trim()} className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50">Save event</button></div></section></div> : null}
      {calendarComposer ? <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 p-4 sm:items-center"><section className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">New calendar</p><h3 className="mt-1 text-lg font-semibold">Create calendar</h3></div><button type="button" onClick={() => setCalendarComposer(false)} className="text-mute hover:text-text" aria-label="Close"><Icon name="x" /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-medium text-mute">Name<input autoFocus value={calendarName} onChange={(event) => setCalendarName(event.target.value)} placeholder="Personal" className="mt-1.5 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-mute focus:border-accent" /></label><label className="block text-xs font-medium text-mute">Colour<div className="mt-1.5 flex items-center gap-3"><input type="color" value={calendarColor} onChange={(event) => setCalendarColor(event.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-line bg-bg p-1" /><span className="font-mono text-xs text-mute">{calendarColor}</span></div></label>{error ? <p className="text-xs text-danger">{error}</p> : null}<button type="button" onClick={() => void saveCalendar()} disabled={busy || !calendarName.trim()} className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50">Create calendar</button></div></section></div> : null}
    </main>
  );
}

function MiniMonth({ month, selected, events, onSelect }: { month: Date; selected: string; events: CalendarEvent[]; onSelect: (day: Date) => void }) {
  const days = monthDays(month);
  return <div className="mt-5"><div className="mb-3 flex items-center justify-between text-[11px] font-semibold"><span>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span><span className="text-[9px] uppercase tracking-[0.16em] text-mute">{month.toLocaleDateString([], { month: "short" })}</span></div><div className="grid grid-cols-7 gap-y-1 text-center text-[9px] text-mute">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}{days.map((day) => { const key = keyFor(day); const marked = events.some((event) => event.start.slice(0, 10) === key); return <button key={key} type="button" onClick={() => onSelect(day)} className={`relative flex h-6 items-center justify-center rounded-full text-[10px] ${day.getMonth() === month.getMonth() ? "text-text" : "text-mute/40"} ${selected === key ? "bg-accent font-bold text-bg" : "hover:bg-surface"}`}><span>{day.getDate()}</span>{marked && selected !== key ? <i className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-accent" /> : null}</button>; })}</div></div>;
}
