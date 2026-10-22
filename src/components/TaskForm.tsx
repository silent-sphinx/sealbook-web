import { useState } from "react";
import { normalizeTags } from "../lib/bookmark";
import { isAllDayDue, taskFitsObjectLimit } from "../lib/task";
import { localInputToUtc, utcToLocalInput } from "../lib/timezone";
import { btnPrimary, btnSecondary, fieldBase, selectField } from "../lib/styles";
import type { RecurrenceFrequency, RecurrenceRule, TaskDraft } from "../lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES: { id: RecurrenceFrequency; unit: string }[] = [
  { id: "daily", unit: "day" },
  { id: "weekly", unit: "week" },
  { id: "monthly", unit: "month" },
  { id: "yearly", unit: "year" },
];
const PRIORITIES = [
  { value: 0, label: "None" },
  { value: 1, label: "Low" },
  { value: 2, label: "Medium" },
  { value: 3, label: "High" },
];

type Props = {
  initial: TaskDraft;
  editing: boolean;
  listOptions: { id: string; name: string; depth: number }[];
  timezone: string;
  disabled: boolean;
  onSubmit: (draft: TaskDraft) => void;
  onCancel: () => void;
};

function splitDue(dueDate: string | undefined, timezone: string): { date: string; time: string } {
  if (!dueDate) return { date: "", time: "" };
  if (isAllDayDue(dueDate)) return { date: dueDate, time: "" };
  const local = utcToLocalInput(dueDate, timezone);
  return { date: local.slice(0, 10), time: local.slice(11) };
}

export function TaskForm({ initial, editing, listOptions, timezone, disabled, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [listId, setListId] = useState(initial.taskListId);
  const [date, setDate] = useState(() => splitDue(initial.dueDate, timezone).date);
  const [time, setTime] = useState(() => splitDue(initial.dueDate, timezone).time);
  const [priority, setPriority] = useState(initial.priority ?? 0);
  const [tagText, setTagText] = useState((initial.tags ?? []).join(", "));
  const [frequency, setFrequency] = useState<RecurrenceFrequency | "none">(
    initial.recurrence?.frequency ?? "none",
  );
  const [interval, setInterval] = useState(String(initial.recurrence?.interval ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(initial.recurrence?.weekdays ?? []);
  const [until, setUntil] = useState(initial.recurrence?.until?.slice(0, 10) ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day],
    );
  }

  function submit() {
    if (!title.trim()) {
      setProblem("Give the task a title.");
      return;
    }
    const dueDate = date ? (time ? localInputToUtc(`${date}T${time}`, timezone) : date) : undefined;
    if (frequency !== "none" && !dueDate) {
      setProblem("Set a due date to repeat a task.");
      return;
    }
    let recurrence: RecurrenceRule | undefined;
    if (frequency !== "none") {
      const rule: RecurrenceRule =
        initial.recurrence?.frequency === frequency ? { ...initial.recurrence } : { frequency };
      const every = Math.max(1, Math.floor(Number(interval)) || 1);
      if (every > 1) rule.interval = every;
      else delete rule.interval;
      if (frequency === "weekly" && weekdays.length > 0) {
        rule.weekdays = [...weekdays].sort((a, b) => a - b);
      } else {
        delete rule.weekdays;
      }
      if (until) rule.until = until;
      else delete rule.until;
      recurrence = rule;
    }
    const unchanged =
      recurrence !== undefined &&
      JSON.stringify(recurrence) === JSON.stringify(initial.recurrence) &&
      dueDate === initial.dueDate;
    const draft: TaskDraft = {
      ...initial,
      title: title.trim(),
      notes: notes.trim() || undefined,
      taskListId: listId,
      dueDate,
      priority: priority > 0 ? priority : undefined,
      tags: normalizeTags(tagText.split(",")),
      recurrence,
      recurrenceAnchor: recurrence ? (unchanged ? (initial.recurrenceAnchor ?? dueDate) : dueDate) : undefined,
    };
    if (!taskFitsObjectLimit(draft)) {
      setProblem("This task is too large to store. One task can hold about 8 MB.");
      return;
    }
    setProblem(null);
    onSubmit(draft);
  }

  const unit = FREQUENCIES.find((entry) => entry.id === frequency)?.unit;
  const selectedPriority = Math.min(3, priority);

  return (
    <form
      className="mb-4 rounded-2xl border border-line bg-panel/80 p-4"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h4 className="text-sm font-semibold">{editing ? "Edit task" : "New task"}</h4>
      {problem ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {problem}
        </p>
      ) : null}
      <label className="mt-3 block text-xs text-mute">
        Title
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={`mt-1.5 ${fieldBase}`}
        />
      </label>
      <label className="mt-3 block text-xs text-mute">
        List
        <select value={listId} onChange={(event) => setListId(event.target.value)} className={`mt-1.5 ${selectField}`}>
          {listOptions.map(({ id, name, depth }) => (
            <option key={id} value={id}>
              {`${"— ".repeat(depth)}${name}`}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-xs text-mute">
          Due date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`mt-1.5 ${fieldBase}`} />
        </label>
        <label className="block text-xs text-mute">
          Due time
          <input
            type="time"
            value={time}
            disabled={!date}
            onChange={(event) => setTime(event.target.value)}
            className={`mt-1.5 ${fieldBase}`}
          />
        </label>
      </div>
      <label className="mt-3 block text-xs text-mute">
        Priority
        <select
          value={selectedPriority}
          onChange={(event) => setPriority(Number(event.target.value))}
          className={`mt-1.5 ${selectField}`}
        >
          {PRIORITIES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs text-mute">
        Repeat
        <select
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency | "none")}
          className={`mt-1.5 ${selectField}`}
        >
          <option value="none">Does not repeat</option>
          {FREQUENCIES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id[0]!.toUpperCase() + entry.id.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {frequency !== "none" ? (
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-mute">
            {`Every (${unit}s)`}
            <input
              type="number"
              min={1}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              className={`mt-1.5 ${fieldBase}`}
            />
          </label>
          {frequency === "weekly" ? (
            <fieldset>
              <legend className="text-xs text-mute">On</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {WEEKDAYS.map((label, day) => (
                  <label key={label} className="flex items-center gap-1 text-xs text-mute">
                    <input
                      type="checkbox"
                      checked={weekdays.includes(day)}
                      onChange={() => toggleWeekday(day)}
                      className="accent-accent"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label className="block text-xs text-mute">
            Repeat until
            <input type="date" value={until} onChange={(event) => setUntil(event.target.value)} className={`mt-1.5 ${fieldBase}`} />
          </label>
        </div>
      ) : null}
      <label className="mt-3 block text-xs text-mute">
        Tags
        <input
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
          placeholder="Comma separated"
          className={`mt-1.5 ${fieldBase}`}
        />
      </label>
      <label className="mt-3 block text-xs text-mute">
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="mt-1.5 box-border w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
        />
      </label>
      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={disabled} className={btnPrimary}>
          {editing ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
