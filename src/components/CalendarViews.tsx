import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Calendar, CalendarEvent } from "../lib/types";
import type { TaskMark } from "../lib/taskCalendar";
import { DEFAULT_CALENDAR_COLOR } from "../lib/types";
import {
  buildDaySlots,
  dateFromKey,
  type EventSpan,
  formatHour,
  HOUR_HEIGHT,
  keyFor,
  monthDays,
  sameDay,
  weekdayIndex,
  weekdayLabels,
  type WeekStart,
  timedEventsForDay,
} from "../lib/calendarModel";
import { isLegibleOnDark, tint } from "../lib/colour";
import { Icon } from "./Icon";
import { focusRing } from "../lib/styles";

type TaskMarks = Map<string, TaskMark[]>;

const MAX_MONTH_TASK_MARKS = 2;

function TaskChip({ mark, onOpen }: { mark: TaskMark; onOpen?: (id: string) => void }) {
  const open = () => onOpen?.(mark.id);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Open task ${mark.title}`}
      onClick={(click) => { click.stopPropagation(); open(); }}
      onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); keyEvent.stopPropagation(); open(); } }}
      className={`block h-4 w-full truncate rounded px-1 text-[11px] font-medium leading-4 transition-colors hover:bg-surface ${mark.overdue ? "text-danger" : "text-mute hover:text-text"}`}
    >
      <Icon name="checkbox" className="mr-1 inline-block h-3 w-3 align-[-2px]" />
      {mark.timeLabel ? <span className="mr-1 opacity-60">{mark.timeLabel}</span> : null}
      {mark.title}
    </span>
  );
}

type MonthGridProps = {
  month: Date;
  days: Date[];
  weekStart: WeekStart;
  selected: string;
  todayKey: string;
  events: CalendarEvent[];
  spans: Map<string, EventSpan>;
  calendars: Calendar[];
  onSelect: (day: Date) => void;
  onAdd: (day: Date) => void;
  onEdit: (event: CalendarEvent) => void;
  taskMarks?: TaskMarks;
  onOpenTask?: (id: string) => void;
};

function eventSegmentClass(span: EventSpan, day: Date): string {
  if (!span.bar) {
    return "relative z-10 block h-4 truncate rounded px-1 text-[11px] font-medium leading-4 text-text transition-colors hover:bg-surface";
  }
  const dayKey = keyFor(day);
  const startsHere = span.startKey === dayKey;
  const endsHere = span.endKey === dayKey;
  const left = startsHere ? "rounded-l-md pl-1.5" : "-ml-1.5 rounded-l-none pl-3";
  const right = endsHere ? "rounded-r-md pr-1.5" : "-mr-[7px] rounded-r-none pr-2";
  return `relative z-10 block h-4 truncate text-[11px] font-medium leading-4 transition-colors ${left} ${right}`;
}



function eventSegmentStyle(span: EventSpan, day: Date, color: string): CSSProperties | undefined {
  if (!span.bar) return undefined;
  const startsHere = span.startKey === keyFor(day);
  return {
    backgroundColor: tint(color, 0.22),
    color: isLegibleOnDark(color) ? color : "var(--color-text)",
    boxShadow: startsHere ? `inset 2px 0 0 ${color}` : undefined,
  };
}

export function MonthGrid({ month, days, weekStart, selected, todayKey, events, spans, calendars, onSelect, onAdd, onEdit, taskMarks, onOpenTask }: MonthGridProps) {
  const daySlotsMap = useMemo(() => buildDaySlots(days, events, spans), [days, events, spans]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="grid grid-cols-7 border-b border-line bg-panel/40">
          {weekdayLabels(weekStart).map((day) => <div key={day} className={`py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] @max-[36rem]:tracking-normal ${day === "Sun" || day === "Sat" ? "text-mute/60" : "text-mute"}`}>{day}</div>)}
        </div>
        <div className="grid flex-1 grid-cols-7 grid-rows-6">
          {days.map((day) => {
            const key = keyFor(day);
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const isOtherMonth = day.getMonth() !== month.getMonth();
            const isToday = key === todayKey;
            const isSelected = key === selected;
            const slots = daySlotsMap.get(key) || [];
            return (
              <button key={key} type="button" onClick={() => onSelect(day)} onDoubleClick={() => onAdd(day)} className={`cal-cell relative flex min-h-0 flex-col items-stretch justify-start border-b border-r border-line p-1.5 text-left transition-colors ${isOtherMonth ? "bg-panel/40 text-mute/60" : isWeekend ? "bg-panel/60 text-text/70" : "bg-bg text-text"} ${isToday ? "cal-today" : ""} ${isSelected ? "z-10 ring-1 ring-inset ring-accent/60" : "hover:bg-surface/30"} outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring`}>
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${isToday ? "bg-accent font-semibold text-bg" : ""}`}>{day.getDate()}</span>
                <span className="mt-0.5 block space-y-0.5">
                  {slots.slice(0, 4).map((event, slotIndex) => {
                    if (!event) return <span key={`empty-${slotIndex}`} className="block h-4 w-full" />;
                    const span = spans.get(event.id);
                    if (!span) return <span key={`missing-${slotIndex}`} className="block h-4 w-full" />;
                    const color = calendars.find((calendar) => calendar.id === event.calendarId)?.color;
                    const startsHere = span.startKey === key;
                    const showText = startsHere || weekdayIndex(day, weekStart) === 0 || !span.bar;
                    return (
                      <span key={event.id} role="button" tabIndex={0} onClick={(click) => { click.stopPropagation(); onEdit(event); }} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); keyEvent.stopPropagation(); onEdit(event); } }} className={eventSegmentClass(span, day)} style={eventSegmentStyle(span, day, color ?? DEFAULT_CALENDAR_COLOR)}>
                        {!span.bar && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: color ?? DEFAULT_CALENDAR_COLOR }} />}
                        {!span.bar && <span className="mr-1 opacity-60 @max-[48rem]:hidden">{span.timeLabel}</span>}
                        {showText ? event.title : "\u00A0"}
                      </span>
                    );
                  })}
                  {(taskMarks?.get(key) ?? []).slice(0, MAX_MONTH_TASK_MARKS).map((mark) => <TaskChip key={mark.id} mark={mark} onOpen={onOpenTask} />)}
                  {(taskMarks?.get(key)?.length ?? 0) > MAX_MONTH_TASK_MARKS ? <span className="block text-[10px] text-mute">{`+${(taskMarks?.get(key)?.length ?? 0) - MAX_MONTH_TASK_MARKS} more tasks`}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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

function firstEventMinutes(days: Date[], events: CalendarEvent[], spans: Map<string, EventSpan>, timezone: string): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const day of days) {
    for (const block of timedEventsForDay(events, spans, day, timezone)) earliest = Math.min(earliest, block.startMinutes);
  }
  return Number.isFinite(earliest) ? earliest : 8 * 60;
}

