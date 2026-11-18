import { ENVELOPE_OVERHEAD, MAX_PADDED_OBJECT_SIZE } from "./bookmark";
import { recurrenceFrom, recurrenceTo } from "./calendar";
import { keyFor } from "./calendarModel";
import { localInputToUtc, utcToLocalInput } from "./timezone";
import { buildTree, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Task, TaskDraft, TaskList } from "./types";
import {
  coreIsCalendarDay,
  coreOrderTasks,
  coreTaskAgenda,
  coreTaskComplete,
  coreTaskListCanMove,
  coreTaskListParse,
  coreTaskListTone,
  coreTaskListWrite,
  coreTaskParse,
  coreTaskReopen,
  coreTaskWrite,
} from "./wasm";
import type { CoreTask, CoreTaskAgenda, CoreTaskDraft, CoreTaskList } from "./wasm";
import { sortContainers } from "./order";

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
      draft.priority !== undefined &&
      Number.isInteger(draft.priority) &&
      draft.priority > 0
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
    trashedAt: task.trashed_at,
    readable: task.readable,
  };
}

/** A draft core handed back, in this client's shape. */
export function draftFrom(draft: CoreTaskDraft): TaskDraft {
  return {
    title: draft.title,
    notes: draft.notes || undefined,
    done: draft.done || undefined,
    completedAt: draft.completed_at,
    completions: draft.completions,
    dueDate: draft.due_date,
    priority: draft.priority,
    tags: draft.tags,
    taskListId: draft.task_list_id,
    parentId: draft.parent_id,
    recurrence: draft.recurrence ? recurrenceFrom(draft.recurrence) : undefined,
    unreadableRecurrence: draft.unreadable_recurrence,
    recurrenceAnchor: draft.recurrence_anchor,
    createdAt: draft.created_at,
    raw: draft.raw,
  };
}

/** A listed task as core reads one, for the rules that take whole tasks. */
export function taskTo(task: Task): CoreTask {
  const draft = draftTo(taskDraft(task));
  return {
    ...draft,
    id: task.id,
    title: task.title,
    derived_title: task.derivedTitle === true,
    updated_at: task.updatedAt,
    trashed_at: task.trashedAt,
    readable: task.readable ?? true,
    raw: task.raw ?? "",
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
  archived?: boolean,
  hideFromAll?: boolean,
): string {
  const stored = previousRaw ? coreTaskListParse("", previousRaw) : undefined;
  return coreTaskListWrite({
    name,
    parent_id: parentId,
    color,
    archived: archived ?? stored?.archived ?? false,
    hide_from_all: hideFromAll ?? stored?.hide_from_all ?? false,
    raw: previousRaw,
  });
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
    archived: list.archived || undefined,
    hideFromAll: list.hide_from_all || undefined,
    raw: list.raw,
    trashedAt: list.trashed_at,
    readable: list.readable,
  };
}

export function listTo(list: TaskList): CoreTaskList {
  return {
    id: list.id,
    name: list.name,
    parent_id: list.parentId,
    color: list.color,
    archived: list.archived ?? false,
    hide_from_all: list.hideFromAll ?? false,
    trashed_at: list.trashedAt,
    readable: list.readable ?? true,
    raw: list.raw,
  };
}

export function resolveTaskListId(taskListId?: string): string {
  return taskListId?.trim() || DEFAULT_TASK_LIST_ID;
}

export function emptyTaskDraft(
  taskListId: string,
  parentId?: string,
): TaskDraft {
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
  const day = isAllDayDue(dueDate)
    ? dueDate
    : utcToLocalInput(dueDate, timezone).slice(0, 10);
  return new Date(`${day}T00:00`);
}

/** The local `YYYY-MM-DD` a task is due on in `timezone`, or null. */
export function dueDayKey(task: Task, timezone: string): string | null {
  const due = normalizeDueDate(task.dueDate);
  return due ? keyFor(dayOf(due, timezone)) : null;
}

export type TaskTick = {
  draft: TaskDraft;
  /** True when a recurring task stayed open and moved to its next date. */
  rolled: boolean;
  /** Done subtasks the roll reopens, to write after the task. */
  reopened: { id: string; draft: TaskDraft }[];
};

/** A stored due value in `timezone`'s wall-clock time. */
function localValue(value: string | undefined, timezone: string): string | undefined {
  const due = normalizeDueDate(value);
  if (!due) return undefined;
  return isAllDayDue(due) ? due : utcToLocalInput(due, timezone);
}

/**
 * Ticks a task through core. A recurring task with a later occurrence stays
 * open, moves its due date on and reopens its done subtasks; anything else is
 * marked done.
 */
export function tickTask(task: Task, tasks: Task[], now: Date, timezone: string): TaskTick {
  const result = coreTaskComplete(taskTo(task), tasks.map(taskTo), {
    now: now.toISOString(),
    today: utcToLocalInput(now.toISOString(), timezone).slice(0, 10),
    due_local: localValue(task.dueDate, timezone),
    anchor_local: localValue(task.recurrenceAnchor, timezone),
  });
  const draft = draftFrom(result.task);
  if (result.local_due) draft.dueDate = localInputToUtc(result.local_due, timezone);
  return {
    draft,
    rolled: result.rolled,
    reopened: result.reopened.map((write) => ({ id: write.id, draft: draftFrom(write.draft) })),
  };
}

