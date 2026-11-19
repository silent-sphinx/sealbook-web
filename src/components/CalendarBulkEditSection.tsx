import { useId, useMemo, useState } from "react";

import type { Session } from "../lib/client";
import { RefusedWrites, deleteCalendarEvents, updateCalendarEvents } from "../lib/client";
import {
  eventDay,
  filterEvents,
  planBulkEdit,
  type EventFilter,
  type TitleEdit,
  type TitleMatch,
} from "../lib/calendarBulk";
import { friendlyError } from "../lib/errors";
import { btnDanger, btnPrimary, checkbox, eyebrow, field, fieldLabel, selectField, linkAction } from "../lib/styles";
import type { Calendar, CalendarEvent } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeLine, SettingsGroup, actionRow, type Notice } from "./SettingsKit";

const MAX_LISTED = 300;

const MATCH_LABELS: Record<TitleMatch, string> = {
  prefix: "Title starts with",
  contains: "Title contains",
  suffix: "Title ends with",
  exact: "Title is exactly",
};

type TitleAction = TitleEdit["kind"];

const TITLE_ACTION_LABELS: Record<TitleAction, string> = {
  keep: "Leave titles as they are",
  strip: "Remove the matched text",
  replace: "Find and replace",
  prefix: "Add text to the start",
  suffix: "Add text to the end",
  set: "Rename all to",
};

