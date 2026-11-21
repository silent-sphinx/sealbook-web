import { useEffect, useMemo, useState, type ReactNode } from "react";
import { bookmarkHost, bookmarkHref } from "../lib/bookmark";
import { dateFromKey, keyFor } from "../lib/calendarModel";
import { notePreview } from "../lib/note";
import {
  AGENDA_DAYS,
  UPCOMING_DATES_WINDOW,
  agendaDays,
  greeting,
  recentBookmarks,
  recentNotes,
  upcomingDates,
  type UpcomingDate,
} from "../lib/overview";
import { dueLabel, taskAgenda } from "../lib/task";
import { eyebrow, focusRing, linkAction, viewMain } from "../lib/styles";
import type { Bookmark, Calendar, CalendarEvent, Contact, FeatureKey, Note, Task } from "../lib/types";
import type { SearchKind } from "../lib/vaultSearch";
import { Avatar } from "./ContactCard";
import { Icon, type IconName } from "./Icon";

const AGENDA_LIMIT = 10;
const TASK_LIMIT = 8;
const DATES_LIMIT = 6;
const RECENT_LIMIT = 5;

type Props = {
  username: string;
  features: FeatureKey[];
  contacts: Contact[];
  calendars: Calendar[];
  events: CalendarEvent[];
  tasks: Task[];
  notes: Note[];
  bookmarks: Bookmark[];
  timezone: string;
  onOpenItem: (kind: SearchKind, id: string) => void;
  onOpenFeature: (feature: FeatureKey) => void;
};

/** The current time, moved on each minute so the day and the overdue line keep up. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function dayHeading(key: string, todayKey: string): string {
  const day = dateFromKey(key);
  const delta = Math.round((day.getTime() - dateFromKey(todayKey).getTime()) / 86_400_000);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function whenAway(daysAway: number, key: string): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  const day = dateFromKey(key);
  return daysAway < 7
    ? day.toLocaleDateString(undefined, { weekday: "short" })
    : day.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function dateDetail({ kind, label, years }: UpcomingDate): string {
  if (years === null) return label;
  return kind === "birthday" ? `${label} · turns ${years}` : `${label} · ${plural(years, "year")}`;
}

function sameDay(iso: string | undefined, key: string): boolean {
  const parsed = iso ? Date.parse(iso) : NaN;
  return !Number.isNaN(parsed) && keyFor(new Date(parsed)) === key;
}

function shortDate(iso: string | undefined): string {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const rowButton = `flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover ${focusRing}`;

function Card({
  id,
  title,
  icon,
  openLabel,
  onOpen,
  className = "",
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  openLabel: string;
  onOpen: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`flex min-w-0 flex-col rounded-xl border border-line bg-surface/40 p-3 ${className}`}
    >
      <header className="mb-2 flex items-center gap-2 px-2 pt-1">
        <Icon name={icon} className="size-4 text-mute" />
        <h2 id={id} className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {title}
        </h2>
        <button type="button" onClick={onOpen} className={`${linkAction} inline-flex items-center gap-0.5`}>
          {openLabel}
          <Icon name="chevron" className="size-3" />
        </button>
      </header>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-2 py-3 text-xs text-mute">{children}</p>;
}

function More({ count, noun, onOpen }: { count: number; noun: string; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <button type="button" onClick={onOpen} className={`${linkAction} mx-2 mt-1 self-start`}>
      {plural(count, `more ${noun}`, `more ${noun}s`)}
    </button>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
  warn = false,
  onOpen,
}: {
  icon: IconName;
  label: string;
  value: number;
  detail: string;
  warn?: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full min-w-0 cursor-pointer flex-col gap-1 rounded-xl border border-line bg-surface/40 p-3 text-left transition-colors hover:border-line-light hover:bg-surface ${focusRing}`}
      >
        <span className="flex items-center gap-1.5 text-xs text-mute">
          <Icon name={icon} className="size-3.5" />
          {label}
        </span>
        <span className="text-xl font-semibold tabular-nums tracking-tight text-text">{value}</span>
        <span className={`truncate text-2xs ${warn ? "font-medium text-warning" : "text-mute"}`}>{detail}</span>
      </button>
    </li>
  );
}

/**
 * The landing page: what is coming up and what changed lately, across every
 * feature the account has switched on. Read-only; every row opens the item in
 * its own view, where it is edited.
 */
