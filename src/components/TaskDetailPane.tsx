import type { ReactNode } from "react";
import { TaskIcon } from "./TaskIcon";
import { HeaderButton, HeaderDivider, PaneSection } from "./PaneControls";
import { dueLabel, isAllDayDue, isOverdue, priorityLabel } from "../lib/task";
import { utcToLocalInput } from "../lib/timezone";
import { focusRing } from "../lib/styles";
import type { RecurrenceRule, Task } from "../lib/types";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const UNITS: Record<RecurrenceRule["frequency"], string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

type Props = {
  task: Task;
  listName: string;
  parent?: Task;
  subtasks: Task[];
  now: Date;
  timezone: string;
  readOnly: boolean;
  busy: boolean;
  onToggleDone: (task: Task) => void;
  onEdit: (task: Task) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (task: Task) => void;
  onSelect: (task: Task) => void;
  onClose: () => void;
};

function recurrenceSummary(rule: RecurrenceRule): string {
  const every = rule.interval && rule.interval > 1 ? `Every ${rule.interval} ${UNITS[rule.frequency]}s` : `Every ${UNITS[rule.frequency]}`;
  const parts = [every];
  if (rule.frequency === "weekly" && rule.weekdays && rule.weekdays.length > 0) {
    parts.push(`on ${rule.weekdays.map((day) => WEEKDAY_NAMES[day] ?? String(day)).join(", ")}`);
  }
  if (rule.until) parts.push(`until ${formatDay(rule.until)}`);
  if (rule.count) parts.push(`${rule.count} times`);
  return parts.join(" ");
}

