import { collectionTone, ENVELOPE_OVERHEAD, MAX_PADDED_OBJECT_SIZE, normalizeTags } from "./bookmark";
import { keyFor } from "./calendarModel";
import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import { nextOccurrence } from "./recurrence";
import { localInputToUtc, utcToLocalInput } from "./timezone";
import { buildTree, canReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { RecurrenceRule, Task, TaskDraft, TaskList } from "./types";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`, pinned by a test.
export const TASK_CONTENT_TYPE = "application/sealbook.task+json";
export const TASK_LIST_CONTENT_TYPE = "application/sealbook.task-list+json";
export const DEFAULT_TASK_LIST_NAME = "Default Task List";
export const DEFAULT_TASK_LIST_ID = "00000000-0000-0000-0000-000000000006";
export const ALL_TASK_LISTS = "all";
export const MAX_TASK_COMPLETIONS = 50;

const TASK_KEYS = [
  "@type",
  "version",
  "title",
  "notes",
  "done",
  "completedAt",
  "completions",
  "dueDate",
  "priority",
  "tags",
  "taskListId",
  "parentId",
  "recurrence",
  "recurrenceAnchor",
  "createdAt",
  "updatedAt",
] as const;

const TASK_LIST_KEYS = ["@type", "version", "name", "parentId", "color"] as const;

const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function serializeTask(draft: TaskDraft): string {
  const now = new Date().toISOString();
  const notes = draft.notes?.trim();
  const tags = normalizeTags(draft.tags);
  const dueDate = normalizeDueDate(draft.dueDate);
  const recurrence = normalizeRecurrence(draft.recurrence);
  const recurrenceAnchor = normalizeDueDate(draft.recurrenceAnchor);
  const completions = normalizeCompletions(draft.completions);
  const priority = normalizePriority(draft.priority);
  const parentId = draft.parentId?.trim();
  return mergePayload(
    draft.raw,
    {
      "@type": "Task",
      version: PAYLOAD_SCHEMA_VERSION,
      title: draft.title.trim(),
      ...(notes ? { notes } : {}),
      ...(draft.done ? { done: true } : {}),
      ...(draft.done && draft.completedAt ? { completedAt: draft.completedAt } : {}),
      ...(completions.length > 0 ? { completions } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(priority ? { priority } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      taskListId: resolveTaskListId(draft.taskListId),
      ...(parentId ? { parentId } : {}),
      ...(recurrence ? { recurrence } : {}),
      ...(recurrence && recurrenceAnchor ? { recurrenceAnchor } : {}),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    },
    TASK_KEYS,
  );
}

export function parseTask(id: string, raw: string): Task {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const done = body.done === true;
    return {
      id,
      raw,
      title: title || "Untitled task",
      notes: typeof body.notes === "string" && body.notes ? body.notes : undefined,
      done: done || undefined,
      completedAt: done && typeof body.completedAt === "string" ? body.completedAt : undefined,
      completions: normalizeCompletions(body.completions),
      dueDate: normalizeDueDate(body.dueDate),
      priority: normalizePriority(body.priority),
      tags: normalizeTags(body.tags),
      taskListId: resolveTaskListId(typeof body.taskListId === "string" ? body.taskListId : undefined),
      parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : undefined,
      recurrence: normalizeRecurrence(body.recurrence),
      recurrenceAnchor: normalizeDueDate(body.recurrenceAnchor),
      createdAt: typeof body.createdAt === "string" ? body.createdAt : undefined,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : undefined,
    };
  } catch {
    return {
      id,
      raw,
      title: "Unreadable task",
      tags: [],
      taskListId: DEFAULT_TASK_LIST_ID,
    };
  }
}

export function serializeTaskList(
  name: string,
  parentId?: string,
  previousRaw?: string,
  color?: string,
): string {
  return mergePayload(
    previousRaw,
    {
      "@type": "TaskList",
      version: PAYLOAD_SCHEMA_VERSION,
      name: name.trim(),
      ...(parentId ? { parentId } : {}),
      ...(color ? { color } : {}),
    },
    TASK_LIST_KEYS,
  );
}

export function parseTaskList(id: string, raw: string): TaskList {
  try {
    const body = JSON.parse(raw) as { name?: string; parentId?: string; color?: string };
    return {
      id,
      name: body.name?.trim() || "Untitled",
      parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : undefined,
      color: typeof body.color === "string" && body.color ? body.color : undefined,
      raw,
    };
  } catch {
    return { id, name: raw, raw };
  }
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

export function normalizeDueDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    return Number.isNaN(Date.parse(`${trimmed}T00:00`)) ? undefined : trimmed;
  }
  return trimmed.includes("T") && !Number.isNaN(Date.parse(trimmed)) ? trimmed : undefined;
}

export function isAllDayDue(dueDate?: string): boolean {
  return Boolean(dueDate) && !dueDate?.includes("T");
}

function normalizePriority(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function priorityLabel(priority?: number): string | null {
  if (!priority || priority <= 0) return null;
  if (priority >= 3) return "High";
  return priority >= 2 ? "Medium" : "Low";
}

function normalizeCompletions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, MAX_TASK_COMPLETIONS);
}

function normalizeRecurrence(value: unknown): RecurrenceRule | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rule = value as RecurrenceRule;
  return RECURRENCE_FREQUENCIES.includes(rule.frequency) ? rule : undefined;
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
  if (!rolled) return { ...task, done: true, completedAt: doneAt, completions };
  return {
    ...task,
    done: undefined,
    completedAt: undefined,
    dueDate: rolled.dueDate,
    recurrenceAnchor: rolled.anchor,
    completions,
  };
}

export function reopenTask(task: Task): TaskDraft {
  return { ...task, done: undefined, completedAt: undefined };
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
  return collectionTone(lists, id);
}