export function OverviewView({
  username,
  features,
  contacts,
  calendars,
  events,
  tasks,
  notes,
  bookmarks,
  timezone,
  onOpenItem,
  onOpenFeature,
}: Props) {
  const now = useNow();
  const todayKey = keyFor(now);
  const on = (feature: FeatureKey) => features.includes(feature);

  const activeContacts = useMemo(() => contacts.filter((contact) => !contact.archived), [contacts]);
  const contactById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  // Keyed on the day rather than the minute, so the recurrence expansion runs once a day.
  const agenda = useMemo(
    () => agendaDays(events, calendars, dateFromKey(todayKey), timezone),
    [events, calendars, todayKey, timezone],
  );
  const dates = useMemo(() => upcomingDates(contacts, dateFromKey(todayKey)), [contacts, todayKey]);
  const due = useMemo(() => taskAgenda(tasks, now, timezone), [tasks, now, timezone]);
  const latestNotes = useMemo(() => recentNotes(notes, RECENT_LIMIT), [notes]);
  const latestBookmarks = useMemo(() => recentBookmarks(bookmarks, RECENT_LIMIT), [bookmarks]);

  const todayEvents = agenda[0]?.entries.length ?? 0;
  const weekEvents = new Set(agenda.flatMap((day) => day.entries.map((entry) => entry.id))).size;
  const openTasks = tasks.filter((task) => !task.done).length;
  const datesThisWeek = dates.filter((date) => date.daysAway < 7).length;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const bookmarksThisWeek = bookmarks.filter((bookmark) => {
    const at = Date.parse(bookmark.createdAt ?? "");
    return !Number.isNaN(at) && at >= weekAgo;
  }).length;
  const notesToday = notes.filter((note) => sameDay(note.updatedAt, todayKey)).length;

  // Today is always shown, so an empty one can say so; later days only when busy.
  let agendaShown = 0;
  const agendaGroups = agenda
    .filter((day, index) => index === 0 || day.entries.length > 0)
    .map((day) => {
      const room = Math.max(0, AGENDA_LIMIT - agendaShown);
      const entries = day.entries.slice(0, room);
      agendaShown += entries.length;
      return { ...day, entries };
    })
    .filter((day, index) => index === 0 || day.entries.length > 0);
  const agendaTotal = agenda.reduce((sum, day) => sum + day.entries.length, 0);

  const taskSections = [
    { key: "overdue", label: "Overdue", ids: due.overdue, warn: true },
    { key: "today", label: "Today", ids: due.today, warn: false },
    { key: "soon", label: "Next 7 days", ids: [...due.tomorrow, ...due.week], warn: false },
  ];
  let tasksShown = 0;
  const taskGroups = taskSections
    .map((section) => {
      const room = Math.max(0, TASK_LIMIT - tasksShown);
      const rows = section.ids
        .map((id) => taskById.get(id))
        .filter((task): task is Task => task !== undefined)
        .slice(0, room);
      tasksShown += rows.length;
      return { ...section, rows };
    })
    .filter((section) => section.rows.length > 0);
  const tasksDueTotal = taskSections.reduce((sum, section) => sum + section.ids.length, 0);

  const dateLine = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <main className={viewMain} aria-labelledby="overview-title">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
          <div>
            <h1 id="overview-title" className="text-xl font-semibold tracking-tight text-text">
              {greeting(now)}
              {username ? `, ${username}` : ""}
            </h1>
            <p className="mt-0.5 text-sm text-mute">{dateLine}</p>
          </div>

          <ul aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {on("calendar") ? (
              <Stat
                icon="calendar"
                label="Today"
                value={todayEvents}
                detail={`${plural(weekEvents, "event")} in ${AGENDA_DAYS} days`}
                onOpen={() => onOpenFeature("calendar")}
              />
            ) : null}
            {on("tasks") ? (
              <Stat
                icon="tasks"
                label="Open tasks"
                value={openTasks}
                detail={
                  due.overdue.length > 0
                    ? `${due.overdue.length} overdue`
                    : `${due.today.length} due today`
                }
                warn={due.overdue.length > 0}
                onOpen={() => onOpenFeature("tasks")}
              />
            ) : null}
            {on("contacts") ? (
              <Stat
                icon="user"
                label="Contacts"
                value={activeContacts.length}
                detail={datesThisWeek > 0 ? `${plural(datesThisWeek, "date")} this week` : "No dates this week"}
                onOpen={() => onOpenFeature("contacts")}
              />
            ) : null}
            {on("notes") ? (
              <Stat
                icon="page"
                label="Notes"
                value={notes.length}
                detail={`${notesToday} edited today`}
                onOpen={() => onOpenFeature("notes")}
              />
            ) : null}
            {on("bookmarks") ? (
              <Stat
                icon="bookmark"
                label="Bookmarks"
                value={bookmarks.length}
                detail={`${bookmarksThisWeek} saved this week`}
                onOpen={() => onOpenFeature("bookmarks")}
              />
            ) : null}
          </ul>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {on("calendar") ? (
              <Card
                id="overview-agenda"
                title="Coming up"
                icon="calendar"
                openLabel="Calendar"
                onOpen={() => onOpenFeature("calendar")}
              >
                <div className="flex flex-col gap-3">
                  {agendaGroups.map((day) => (
                    <div key={day.key}>
                      <h3 className={`px-2 pb-1 ${eyebrow}`}>{dayHeading(day.key, todayKey)}</h3>
                      {day.entries.length === 0 ? (
                        <Quiet>Nothing scheduled.</Quiet>
                      ) : (
                        <ul>
                          {day.entries.map((entry) => (
                            <li key={entry.id}>
                              <button type="button" onClick={() => onOpenItem("event", entry.eventId)} className={rowButton}>
                                <span
                                  aria-hidden="true"
                                  className="h-4 w-1 shrink-0 rounded-full bg-accent"
                                  style={entry.color ? { backgroundColor: entry.color } : undefined}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm text-text">{entry.title}</span>
                                <span className="shrink-0 text-2xs tabular-nums text-mute">{entry.time ?? "All day"}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <More count={agendaTotal - agendaShown} noun="event" onOpen={() => onOpenFeature("calendar")} />
              </Card>
            ) : null}

            {on("tasks") ? (
              <Card id="overview-tasks" title="Due soon" icon="tasks" openLabel="Tasks" onOpen={() => onOpenFeature("tasks")}>
                {taskGroups.length === 0 ? (
                  <Quiet>Nothing due in the next {AGENDA_DAYS} days.</Quiet>
                ) : (
                  <div className="flex flex-col gap-3">
                    {taskGroups.map((section) => (
                      <div key={section.key}>
                        <h3 className={`px-2 pb-1 ${eyebrow} ${section.warn ? "text-warning" : ""}`}>{section.label}</h3>
                        <ul>
                          {section.rows.map((task) => (
                            <li key={task.id}>
                              <button type="button" onClick={() => onOpenItem("task", task.id)} className={rowButton}>
                                <span
                                  aria-hidden="true"
                                  className={`size-3.5 shrink-0 rounded-full border ${section.warn ? "border-warning" : "border-line-light"}`}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm text-text">{task.title}</span>
                                <span className={`shrink-0 text-2xs tabular-nums ${section.warn ? "text-warning" : "text-mute"}`}>
                                  {dueLabel(task, now, timezone)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <More count={tasksDueTotal - tasksShown} noun="task" onOpen={() => onOpenFeature("tasks")} />
              </Card>
            ) : null}

            {on("contacts") ? (
              <Card
                id="overview-dates"
                title="Birthdays and dates"
                icon="user"
                openLabel="Contacts"
                onOpen={() => onOpenFeature("contacts")}
              >
                {dates.length === 0 ? (
                  <Quiet>No birthdays or anniversaries in the next {UPCOMING_DATES_WINDOW} days.</Quiet>
                ) : (
                  <ul>
                    {dates.slice(0, DATES_LIMIT).map((date) => (
                      <li key={date.id}>
                        <button type="button" onClick={() => onOpenItem("contact", date.contactId)} className={rowButton}>
                          <span aria-hidden="true" className="contents">
                            <Avatar name={date.name} avatar={contactById.get(date.contactId)?.avatar} size="sm" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-text">{date.name}</span>
                            <span className="block truncate text-2xs text-mute">
                              {dateDetail(date)}
                            </span>
                          </span>
                          <span className={`shrink-0 text-2xs ${date.daysAway === 0 ? "font-medium text-accent" : "text-mute"}`}>
                            {whenAway(date.daysAway, date.key)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <More count={dates.length - DATES_LIMIT} noun="date" onOpen={() => onOpenFeature("contacts")} />
              </Card>
            ) : null}

            {on("notes") ? (
              <Card id="overview-notes" title="Recent notes" icon="page" openLabel="Notes" onOpen={() => onOpenFeature("notes")}>
                {latestNotes.length === 0 ? (
                  <Quiet>No notes yet.</Quiet>
                ) : (
                  <ul>
                    {latestNotes.map((note) => (
                      <li key={note.id}>
                        <button type="button" onClick={() => onOpenItem("note", note.id)} className={rowButton}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-text">{note.title || "Untitled note"}</span>
                            <span className="block truncate text-2xs text-mute">{notePreview(note.body, 90) || "Empty note"}</span>
                          </span>
                          <span className="shrink-0 text-2xs text-mute">{shortDate(note.updatedAt ?? note.createdAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}

            {on("bookmarks") ? (
              <Card
                id="overview-bookmarks"
                title="Recent bookmarks"
                icon="bookmark"
                openLabel="Bookmarks"
                onOpen={() => onOpenFeature("bookmarks")}
              >
                {latestBookmarks.length === 0 ? (
                  <Quiet>No bookmarks yet.</Quiet>
                ) : (
                  <ul>
                    {latestBookmarks.map((bookmark) => {
                      const href = bookmarkHref(bookmark.url);
                      const body = (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-text">{bookmark.title}</span>
                            <span className="block truncate text-2xs text-mute">{bookmarkHost(bookmark.url)}</span>
                          </span>
                          <span className="shrink-0 text-2xs text-mute">{shortDate(bookmark.createdAt ?? bookmark.updatedAt)}</span>
                        </>
                      );
                      return (
                        <li key={bookmark.id}>
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer noopener" className={rowButton}>
                              {body}
                            </a>
                          ) : (
                            <button type="button" onClick={() => onOpenItem("bookmark", bookmark.id)} className={rowButton}>
                              {body}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