/** The draft for ticking a task on its own; see `tickTask`. */
export function completeTask(task: Task, now: Date, timezone: string): TaskDraft {
  return tickTask(task, [task], now, timezone).draft;
}

export function reopenTask(task: Task): TaskDraft {
  return draftFrom(coreTaskReopen(taskTo(task)));
}

export type TaskScope = "upnext" | "all" | "completed";

export function isOverdue(task: Task, now: Date, timezone: string): boolean {
  const due = normalizeDueDate(task.dueDate);
  if (task.done || !due) return false;
  if (!isAllDayDue(due)) return Date.parse(due) < now.getTime();
  return due < keyFor(dayOf(now.toISOString(), timezone));
}

export function inScope(task: Task, scope: TaskScope): boolean {
  if (scope === "all") return true;
  if (scope === "completed") return task.done === true;
  return !task.done;
}

export type TaskAgenda = CoreTaskAgenda;

/** Open tasks by due day, and the tasks completed today, in `timezone`. */
export function taskAgenda(tasks: Task[], now: Date, timezone: string): TaskAgenda {
  const local = (value: string) => utcToLocalInput(value, timezone).slice(0, 16);
  return coreTaskAgenda(
    tasks.map((task) => {
      const due = normalizeDueDate(task.dueDate);
      return {
        id: task.id,
        title: task.title,
        done: task.done === true,
        due_local: due ? (isAllDayDue(due) ? due : local(due)) : undefined,
        completed_local: task.completedAt ? local(task.completedAt) : undefined,
        priority: task.priority,
      };
    }),
    local(now.toISOString()),
  );
}

function dueTime(task: Task): number | undefined {
  const due = normalizeDueDate(task.dueDate);
  if (!due) return undefined;
  const at = Date.parse(isAllDayDue(due) ? `${due}T00:00` : due);
  return Number.isNaN(at) ? undefined : at;
}

/** Open before done, then soonest due, then highest priority, then title. */
export function sortTasks(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const order = coreOrderTasks(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      done: task.done === true,
      due_at: dueTime(task),
      priority: task.priority,
    })),
  );
  return order.map((id) => byId.get(id)).filter((task): task is Task => task !== undefined);
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
  return sortContainers(DEFAULT_TASK_LIST_ID, lists);
}

/**
 * Folds written tasks into a listing, dropping `removed` ids. The writer knows
 * what it stored, so showing a save does not need a vault re-read.
 */
export function mergeTasks(
  current: Task[],
  saved: Task[],
  removed?: string[],
): Task[] {
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

function mergeById<T extends { id: string }>(
  current: T[],
  saved: T[],
  removed?: string[],
): T[] {
  const gone = new Set(removed ?? []);
  const bySaved = new Map(
    saved.filter((item) => !gone.has(item.id)).map((item) => [item.id, item]),
  );
  const merged = current
    .filter((item) => !gone.has(item.id))
    .map((item) => bySaved.get(item.id) ?? item);
  const seen = new Set(merged.map((item) => item.id));
  return [
    ...merged,
    ...[...bySaved.values()].filter((item) => !seen.has(item.id)),
  ];
}

export function taskListNameById(
  lists: TaskList[],
  taskListId?: string,
): string {
  const id = resolveTaskListId(taskListId);
  return lists.find((list) => list.id === id)?.name ?? DEFAULT_TASK_LIST_NAME;
}

export function buildTaskListTree(lists: TaskList[]): TreeNode<TaskList>[] {
  return buildTree(lists, sortTaskLists);
}

export function taskListSubtree(lists: TaskList[], id: string): string[] {
  return subtree(lists, id);
}

export function canMoveTaskList(
  lists: TaskList[],
  id: string,
  parentId: string | null,
): boolean {
  return coreTaskListCanMove(lists.map(listTo), id, parentId ?? undefined);
}

export function taskListTone(lists: TaskList[], id: string): string {
  return coreTaskListTone(lists.map(listTo), id);
}

export function dueLabel(
  task: Task,
  now: Date,
  timezone: string,
): string | null {
  const due = normalizeDueDate(task.dueDate);
  if (!due) return null;
  const day = dayOf(due, timezone);
  const today = dayOf(now.toISOString(), timezone);
  const delta = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  let label: string;
  if (delta === 0) label = "Today";
  else if (delta === 1) label = "Tomorrow";
  else if (delta === -1) label = "Yesterday";
  else if (delta > 1 && delta < 7) label = day.toLocaleDateString(undefined, { weekday: "short" });
  else {
    label = day.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
    });
  }
  return isAllDayDue(due)
    ? label
    : `${label} ${utcToLocalInput(due, timezone).slice(11)}`;
}