function HourGutter() {
  return <div className="w-12 shrink-0 border-r border-line @min-[36rem]:w-16">{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="relative border-b border-line/40" style={{ height: HOUR_HEIGHT }}><span className="absolute right-2 top-1 text-[10px] tabular-nums text-mute">{formatHour(hour)}</span></div>)}</div>;
}

function NowIndicator({ minutes }: { minutes: number }) {
  return <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (minutes / 60) * HOUR_HEIGHT }}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" /><span className="h-px flex-1 bg-danger" /></div>;
}

type TimelineProps = {
  events: CalendarEvent[];
  spans: Map<string, EventSpan>;
  calendars: Calendar[];
  timezone: string;
  todayKey: string;
  nowMinutes: number;
  onAdd: (day: Date, hour: number) => void;
  onEdit: (event: CalendarEvent) => void;
  taskMarks?: TaskMarks;
  onOpenTask?: (id: string) => void;
};

function DayColumn({ day, events, spans, calendars, timezone, todayKey, nowMinutes, onAdd, onEdit }: TimelineProps & { day: Date }) {
  const blocks = useMemo(() => timedEventsForDay(events, spans, day, timezone), [day, events, spans, timezone]);
  const isToday = keyFor(day) === todayKey;
  const dayLabel = day.toLocaleDateString([], { day: "numeric", month: "long" });
  return (
    <div className={`relative min-w-0 flex-1 border-r border-line last:border-r-0 ${isToday ? "bg-accent-glow" : ""}`}>
      {Array.from({ length: 24 }, (_, hour) => <button key={hour} type="button" onClick={() => onAdd(day, hour)} className="block w-full border-b border-line/40 transition-colors hover:bg-surface/30" style={{ height: HOUR_HEIGHT }} aria-label={`Add event on ${dayLabel} at ${formatHour(hour)}`} />)}
      {blocks.map((block) => {
        const color = calendars.find((calendar) => calendar.id === block.event.calendarId)?.color ?? DEFAULT_CALENDAR_COLOR;
        const duration = block.endMinutes - block.startMinutes;
        const laneWidth = 100 / block.lanes;
        const compact = duration < 45;
        return <button key={block.event.id} type="button" onClick={() => onEdit(block.event)} className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent-ring" style={{ top: (block.startMinutes / 60) * HOUR_HEIGHT, height: Math.max((duration / 60) * HOUR_HEIGHT - 2, 16), left: `calc(${block.lane * laneWidth}% + 2px)`, width: `calc(${laneWidth}% - 4px)`, backgroundColor: tint(color, 0.22), color: isLegibleOnDark(color) ? color : "var(--color-text)", boxShadow: `inset 2px 0 0 ${color}` }}><span className={`block truncate font-medium ${compact ? "" : "mb-0.5"}`}>{block.event.title}</span>{compact ? null : <span className="block truncate opacity-70">{spans.get(block.event.id)?.timeLabel}</span>}</button>;
      })}
      {isToday ? <NowIndicator minutes={nowMinutes} /> : null}
    </div>
  );
}

