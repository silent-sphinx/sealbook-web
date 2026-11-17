import { describe, expect, it } from "vitest";
import { DEFAULT_TASK_LIST_ID, emptyTaskDraft, parseTask, serializeTask } from "./task";
import { planTaskBulk } from "./taskBulk";
import type { Task, TaskDraft } from "./types";

const TZ = "Europe/London";
const NOW = new Date("2026-03-10T09:00:00Z");

function task(id: string, overrides: Partial<TaskDraft> = {}): Task {
  const draft: TaskDraft = { ...emptyTaskDraft(DEFAULT_TASK_LIST_ID), title: id, ...overrides };
  return parseTask(id, serializeTask(draft));
}

function plan(change: Parameters<typeof planTaskBulk>[0], ids: string[], all: Task[]) {
  return planTaskBulk(change, all.filter((entry) => ids.includes(entry.id)), all, NOW, TZ);
}

describe("planTaskBulk", () => {
  it("completes only the open tasks", () => {
    const all = [task("a"), task("b", { done: true })];
    const result = plan({ kind: "complete" }, ["a", "b"], all);
    expect(result.writes.map((write) => write.id)).toEqual(["a"]);
    expect(result.writes[0].draft.done).toBe(true);
  });

  it("reopens only the done tasks", () => {
    const all = [task("a"), task("b", { done: true })];
    const result = plan({ kind: "reopen" }, ["a", "b"], all);
    expect(result.writes.map((write) => write.id)).toEqual(["b"]);
    expect(result.writes[0].draft.done).toBeFalsy();
  });

  it("sets and clears the due date", () => {
    const all = [task("a", { dueDate: "2026-01-01" }), task("b")];
    const set = plan({ kind: "due", dueDate: "2026-04-01" }, ["a", "b"], all);
    expect(set.writes.map((write) => write.draft.dueDate)).toEqual(["2026-04-01", "2026-04-01"]);
    const cleared = plan({ kind: "due" }, ["a"], all);
    expect(cleared.writes[0].draft.dueDate).toBeUndefined();
  });

  it("moves a task to a list, leaves its parent and takes its subtasks along", () => {
    const all = [task("p"), task("c", { parentId: "p" }), task("g", { parentId: "c" }), task("x")];
    const result = plan({ kind: "move", taskListId: "work" }, ["c"], all);
    const byId = new Map(result.writes.map((write) => [write.id, write.draft]));
    expect(byId.get("c")).toMatchObject({ taskListId: "work", parentId: undefined });
    expect(byId.get("g")).toMatchObject({ taskListId: "work", parentId: "c" });
    expect(byId.has("p")).toBe(false);
  });

  it("keeps a chosen subtask under its chosen parent when moving both", () => {
    const all = [task("p"), task("c", { parentId: "p" })];
    const result = plan({ kind: "move", taskListId: "work" }, ["p", "c"], all);
    const byId = new Map(result.writes.map((write) => [write.id, write.draft]));
    expect(byId.get("p")).toMatchObject({ taskListId: "work" });
    expect(byId.get("c")).toMatchObject({ taskListId: "work", parentId: "p" });
  });

  it("does not rewrite a task already in the list", () => {
    const all = [task("a")];
    expect(plan({ kind: "move", taskListId: DEFAULT_TASK_LIST_ID }, ["a"], all).writes).toEqual([]);
  });

  it("deletes a parent and child together and moves the grandchild up past both", () => {
    const all = [task("top"), task("p", { parentId: "top" }), task("c", { parentId: "p" }), task("g", { parentId: "c" })];
    const result = plan({ kind: "delete" }, ["p", "c"], all);
    expect(result.removed.sort()).toEqual(["c", "p"]);
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]).toMatchObject({ id: "g", draft: { parentId: "top" } });
  });

  it("deletes a lone parent and lifts its subtasks one level", () => {
    const all = [task("p"), task("c", { parentId: "p" })];
    const result = plan({ kind: "delete" }, ["p"], all);
    expect(result.writes[0]).toMatchObject({ id: "c", draft: { parentId: undefined } });
  });
});