type Props = {
  session: Session;
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  timezone: string;
  onRefresh: () => Promise<void>;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function CalendarBulkEditSection({ session, calendars, calendarEvents, timezone, onRefresh }: Props) {
  const ids = useId();
  const [match, setMatch] = useState<TitleMatch>("prefix");
  const [text, setText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [sourceCalendar, setSourceCalendar] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Matches start selected; this holds the ones unticked by hand.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [titleAction, setTitleAction] = useState<TitleAction>("keep");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [titleText, setTitleText] = useState("");
  const [targetCalendar, setTargetCalendar] = useState("");

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const filter = useMemo<EventFilter>(
    () => ({ text, match, caseSensitive, calendarId: sourceCalendar, from, to }),
    [text, match, caseSensitive, sourceCalendar, from, to],
  );
  const filtering = Boolean(text || from || to || sourceCalendar !== "all");

  const calendarById = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const orphanCount = useMemo(() => calendarEvents.filter((event) => !event.calendarId).length, [calendarEvents]);
  const targets = calendars.filter((calendar) => !calendar.archived);

  const matches = useMemo(
    () => (filtering ? filterEvents(calendarEvents, filter, timezone) : []),
    [calendarEvents, filtering, filter, timezone],
  );
  const editable = matches.filter((event) => event.readable !== false);
  const unreadable = matches.length - editable.length;
  const selected = editable.filter((event) => !excluded.has(event.id));

  const canStrip = Boolean(text) && match !== "exact";
  const action: TitleAction = titleAction === "strip" && !canStrip ? "keep" : titleAction;
  const titleEdit: TitleEdit =
    action === "replace" ? { kind: "replace", find, replace }
      : action === "prefix" || action === "suffix" || action === "set"
        ? { kind: action, text: titleText }
        : { kind: action };
  const plan = planBulkEdit(selected, { title: titleEdit, calendarId: targetCalendar || undefined }, filter);
  const planById = new Map(plan.map((change) => [change.event.id, change]));
  const changes = plan.filter((change) => change.changed);

  function resetSelection() {
    setExcluded(new Set());
    setNotice(null);
  }

  function clearSearch() {
    setText("");
    setFrom("");
    setTo("");
    setSourceCalendar("all");
    setTitleAction("keep");
    setTargetCalendar("");
    resetSelection();
  }

  function toggle(id: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setExcluded(selected.length === editable.length ? new Set(editable.map((event) => event.id)) : new Set());
  }

  function refusedText(err: unknown, verb: string, total: number): string {
    if (err instanceof RefusedWrites) {
      return `${plural(total - err.refused.size, "event")} ${verb}; ${err.refused.size} refused: ${err.message}`;
    }
    return `Nothing was ${verb}: ${friendlyError(err)}`;
  }

  async function apply() {
    if (changes.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateCalendarEvents(
        session,
        changes.map(({ event, title, calendarId }) => ({ ...event, title, calendarId })),
      );
      setNotice({ type: "success", text: `Updated ${plural(changes.length, "event")}.` });
      setExcluded(new Set());
    } catch (err) {
      setNotice({ type: "error", text: refusedText(err, "updated", changes.length) });
    } finally {
      await onRefresh().catch(() => undefined);
      setBusy(false);
    }
  }

  async function remove() {
    if (selected.length === 0 || busy) return;
    const count = selected.length;
    setBusy(true);
    setNotice(null);
    try {
      await deleteCalendarEvents(session, selected.map((event) => event.id));
      setNotice({ type: "success", text: `Deleted ${plural(count, "event")}.` });
      setExcluded(new Set());
    } catch (err) {
      setNotice({ type: "error", text: refusedText(err, "deleted", count) });
    } finally {
      setConfirmDelete(false);
      await onRefresh().catch(() => undefined);
      setBusy(false);
    }
  }

  function calendarLabel(id: string | undefined): string {
    return id ? (calendarById.get(id)?.name ?? "Unknown calendar") : "No calendar";
  }

  function calendarDot(id: string | undefined) {
    const color = id ? calendarById.get(id)?.color : undefined;
    return (
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full border border-line"
        style={color ? { backgroundColor: color, borderColor: color } : undefined}
      />
    );
  }

  return (
    <SettingsGroup
      title="Bulk edit events"
      meta={filtering ? `${plural(matches.length, "match")}` : undefined}
      description="Find events by title, calendar or date, then rename them, move them to another calendar, or delete them together. A repeating event is one entry, so a change applies to every occurrence."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${ids}-match`} className={fieldLabel}>
            Match
          </label>
          <select
            id={`${ids}-match`}
            value={match}
            disabled={busy}
            onChange={(event) => {
              setMatch(event.target.value as TitleMatch);
              resetSelection();
            }}
            className={`${selectField} mt-1.5`}
          >
            {(Object.keys(MATCH_LABELS) as TitleMatch[]).map((key) => (
              <option key={key} value={key}>
                {MATCH_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-text`} className={fieldLabel}>
            Text
          </label>
          <input
            id={`${ids}-text`}
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              resetSelection();
            }}
            placeholder="e.g. HOL -"
            className={field}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={`${ids}-source`} className={fieldLabel}>
            In calendar
          </label>
          <select
            id={`${ids}-source`}
            value={sourceCalendar}
            disabled={busy}
            onChange={(event) => {
              setSourceCalendar(event.target.value);
              resetSelection();
            }}
            className={`${selectField} mt-1.5`}
          >
            <option value="all">All calendars</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
                {calendar.archived ? " (archived)" : ""}
              </option>
            ))}
            {orphanCount > 0 ? <option value="none">No calendar ({orphanCount})</option> : null}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-from`} className={fieldLabel}>
            Starting on or after
          </label>
          <input
            id={`${ids}-from`}
            type="date"
            value={from}
            disabled={busy}
            onChange={(event) => {
              setFrom(event.target.value);
              resetSelection();
            }}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-to`} className={fieldLabel}>
            Starting on or before
          </label>
          <input
            id={`${ids}-to`}
            type="date"
            value={to}
            disabled={busy}
            onChange={(event) => {
              setTo(event.target.value);
              resetSelection();
            }}
            className={field}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-mute">
          <input
            type="checkbox"
            checked={caseSensitive}
            disabled={busy}
            onChange={(event) => {
              setCaseSensitive(event.target.checked);
              resetSelection();
            }}
            className={checkbox}
          />
          Match case
        </label>
        {filtering ? (
          <button type="button" disabled={busy} onClick={clearSearch} className={linkAction}>
            Clear search
          </button>
        ) : null}
      </div>

      {!filtering ? null : matches.length === 0 ? (
        <p className="text-xs text-mute">No events match.</p>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                aria-label="Select all matching events"
                checked={selected.length === editable.length && editable.length > 0}
                ref={(input) => {
                  if (input) input.indeterminate = selected.length > 0 && selected.length < editable.length;
                }}
                disabled={busy || editable.length === 0}
                onChange={toggleAll}
                className={checkbox}
              />
              <span className={eyebrow}>
                {selected.length} of {plural(editable.length, "event")} selected
              </span>
            </label>
            {unreadable > 0 ? (
              <span className="text-2xs text-mute">
                {unreadable} from a newer app version left out
              </span>
            ) : null}
          </div>
          <ul
            aria-label="Matching events"
            className="mt-2 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-bg/60 text-xs"
          >
            {editable.slice(0, MAX_LISTED).map((event) => {
              const change = planById.get(event.id);
              const renamed = change && change.title !== event.title;
              const moved = change && change.calendarId !== event.calendarId;
              return (
                <li key={event.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface/40">
                    <input
                      type="checkbox"
                      checked={!excluded.has(event.id)}
                      disabled={busy}
                      onChange={() => toggle(event.id)}
                      className={checkbox}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${renamed ? "text-mute line-through" : "font-medium text-text"}`}>
                        {event.title || "(untitled)"}
                      </span>
                      {renamed ? (
                        <span className="block truncate font-medium text-text">{change.title}</span>
                      ) : null}
                    </span>
                    <span className="hidden min-w-0 items-center gap-1.5 text-2xs text-mute sm:flex">
                      {calendarDot(event.calendarId)}
                      <span className={`truncate ${moved ? "line-through" : ""}`}>{calendarLabel(event.calendarId)}</span>
                      {moved ? (
                        <>
                          <span aria-hidden="true">&rarr;</span>
                          {calendarDot(change.calendarId)}
                          <span className="truncate text-text">{calendarLabel(change.calendarId)}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-mute">
                      {eventDay(event, timezone)}
                    </span>
                  </label>
                </li>
              );
            })}
            {editable.length > MAX_LISTED ? (
              <li className="px-3 py-2 text-2xs text-mute">
                and {editable.length - MAX_LISTED} more, included in the selection
              </li>
            ) : null}
          </ul>
        </div>
      )}

      {editable.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${ids}-title-action`} className={fieldLabel}>
                Titles
              </label>
              <select
                id={`${ids}-title-action`}
                value={action}
                disabled={busy}
                onChange={(event) => setTitleAction(event.target.value as TitleAction)}
                className={`${selectField} mt-1.5`}
              >
                {(Object.keys(TITLE_ACTION_LABELS) as TitleAction[])
                  .filter((key) => key !== "strip" || canStrip)
                  .map((key) => (
                    <option key={key} value={key}>
                      {TITLE_ACTION_LABELS[key]}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-target`} className={fieldLabel}>
                Calendar
              </label>
              <select
                id={`${ids}-target`}
                value={targetCalendar}
                disabled={busy}
                onChange={(event) => setTargetCalendar(event.target.value)}
                className={`${selectField} mt-1.5`}
              >
                <option value="">Leave in their calendars</option>
                {targets.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    Move to {calendar.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {action === "replace" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${ids}-find`} className={fieldLabel}>
                  Find
                </label>
                <input
                  id={`${ids}-find`}
                  value={find}
                  disabled={busy}
                  onChange={(event) => setFind(event.target.value)}
                  className={field}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor={`${ids}-replace`} className={fieldLabel}>
                  Replace with
                </label>
                <input
                  id={`${ids}-replace`}
                  value={replace}
                  disabled={busy}
                  onChange={(event) => setReplace(event.target.value)}
                  className={field}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : action === "prefix" || action === "suffix" || action === "set" ? (
            <div className="max-w-sm">
              <label htmlFor={`${ids}-title-text`} className={fieldLabel}>
                {action === "set" ? "New title" : action === "prefix" ? "Text to add before" : "Text to add after"}
              </label>
              <input
                id={`${ids}-title-text`}
                value={titleText}
                disabled={busy}
                onChange={(event) => setTitleText(event.target.value)}
                placeholder={action === "prefix" ? "e.g. Holiday: " : undefined}
                className={field}
                autoComplete="off"
              />
            </div>
          ) : null}

          <div className={actionRow}>
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => setConfirmDelete(true)}
              className={btnDanger}
            >
              Delete {plural(selected.length, "event")}
            </button>
            <button
              type="button"
              disabled={busy || changes.length === 0}
              onClick={() => void apply()}
              className={btnPrimary}
            >
              {busy && !confirmDelete ? "Updating…" : `Update ${plural(changes.length, "event")}`}
            </button>
          </div>
        </>
      ) : null}

      <NoticeLine notice={notice} />

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete events"
          tone="danger"
          heading={`Delete ${plural(selected.length, "event")}?`}
          body="They are removed from every device. This cannot be undone from here, so export a backup first if you might want them back."
          confirmLabel={`Delete ${plural(selected.length, "event")}`}
          busyLabel="Deleting…"
          busy={busy}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </SettingsGroup>
  );
}