function AllDayStrip({ days, events, spans, calendars, taskMarks, onEdit, onOpenTask }: { days: Date[]; events: CalendarEvent[]; spans: Map<string, EventSpan>; calendars: Calendar[]; taskMarks?: TaskMarks; onEdit: (event: CalendarEvent) => void; onOpenTask?: (id: string) => void }) {
  const slots = useMemo(() => buildDaySlots(days, events.filter((event) => spans.get(event.id)?.bar), spans), [days, events, spans]);
  const rows = days.reduce((most, day) => Math.max(most, (slots.get(keyFor(day)) ?? []).filter(Boolean).length), 0);
  const markRows = days.reduce((most, day) => Math.max(most, taskMarks?.get(keyFor(day))?.length ?? 0), 0);
  if (rows === 0 && markRows === 0) return null;
  return <div className="flex shrink-0 border-b border-line"><div className="w-12 shrink-0 border-r border-line @min-[36rem]:w-16 py-1.5 pr-2 text-right text-[10px] uppercase leading-tight tracking-[0.14em] text-mute @max-[36rem]:tracking-normal">All day</div><div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>{days.map((day) => { const key = keyFor(day); const daySlots = slots.get(key) ?? []; return <div key={key} className="min-w-0 space-y-0.5 border-r border-line p-1.5 last:border-r-0">{Array.from({ length: rows }, (_, index) => { const event = daySlots[index]; if (!event) return <span key={`empty-${index}`} className="block h-4 w-full" />; const span = spans.get(event.id); if (!span) return <span key={`missing-${index}`} className="block h-4 w-full" />; const color = calendars.find((calendar) => calendar.id === event.calendarId)?.color ?? DEFAULT_CALENDAR_COLOR; const showText = span.startKey === key || key === keyFor(days[0]); return <span key={event.id} role="button" tabIndex={0} onClick={() => onEdit(event)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); onEdit(event); } }} className={eventSegmentClass(span, day)} style={eventSegmentStyle(span, day, color)}>{showText ? event.title : "\u00A0"}</span>; })}{(taskMarks?.get(key) ?? []).map((mark) => <TaskChip key={mark.id} mark={mark} onOpen={onOpenTask} />)}</div>; })}</div></div>;
}

export function DayView({ day, events, spans, calendars, timezone, todayKey, nowMinutes, onAdd, onEdit, taskMarks, onOpenTask }: TimelineProps & { day: Date }) {
  const isToday = keyFor(day) === todayKey;
  const scrollRef = useTimelineScroll(keyFor(day), firstEventMinutes([day], events, spans, timezone));
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-baseline gap-2 border-b border-line px-5 py-2.5 lg:px-6"><span className={`text-sm font-semibold ${isToday ? "text-accent" : "text-text"}`}>{day.toLocaleDateString([], { weekday: "long" })}</span><span className="text-xs text-mute">{day.toLocaleDateString([], { day: "numeric", month: "long" })}</span></div><AllDayStrip days={[day]} events={events} spans={spans} calendars={calendars} taskMarks={taskMarks} onEdit={onEdit} onOpenTask={onOpenTask} /><div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto"><div className="flex"><HourGutter /><DayColumn day={day} events={events} spans={spans} calendars={calendars} timezone={timezone} todayKey={todayKey} nowMinutes={nowMinutes} onAdd={onAdd} onEdit={onEdit} /></div></div></div>;
}

