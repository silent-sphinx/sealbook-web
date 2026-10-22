import { dueDayKey, isAllDayDue, isOverdue, normalizeDueDate, sortTasks } from "./task";
import { utcToLocalInput } from "./timezone";
import type { Task } from "./types";

export type TaskMark = {
  id: string;
  title: string;
  timeLabel: string | null;
  overdue: boolean;
};

/** Open tasks with a due date, keyed by the local day they are due on. */
export function dueTaskMarks(tasks: Task[], now: Date, timezone: string): Map<string, TaskMark[]> {
  const marks = new Map<string, TaskMark[]>();
  for (const task of sortTasks(tasks)) {
    if (task.done) continue;
    const key = dueDayKey(task, timezone);
    const due = normalizeDueDate(task.dueDate);
    if (!key || !due) continue;
    const entry: TaskMark = {
      id: task.id,
      title: task.title,
      timeLabel: isAllDayDue(due) ? null : utcToLocalInput(due, timezone).slice(11),
      overdue: isOverdue(task, now, timezone),
    };
    const day = marks.get(key);
    if (day) day.push(entry);
    else marks.set(key, [entry]);
  }
  return marks;
}
