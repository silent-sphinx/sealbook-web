import {
  draftFrom,
  reopenTask,
  resolveTaskListId,
  taskDraft,
  taskTo,
  taskWritable,
  tickTask,
} from "./task";
import type { Task, TaskDraft } from "./types";
import { coreTaskRelistPlan } from "./wasm";

export type TaskBulkChange =
  | { kind: "complete" }
  | { kind: "reopen" }
  | { kind: "move"; taskListId: string }
  /** `dueDate` as `Task.dueDate`; absent clears it. */
  | { kind: "due"; dueDate?: string }
  | { kind: "delete" };

export type TaskBulkPlan = {
  writes: { id: string; draft: TaskDraft }[];
  removed: string[];
  /** Selected tasks left alone because this build may not write them. */
  skipped: number;
};

/**
 * What a change to many tasks at once writes. Tasks come out of one plan so the
 * writes agree with each other: a subtask follows its parent into a list, and
 * deleting a parent and its child together leaves no subtask pointing at either.
 */
export function planTaskBulk(
  change: TaskBulkChange,
  targets: Task[],
  all: Task[],
  now: Date,
  timezone: string,
): TaskBulkPlan {
  const writable = targets.filter((task) => taskWritable(taskDraft(task)));
  const skipped = targets.length - writable.length;
  const writes = new Map<string, TaskDraft>();
  const removed: string[] = [];

  switch (change.kind) {
    case "complete": {
      const own = new Set(writable.map((task) => task.id));
      for (const task of writable.filter((entry) => !entry.done)) {
        const tick = tickTask(task, all, now, timezone);
        // A subtask a roll reopens is only written when it is not itself being changed.
        for (const entry of tick.reopened) if (!own.has(entry.id)) writes.set(entry.id, entry.draft);
        writes.set(task.id, tick.draft);
      }
      break;
    }
    case "reopen":
      for (const task of writable.filter((entry) => entry.done)) writes.set(task.id, reopenTask(task));
      break;
    case "due":
      for (const task of writable) writes.set(task.id, { ...taskDraft(task), dueDate: change.dueDate });
      break;
    case "move": {
      const chosen = new Set(writable.map((task) => task.id));
      const byId = new Map(all.map((task) => [task.id, task]));
      const target = resolveTaskListId(change.taskListId);
      const coreAll = all.map(taskTo);
      for (const task of writable) {
        if (resolveTaskListId(task.taskListId) === target) continue;
        // A chosen subtask rides along with its chosen ancestor.
        let ancestor = task.parentId ? byId.get(task.parentId) : undefined;
        let rides = false;
        while (ancestor) {
          if (chosen.has(ancestor.id)) {
            rides = true;
            break;
          }
          ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
        }
        if (rides) continue;
        writes.set(task.id, { ...taskDraft(task), taskListId: target, parentId: undefined });
        for (const follower of coreTaskRelistPlan(coreAll, task.id, target).tasks) {
          writes.set(follower.id, draftFrom(follower.draft));
        }
      }
      break;
    }
    case "delete": {
      const gone = new Set(writable.map((task) => task.id));
      const byId = new Map(all.map((task) => [task.id, task]));
      removed.push(...gone);
      for (const task of all) {
        if (gone.has(task.id) || !task.parentId || !gone.has(task.parentId)) continue;
        // Subtasks move up past every deleted ancestor, to the first one that stays.
        let parentId: string | undefined = task.parentId;
        while (parentId && gone.has(parentId)) parentId = byId.get(parentId)?.parentId;
        writes.set(task.id, { ...taskDraft(task), parentId });
      }
      break;
    }
  }

  return { writes: [...writes].map(([id, draft]) => ({ id, draft })), removed, skipped };
}