function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00`);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function formatTimestamp(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDue(dueDate: string, timezone: string): string {
  if (isAllDayDue(dueDate)) return formatDay(dueDate);
  const local = utcToLocalInput(dueDate, timezone);
  return `${formatDay(local.slice(0, 10))} at ${local.slice(11)}`;
}

export function TaskDetailPane({
  task,
  listName,
  parent,
  subtasks,
  now,
  timezone,
  readOnly,
  busy,
  onToggleDone,
  onEdit,
  onAddChild,
  onDelete,
  onSelect,
  onClose,
}: Props) {
  const due = dueLabel(task, now, timezone);
  const overdue = isOverdue(task, now, timezone);
  const priority = priorityLabel(task.priority);
  const doneChildren = subtasks.filter((child) => child.done).length;
  const completions = task.completions ?? [];
  const created = formatTimestamp(task.createdAt);
  const updated = formatTimestamp(task.updatedAt);
  const completed = formatTimestamp(task.completedAt);

  return (
    <section
      aria-label={`${task.title} details`}
      className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden bg-bg animate-fade-in-up max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:h-dvh max-lg:min-h-0 max-lg:max-h-none max-lg:w-screen lg:h-full lg:min-h-0"
    >
      <div className="shrink-0 border-b border-line px-5 py-4">
        <div className="flex min-h-8 items-center gap-3">
          <div className="min-w-0 flex-1">
            {parent ? (
              <button
                type="button"
                onClick={() => onSelect(parent)}
                className={`-ml-1 flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-xs text-mute transition-colors hover:text-text ${focusRing}`}
              >
                <TaskIcon name="chevron" className="h-3 w-3 shrink-0 rotate-180" />
                <span className="truncate">{parent.title}</span>
              </button>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!readOnly ? (
              <>
                <HeaderButton label="Edit this task" onClick={() => onEdit(task)} disabled={busy}>
                  <TaskIcon name="pencil" />
                </HeaderButton>
                <HeaderButton label="Add a subtask" onClick={() => onAddChild(task.id)} disabled={busy}>
                  <TaskIcon name="plus" />
                </HeaderButton>
                <HeaderButton label="Delete this task" onClick={() => onDelete(task)} disabled={busy} danger>
                  <TaskIcon name="trash" />
                </HeaderButton>
                <HeaderDivider />
              </>
            ) : null}
            <HeaderButton label="Close task details" onClick={onClose}>
              <TaskIcon name="close" />
            </HeaderButton>
          </div>
        </div>

        <div className="mt-2 flex items-start gap-3">
          <span className="flex h-8 shrink-0 items-center">
            <input
              type="checkbox"
              checked={task.done === true}
              disabled={readOnly || busy}
              onChange={() => onToggleDone(task)}
              aria-label={task.done ? "Reopen this task" : "Complete this task"}
              className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-default"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className={`break-words text-xl font-semibold leading-8 tracking-tight ${task.done ? "text-mute line-through" : "text-text"}`}
            >
              {task.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
              <span className="max-w-[12rem] truncate rounded-full border border-line px-2 font-medium leading-[18px]">
                {listName}
              </span>
              {due ? <span className={overdue ? "text-danger" : undefined}>{due}</span> : null}
              {task.done ? <span className="font-medium text-accent">Completed</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <PaneSection title="Details">
          <dl>
            <Field label="Due">
              {task.dueDate ? (
                <span className={overdue ? "text-danger" : undefined}>
                  {formatDue(task.dueDate, timezone)}
                </span>
              ) : (
                <span className="text-mute">No due date</span>
              )}
            </Field>
            <Field label="Priority">
              {priority ?? <span className="text-mute">None</span>}
            </Field>
            {task.recurrence ? (
              <Field label="Repeats">{recurrenceSummary(task.recurrence)}</Field>
            ) : null}
            {task.tags && task.tags.length > 0 ? (
              <Field label="Tags">
                <span className="flex flex-wrap gap-1.5">
                  {task.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-line bg-panel px-2 py-0.5 text-xs text-mute"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              </Field>
            ) : null}
            {completed ? <Field label="Completed">{completed}</Field> : null}
          </dl>
        </PaneSection>

        {task.notes ? (
          <PaneSection title="Notes">
            <p className="whitespace-pre-wrap px-5 py-3 text-sm leading-relaxed text-text">
              {task.notes}
            </p>
          </PaneSection>
        ) : null}

        {subtasks.length > 0 ? (
          <PaneSection title={`Subtasks ${doneChildren}/${subtasks.length}`}>
            <ul>
              {subtasks.map((child) => (
                <li
                  key={child.id}
                  className="flex items-center gap-3 border-b border-line/60 px-5 transition-colors hover:bg-surface/40"
                >
                  <input
                    type="checkbox"
                    checked={child.done === true}
                    disabled={readOnly || busy}
                    onChange={() => onToggleDone(child)}
                    aria-label={`Complete ${child.title}`}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-accent disabled:cursor-default"
                  />
                  <button
                    type="button"
                    onClick={() => onSelect(child)}
                    className={`flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left text-sm ${focusRing}`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate font-medium ${child.done ? "text-mute line-through" : "text-text"}`}
                    >
                      {child.title}
                    </span>
                    {dueLabel(child, now, timezone) ? (
                      <span className="shrink-0 text-xs text-mute">
                        {dueLabel(child, now, timezone)}
                      </span>
                    ) : null}
                    <TaskIcon name="chevron" className="h-3 w-3 shrink-0 text-mute/60" />
                  </button>
                </li>
              ))}
            </ul>
          </PaneSection>
        ) : null}

        {completions.length > 0 ? (
          <PaneSection title="Completed before">
            <ul>
              {completions.slice(0, 10).map((entry, index) => (
                <li
                  key={`${entry}-${index}`}
                  className="border-b border-line/60 px-5 py-2 text-sm text-mute"
                >
                  {formatTimestamp(entry)}
                </li>
              ))}
            </ul>
          </PaneSection>
        ) : null}

        {created || updated ? (
          <div className="px-5 py-3 text-[11px] text-mute/70">
            {created ? <p>Added {created}</p> : null}
            {updated ? <p>Last changed {updated}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line/60 px-5 py-2.5 text-sm">
      <dt className="w-20 shrink-0 truncate text-[11px] font-medium uppercase tracking-wider text-mute/70">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 font-medium text-text">{children}</dd>
    </div>
  );
}