export function WeekView({ days, selected, onSelect, ...timeline }: TimelineProps & { days: Date[]; selected: string; onSelect: (day: Date) => void }) {
  const scrollRef = useTimelineScroll(keyFor(days[0]), firstEventMinutes(days, timeline.events, timeline.spans, timeline.timezone));
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="flex shrink-0 border-b border-line"><div className="w-12 shrink-0 border-r border-line @min-[36rem]:w-16" /><div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>{days.map((day) => { const key = keyFor(day); const isToday = key === timeline.todayKey; const isSelected = key === selected; return <button key={key} type="button" onClick={() => onSelect(day)} className={`flex flex-col items-center gap-1 border-r border-line py-2 transition-colors last:border-r-0 hover:bg-surface/30 ${isSelected ? "bg-surface/20" : ""}`}><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute @max-[36rem]:tracking-normal">{day.toLocaleDateString([], { weekday: "short" })}</span><span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? "bg-accent font-semibold text-bg" : isSelected ? "font-semibold text-text" : "text-text"}`}>{day.getDate()}</span></button>; })}</div></div><AllDayStrip days={days} events={timeline.events} spans={timeline.spans} calendars={timeline.calendars} taskMarks={timeline.taskMarks} onEdit={timeline.onEdit} onOpenTask={timeline.onOpenTask} /><div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto"><div className="flex"><HourGutter />{days.map((day) => <DayColumn key={keyFor(day)} day={day} {...timeline} />)}</div></div></div></div>;
}

function YearMonth({ month, weekStart, today, selected, markedDays, onOpenDay }: { month: Date; weekStart: WeekStart; today: Date; selected: string; markedDays: Set<string>; onOpenDay: (day: Date) => void }) {
  const cells = useMemo(() => monthDays(month, weekStart), [month, weekStart]);
  const isCurrentMonth = month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
  return <div><p className={`mb-2 text-sm font-semibold ${isCurrentMonth ? "text-accent" : "text-text"}`}>{month.toLocaleDateString([], { month: "long" })}</p><div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px]">{weekdayLabels(weekStart, "narrow").map((label, index) => <span key={`${label}-${index}`} className="pb-1 font-semibold text-mute/70">{label}</span>)}{cells.map((day) => { const key = keyFor(day); if (day.getMonth() !== month.getMonth()) return <span key={key} />; const isToday = sameDay(day, today); const isSelected = key === selected; const marked = markedDays.has(key); return <button key={key} type="button" onClick={() => onOpenDay(day)} className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-colors ${isToday ? "bg-accent font-semibold text-bg" : isSelected ? "bg-surface font-medium text-text" : "text-text hover:bg-surface"} ${focusRing}`} aria-label={day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>{day.getDate()}{marked && !isToday ? <i className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" /> : null}</button>; })}</div></div>;
}

export function YearView({ months, weekStart, today, selected, events, spans, onOpenDay }: { months: Date[]; weekStart: WeekStart; today: Date; selected: string; events: CalendarEvent[]; spans: Map<string, EventSpan>; onOpenDay: (day: Date) => void }) {
  const markedDays = useMemo(() => {
    const marked = new Set<string>();
    for (const event of events) {
      const span = spans.get(event.id);
      if (!span) continue;
      const cursor = dateFromKey(span.startKey);
      for (let step = 0; step < 366; step += 1) {
        const key = keyFor(cursor);
        if (key > span.endKey) break;
        marked.add(key);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return marked;
  }, [events, spans]);
  return <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6"><div className="grid gap-x-7 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{months.map((month) => <YearMonth key={month.getMonth()} month={month} weekStart={weekStart} today={today} selected={selected} markedDays={markedDays} onOpenDay={onOpenDay} />)}</div></div>;
}
