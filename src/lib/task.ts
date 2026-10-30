import { ENVELOPE_OVERHEAD, MAX_PADDED_OBJECT_SIZE } from "./bookmark";
import { recurrenceFrom, recurrenceTo } from "./calendar";
import { keyFor } from "./calendarModel";
import { nextOccurrence } from "./recurrence";
import { localInputToUtc, utcToLocalInput } from "./timezone";
import { buildTree, canReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Task, TaskDraft, TaskList } from "./types";
import {
  coreIsCalendarDay,
  coreTaskListParse,
  coreTaskListTone,
  coreTaskListWrite,
  coreTaskParse,
  coreTaskWrite,
} from "./wasm";
import type { CoreTask, CoreTaskDraft, CoreTaskList } from "./wasm";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`, pinned by a test.
export const TASK_CONTENT_TYPE = "application/sealbook.task+json";
export const TASK_LIST_CONTENT_TYPE = "application/sealbook.task-list+json";
export const DEFAULT_TASK_LIST_NAME = "Default Task List";
export const DEFAULT_TASK_LIST_ID = "00000000-0000-0000-0000-000000000006";
export const ALL_TASK_LISTS = "all";
export const MAX_TASK_COMPLETIONS = 50;

const DUE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DUE_TIMED =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * Writes a task's plaintext through core, which is where the owned keys, the
 * due-date check and the carried repeat rule live.
 *
 * A task parsed with no stored title carries `derivedTitle`; `taskDraft` hands
 * the writer an empty title for it, so a save does not write the fallback onto
 * the record.
 */
export function serializeTask(draft: TaskDraft): string {
  return coreTaskWrite(draftTo(draft), new Date().toISOString());
}

function draftTo(draft: TaskDraft): CoreTaskDraft {
  return {
    title: draft.title,
    notes: draft.notes ?? "",
    done: draft.done === true,
    completed_at: draft.completedAt,
    completions: draft.completions ?? [],
    due_date: draft.dueDate,
    priority:
      draft.priority !== undefined && Number.isInteger(draft.priority) && draft.priority > 0
        ? draft.priority
        : undefined,
    tags: draft.tags ?? [],
    task_list_id: draft.taskListId,
    parent_id: draft.parentId,
    recurrence: draft.recurrence ? recurrenceTo(draft.recurrence) : undefined,
    unreadable_recurrence: draft.unreadableRecurrence,
    recurrence_anchor: draft.recurrenceAnchor,
    created_at: draft.createdAt,
    raw: draft.raw,
  };
}

export function parseTask(id: string, raw: string): Task {
  return taskFrom(coreTaskParse(id, raw));
}

function taskFrom(task: CoreTask): Task {
  return {
    id: task.id,
    raw: task.raw,
    title: task.title,
    derivedTitle: task.derived_title,
    notes: task.notes || undefined,
    done: task.done || undefined,
    completedAt: task.completed_at,
    completions: task.completions,
    dueDate: task.due_date,
    priority: task.priority,
    tags: task.tags,
    taskListId: task.task_list_id,
    parentId: task.parent_id,
    recurrence: task.recurrence ? recurrenceFrom(task.recurrence) : undefined,
    unreadableRecurrence: task.unreadable_recurrence,
    recurrenceAnchor: task.recurrence_anchor,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    readable: task.readable,
  };
}

/** The draft an edit starts from: the stored title, never the listed fallback. */
export function taskDraft(task: Task): TaskDraft {
  const { id: _id, derivedTitle, readable: _readable, ...draft } = task;
  return { ...draft, title: derivedTitle ? "" : task.title };
}

/**
 * Whether this build may write over a stored task. False for one from a newer
 * schema major, which core refuses and an editor should show read-only.
 */
export function taskWritable(draft: TaskDraft): boolean {
  return !draft.raw || coreTaskParse("", draft.raw).readable;
}

export function serializeTaskList(
  name: string,
  parentId?: string,
  previousRaw?: string,
  color?: string,
): string {
  return coreTaskListWrite({ name, parent_id: parentId, color, raw: previousRaw });
}

export function parseTaskList(id: string, raw: string): TaskList {
  return listFrom(coreTaskListParse(id, raw));
}

function listFrom(list: CoreTaskList): TaskList {
  return {
    id: list.id,
    name: list.name,
    parentId: list.parent_id,
    color: list.color,
    raw: list.raw,
    readable: list.readable,
  };
}

function listTo(list: TaskList): CoreTaskList {
  return {
    id: list.id,
    name: list.name,
    parent_id: list.parentId,
    color: list.color,
    readable: list.readable ?? true,
    raw: list.raw,
  };
}

export function resolveTaskListId(taskListId?: string): string {
  return taskListId?.trim() || DEFAULT_TASK_LIST_ID;
}

export function emptyTaskDraft(taskListId: string, parentId?: string): TaskDraft {
  return {
    title: "",
    taskListId: resolveTaskListId(taskListId),
    tags: [],
    ...(parentId ? { parentId } : {}),
  };
}

/**
 * A due value as it should be stored, or undefined where it names no real
 * moment. The shape is checked here; whether the day exists is core's.
 */
export function normalizeDueDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const day = DUE_DAY.test(trimmed) ? trimmed : DUE_TIMED.exec(trimmed)?.[1];
  return day && coreIsCalendarDay(day) ? trimmed : undefined;
}

export function isAllDayDue(dueDate?: string): boolean {
  return Boolean(dueDate) && !dueDate?.includes("T");
}

export function priorityLabel(priority?: number): string | null {
  if (!priority || priority <= 0) return null;
  if (priority >= 3) return "High";
  return priority >= 2 ? "Medium" : "Low";
}

/** The calendar day of a due value in `timezone`, at local midnight. */
function dayOf(dueDate: string, timezone: string): Date {
  const day = isAllDayDue(dueDate) ? dueDate : utcToLocalInput(dueDate, timezone).slice(0, 10);
  return new Date(`${day}T00:00`);
}

/** The local `YYYY-MM-DD` a task is due on in `timezone`, or null. */
export function dueDayKey(task: Task, timezone: string): string | null {
  const due = normalizeDueDate(task.dueDate);
  return due ? keyFor(dayOf(due, timezone)) : null;
}

function rolledDueDate(task: Task, now: Date, timezone: string): { dueDate: string; anchor: string } | null {
  const due = normalizeDueDate(task.dueDate);
  if (!task.recurrence || !due) return null;
  const anchor = normalizeDueDate(task.recurrenceAnchor) ?? due;
  const current = dayOf(due, timezone);
  const today = dayOf(now.toISOString(), timezone);
  const next = nextOccurrence(dayOf(anchor, timezone), task.recurrence, current > today ? current : today);
  if (!next) return null;
  const key = keyFor(next);
  if (isAllDayDue(due)) return { dueDate: key, anchor };
  const time = utcToLocalInput(due, timezone).slice(10);
  return { dueDate: localInputToUtc(`${key}${time}`, timezone), anchor };
}

/**
 * The draft for ticking a task. A recurring task with a later occurrence stays
 * open and moves its due date on; anything else is marked done.
 */
export function completeTask(task: Task, now: Date, timezone: string): TaskDraft {
  const doneAt = now.toISOString();
  const completions = task.recurrence
    ? [doneAt, ...(task.completions ?? [])].slice(0, MAX_TASK_COMPLETIONS)
    : task.completions;
  const rolled = rolledDueDate(task, now, timezone);
  if (!rolled) return { ...taskDraft(task), done: true, completedAt: doneAt, completions };
  return {
    ...taskDraft(task),
    done: undefined,
    completedAt: undefined,
    dueDate: rolled.dueDate,
    recurrenceAnchor: rolled.anchor,
    completions,
  };
}

export function reopenTask(task: Task): TaskDraft {
  return { ...taskDraft(task), done: undefined, completedAt: undefined };
}

export type TaskScope = "today" | "overdue" | "all" | "completed";

export function isOverdue(task: Task, now: Date, timezone: string): boolean {
  const due = normalizeDueDate(task.dueDate);
  if (task.done || !due) return false;
  if (!isAllDayDue(due)) return Date.parse(due) < now.getTime();
  return due < keyFor(dayOf(now.toISOString(), timezone));
}

export function inScope(task: Task, scope: TaskScope, now: Date, timezone: string): boolean {
  if (scope === "all") return true;
  if (scope === "completed") return task.done === true;
  if (scope === "overdue") return isOverdue(task, now, timezone);
  return !task.done && dueDayKey(task, timezone) === keyFor(dayOf(now.toISOString(), timezone));
}

function dueTime(task: Task): number {
  const due = normalizeDueDate(task.dueDate);
  if (!due) return Number.POSITIVE_INFINITY;
  return Date.parse(isAllDayDue(due) ? `${due}T00:00` : due);
}

/** Open before done, then soonest due, then highest priority, then title. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    const due = dueTime(a) - dueTime(b);
    if (due !== 0 && !Number.isNaN(due)) return due;
    const priority = (b.priority ?? 0) - (a.priority ?? 0);
    if (priority !== 0) return priority;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

export function taskMatches(task: Task, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (task.title.toLowerCase().includes(needle)) return true;
  if (task.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
  return task.notes?.toLowerCase().includes(needle) === true;
}

export function taskByteSize(draft: TaskDraft): number {
  const payload = JSON.stringify(serializeTask(draft));
  return new TextEncoder().encode(payload).length + ENVELOPE_OVERHEAD;
}

export function taskFitsObjectLimit(draft: TaskDraft): boolean {
  return taskByteSize(draft) + 4 <= MAX_PADDED_OBJECT_SIZE;
}

export function sortTaskLists(lists: TaskList[]): TaskList[] {
  return [...lists].sort((a, b) => {
    if (a.id === DEFAULT_TASK_LIST_ID) return -1;
    if (b.id === DEFAULT_TASK_LIST_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Folds written tasks into a listing, dropping `removed` ids. The writer knows
 * what it stored, so showing a save does not need a vault re-read.
 */
export function mergeTasks(current: Task[], saved: Task[], removed?: string[]): Task[] {
  return sortTasks(mergeById(current, saved, removed));
}

/** `mergeTasks` for task lists. */
export function mergeTaskLists(
  current: TaskList[],
  saved: TaskList[],
  removed?: string[],
): TaskList[] {
  return sortTaskLists(mergeById(current, saved, removed));
}

function mergeById<T extends { id: string }>(current: T[], saved: T[], removed?: string[]): T[] {
  const gone = new Set(removed ?? []);
  const bySaved = new Map(saved.filter((item) => !gone.has(item.id)).map((item) => [item.id, item]));
  const merged = current
    .filter((item) => !gone.has(item.id))
    .map((item) => bySaved.get(item.id) ?? item);
  const seen = new Set(merged.map((item) => item.id));
  return [...merged, ...[...bySaved.values()].filter((item) => !seen.has(item.id))];
}

export function taskListNameById(lists: TaskList[], taskListId?: string): string {
  const id = resolveTaskListId(taskListId);
  return lists.find((list) => list.id === id)?.name ?? DEFAULT_TASK_LIST_NAME;
}

export function buildTaskListTree(lists: TaskList[]): TreeNode<TaskList>[] {
  return buildTree(lists, sortTaskLists);
}

export function taskListSubtree(lists: TaskList[], id: string): string[] {
  return subtree(lists, id);
}

export function canMoveTaskList(lists: TaskList[], id: string, parentId: string | null): boolean {
  if (id === DEFAULT_TASK_LIST_ID) return parentId === null;
  return canReparent(lists, id, parentId);
}

export function taskListTone(lists: TaskList[], id: string): string {
  return coreTaskListTone(lists.map(listTo), id);
}

export function dueLabel(task: Task, now: Date, timezone: string): string | null {
  const due = normalizeDueDate(task.dueDate);
  if (!due) return null;
  const day = dayOf(due, timezone);
  const today = dayOf(now.toISOString(), timezone);
  const delta = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  let label: string;
  if (delta === 0) label = "Today";
  else if (delta === 1) label = "Tomorrow";
  else if (delta === -1) label = "Yesterday";
  else {
    label = day.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
    });
  }
  return isAllDayDue(due) ? label : `${label} ${utcToLocalInput(due, timezone).slice(11)}`;
}
