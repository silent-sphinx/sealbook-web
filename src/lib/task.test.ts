import { describe, expect, it } from "vitest";
import { expandCalendarEvents } from "./recurrence";
import {
  buildTaskListTree,
  canMoveTaskList,
  completeTask,
  DEFAULT_TASK_LIST_ID,
  dueLabel,
  emptyTaskDraft,
  inScope,
  isOverdue,
  MAX_TASK_COMPLETIONS,
  mergeTaskLists,
  mergeTasks,
  parseTask,
  parseTaskList,
  priorityLabel,
  reopenTask,
  serializeTask,
  serializeTaskList,
  sortTasks,
  TASK_CONTENT_TYPE,
  TASK_LIST_CONTENT_TYPE,
  taskFitsObjectLimit,
  taskMatches,
} from "./task";
import { buildTaskTree, canReparentTask, childCounts, flattenTaskTree } from "./taskTree";
import type { RecurrenceRule, Task, TaskDraft, TaskList } from "./types";

const TZ = "Europe/London";

function task(overrides: Partial<TaskDraft> = {}, id = "t1"): Task {
  const draft: TaskDraft = { ...emptyTaskDraft(DEFAULT_TASK_LIST_ID), title: "Water plants", ...overrides };
  return parseTask(id, serializeTask(draft));
}

function list(id: string, name: string, parentId?: string): TaskList {
  return parseTaskList(id, serializeTaskList(name, parentId));
}

describe("the wire constants", () => {
  it("match the protocol crate", () => {
    expect(TASK_CONTENT_TYPE).toBe("application/sealbook.task+json");
    expect(TASK_LIST_CONTENT_TYPE).toBe("application/sealbook.task-list+json");
    // Reserved id 6: 1 address book, 2 notebook, 3 calendar, 4 settings, 5 bookmarks.
    expect(DEFAULT_TASK_LIST_ID).toBe("00000000-0000-0000-0000-000000000006");
  });
});

describe("serializeTask and parseTask", () => {
  it("round-trips every field", () => {
    const rule: RecurrenceRule = { frequency: "weekly", weekdays: [1, 4], interval: 2 };
    const parsed = task({
      notes: " bring a jug ",
      done: true,
      completedAt: "2026-10-22T09:00:00.000Z",
      completions: ["2026-10-01T09:00:00.000Z"],
      dueDate: "2026-10-23T08:30:00.000Z",
      priority: 3,
      tags: ["home", "Home", "garden"],
      parentId: "p1",
      recurrence: rule,
      recurrenceAnchor: "2026-10-22",
    });
    expect(parsed).toMatchObject({
      title: "Water plants",
      notes: "bring a jug",
      done: true,
      completedAt: "2026-10-22T09:00:00.000Z",
      completions: ["2026-10-01T09:00:00.000Z"],
      dueDate: "2026-10-23T08:30:00.000Z",
      priority: 3,
      tags: ["home", "garden"],
      taskListId: DEFAULT_TASK_LIST_ID,
      parentId: "p1",
      recurrence: rule,
      recurrenceAnchor: "2026-10-22",
    });
  });

  it("omits what is empty rather than writing it", () => {
    const body = JSON.parse(serializeTask(emptyTaskDraft(DEFAULT_TASK_LIST_ID))) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["@type", "createdAt", "taskListId", "title", "updatedAt", "version"].sort(),
    );
  });

  it("carries a field this build does not know through an edit", () => {
    const stored = JSON.stringify({ "@type": "Task", title: "x", taskListId: DEFAULT_TASK_LIST_ID, estimateMinutes: 25 });
    const edited = JSON.parse(serializeTask({ ...parseTask("t", stored), title: "y" })) as Record<string, unknown>;
    expect(edited.estimateMinutes).toBe(25);
    expect(edited.title).toBe("y");
  });

  it("does not bring a cleared field back", () => {
    const original = task({ dueDate: "2026-10-23", notes: "n", priority: 2, parentId: "p" });
    const cleared = JSON.parse(
      serializeTask({ ...original, dueDate: undefined, notes: undefined, priority: undefined, parentId: undefined }),
    ) as Record<string, unknown>;
    for (const key of ["dueDate", "notes", "priority", "parentId"]) expect(key in cleared).toBe(false);
  });

  it("writes completedAt only while the task is done", () => {
    const body = JSON.parse(serializeTask({ ...task(), completedAt: "2026-10-22T09:00:00.000Z" })) as Record<string, unknown>;
    expect("completedAt" in body).toBe(false);
  });

  it("keeps a priority from a newer build", () => {
    const seven = task({ priority: 7 });
    expect(seven.priority).toBe(7);
    expect(priorityLabel(7)).toBe("High");
    expect(priorityLabel(undefined)).toBeNull();
  });

  it("reads hostile payloads without throwing", () => {
    const hostile = [
      '{"done":"yes","tags":{"a":1},"priority":"high","completions":"nope","recurrence":7,"parentId":42,"dueDate":"soon"}',
      "[1,2]",
      '{"recurrence":{"frequency":"hourly"}}',
    ];
    for (const raw of hostile) {
      const parsed = parseTask("t", raw);
      expect(parsed.title).toBe("Untitled task");
      expect(parsed.done).toBeUndefined();
      expect(parsed.tags).toEqual([]);
      expect(parsed.priority).toBeUndefined();
      expect(parsed.recurrence).toBeUndefined();
      expect(parsed.parentId).toBeUndefined();
      expect(parsed.dueDate).toBeUndefined();
      expect(parsed.taskListId).toBe(DEFAULT_TASK_LIST_ID);
    }
    for (const raw of ["}{", "null"]) expect(parseTask("t", raw).title).toBe("Unreadable task");
  });
});

describe("completeTask", () => {
  const now = new Date("2026-10-22T10:00:00Z");

  it("marks a plain task done", () => {
    const done = completeTask(task(), now, TZ);
    expect(done.done).toBe(true);
    expect(done.completedAt).toBe(now.toISOString());
    expect(done.completions).toEqual([]);
  });

  it("rolls a recurring task forward and keeps it open", () => {
    const daily = task({ dueDate: "2026-10-22", recurrence: { frequency: "daily" } });
    const rolled = completeTask(daily, now, TZ);
    expect(rolled.done).toBeUndefined();
    expect(rolled.dueDate).toBe("2026-10-23");
    expect(rolled.recurrenceAnchor).toBe("2026-10-22");
    expect(rolled.completions).toEqual([now.toISOString()]);
    expect(JSON.parse(serializeTask(rolled)).done).toBeUndefined();
  });

  it("skips occurrences already past when completed late", () => {
    const stale = task({ dueDate: "2026-10-10", recurrence: { frequency: "daily" } });
    expect(completeTask(stale, now, TZ).dueDate).toBe("2026-10-23");
  });

  it("moves on from a due date that is still ahead", () => {
    const early = task({ dueDate: "2026-10-30", recurrence: { frequency: "weekly" } });
    expect(completeTask(early, now, TZ).dueDate).toBe("2026-11-06");
  });

  it("completes for good when the rule has run out", () => {
    const last = task({ dueDate: "2026-10-22", recurrence: { frequency: "daily", until: "2026-10-22" } });
    const done = completeTask(last, now, TZ);
    expect(done.done).toBe(true);
    expect(done.dueDate).toBe("2026-10-22");
    expect(done.completions).toEqual([now.toISOString()]);
  });

  it("runs out at count without a stored counter", () => {
    let current = task({ dueDate: "2026-10-22", recurrence: { frequency: "daily", count: 3 } });
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = completeTask(current, new Date(`${current.dueDate}T10:00:00Z`), TZ);
      seen.push(next.done ? "done" : next.dueDate);
      current = parseTask("t1", serializeTask(next));
    }
    expect(seen).toEqual(["2026-10-23", "2026-10-24", "done"]);
  });

  it("does not drift: repeated roll-forwards match the calendar expander", () => {
    const rule: RecurrenceRule = { frequency: "weekly", weekdays: [1, 4], interval: 2 };
    const expected = expandCalendarEvents(
      [{ id: "e", title: "e", start: "2026-10-22", recurrence: rule }],
      new Date(2026, 9, 1),
      new Date(2027, 2, 31),
      TZ,
    )
      .map((event) => event.occurrenceKey)
      .slice(0, 10);
    let current = task({ dueDate: "2026-10-22", recurrence: rule });
    const walked = [current.dueDate];
    while (walked.length < expected.length) {
      const next = completeTask(current, new Date(`${current.dueDate}T10:00:00Z`), TZ);
      current = parseTask("t1", serializeTask(next));
      walked.push(current.dueDate);
    }
    expect(walked).toEqual(expected);
  });

  it("skips months without a 31st and keeps the anchor", () => {
    const monthly = task({ dueDate: "2026-01-31", recurrence: { frequency: "monthly" } });
    const first = completeTask(monthly, new Date("2026-01-31T10:00:00Z"), TZ);
    expect(first.dueDate).toBe("2026-03-31");
    const second = completeTask(parseTask("t", serializeTask(first)), new Date("2026-03-31T10:00:00Z"), TZ);
    expect(second.dueDate).toBe("2026-05-31");
    expect(second.recurrenceAnchor).toBe("2026-01-31");
  });

  it("keeps the wall-clock time of a timed due date across a DST change", () => {
    const weekly = task({ dueDate: "2026-03-23T09:00:00.000Z", recurrence: { frequency: "weekly" } });
    const rolled = completeTask(weekly, new Date("2026-03-23T10:00:00Z"), TZ);
    expect(rolled.dueDate).toBe("2026-03-30T08:00:00.000Z");
  });

  it("caps the completion history, dropping the oldest", () => {
    const history = Array.from({ length: MAX_TASK_COMPLETIONS }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    const daily = task({ dueDate: "2026-10-22", recurrence: { frequency: "daily" }, completions: history });
    const rolled = completeTask(daily, now, TZ);
    expect(rolled.completions).toHaveLength(MAX_TASK_COMPLETIONS);
    expect(rolled.completions?.[0]).toBe(now.toISOString());
    expect(rolled.completions).not.toContain(history[history.length - 1]);
  });

  it("treats a recurrence with no due date as a one-off", () => {
    expect(completeTask(task({ recurrence: { frequency: "daily" } }), now, TZ).done).toBe(true);
  });

  it("reopens a done task", () => {
    const reopened = reopenTask(completeTask(task(), now, TZ) as Task);
    expect(reopened.done).toBeUndefined();
    expect(reopened.completedAt).toBeUndefined();
  });
});

describe("scopes, order and search", () => {
  const now = new Date("2026-10-22T10:00:00Z");

  it("sorts open before done, then by due date, priority and title", () => {
    const ordered = sortTasks([
      task({ title: "done", done: true, dueDate: "2026-10-01" }, "a"),
      task({ title: "later", dueDate: "2026-10-25" }, "b"),
      task({ title: "undated" }, "c"),
      task({ title: "soon, low", dueDate: "2026-10-23", priority: 1 }, "d"),
      task({ title: "soon, high", dueDate: "2026-10-23", priority: 3 }, "e"),
    ]);
    expect(ordered.map((t) => t.title)).toEqual(["soon, high", "soon, low", "later", "undated", "done"]);
  });

  it("filters the smart views", () => {
    const today = task({ dueDate: "2026-10-22" }, "a");
    const late = task({ dueDate: "2026-10-20" }, "b");
    const timedLate = task({ dueDate: "2026-10-22T08:00:00.000Z" }, "c");
    const finished = task({ done: true, dueDate: "2026-10-20" }, "d");
    const undated = task({}, "e");
    const pick = (scope: Parameters<typeof inScope>[1]) =>
      [today, late, timedLate, finished, undated].filter((t) => inScope(t, scope, now, TZ)).map((t) => t.id);
    expect(pick("today")).toEqual(["a", "c"]);
    expect(pick("overdue")).toEqual(["b", "c"]);
    expect(pick("completed")).toEqual(["d"]);
    expect(pick("all")).toEqual(["a", "b", "c", "d", "e"]);
    expect(isOverdue(finished, now, TZ)).toBe(false);
  });

  it("matches on title, notes and tags", () => {
    const t = task({ title: "Plants", notes: "Use rainwater", tags: ["garden"] });
    expect(taskMatches(t, "plant")).toBe(true);
    expect(taskMatches(t, "RAIN")).toBe(true);
    expect(taskMatches(t, "gard")).toBe(true);
    expect(taskMatches(t, "zebra")).toBe(false);
    expect(taskMatches(t, "  ")).toBe(true);
  });

  it("refuses a body past the object limit", () => {
    expect(taskFitsObjectLimit(emptyTaskDraft(DEFAULT_TASK_LIST_ID))).toBe(true);
    expect(taskFitsObjectLimit({ ...emptyTaskDraft(DEFAULT_TASK_LIST_ID), notes: "x".repeat(9 * 1024 * 1024) })).toBe(false);
  });
});

describe("task lists and subtasks", () => {
  const lists = [
    list(DEFAULT_TASK_LIST_ID, "Default Task List"),
    list("work", "Work"),
    list("sub", "Sub", "work"),
  ];

  it("nests lists with the default first", () => {
    const tree = buildTaskListTree(lists);
    expect(tree.map((node) => node.item.id)).toEqual([DEFAULT_TASK_LIST_ID, "work"]);
    expect(tree[1].children.map((node) => node.item.id)).toEqual(["sub"]);
  });

  it("keeps the default list at the top and refuses a cycle", () => {
    expect(canMoveTaskList(lists, DEFAULT_TASK_LIST_ID, "work")).toBe(false);
    expect(canMoveTaskList(lists, DEFAULT_TASK_LIST_ID, null)).toBe(true);
    expect(canMoveTaskList(lists, "work", "sub")).toBe(false);
    expect(canMoveTaskList(lists, "sub", null)).toBe(true);
  });

  it("builds the subtask tree for one list and treats a parent elsewhere as absent", () => {
    const tasks = [
      task({ title: "parent" }, "p"),
      task({ title: "child", parentId: "p" }, "c"),
      task({ title: "stray", parentId: "p", taskListId: "work" }, "s"),
    ];
    const home = buildTaskTree(tasks, DEFAULT_TASK_LIST_ID);
    expect(flattenTaskTree(home).map((node) => [node.task.id, node.depth])).toEqual([["p", 0], ["c", 1]]);
    expect(buildTaskTree(tasks, "work").map((node) => node.task.id)).toEqual(["s"]);
  });

  it("refuses to drop a task under its own subtask", () => {
    const tasks = [task({}, "p"), task({ parentId: "p" }, "c")];
    expect(canReparentTask(tasks, "p", "c")).toBe(false);
    expect(canReparentTask(tasks, "c", null)).toBe(true);
  });
});

describe("dueLabel", () => {
  const now = new Date("2026-10-22T10:00:00Z");

  it("names the days around today", () => {
    expect(dueLabel(task({ dueDate: "2026-10-22" }), now, TZ)).toBe("Today");
    expect(dueLabel(task({ dueDate: "2026-10-23" }), now, TZ)).toBe("Tomorrow");
    expect(dueLabel(task({ dueDate: "2026-10-21" }), now, TZ)).toBe("Yesterday");
    expect(dueLabel(task(), now, TZ)).toBeNull();
  });

  it("adds the local time to a timed due date", () => {
    expect(dueLabel(task({ dueDate: "2026-10-23T08:30:00.000Z" }), now, TZ)).toBe("Tomorrow 09:30");
  });
});

describe("childCounts", () => {
  it("counts direct subtasks and how many are done", () => {
    const tasks = [
      task({}, "p"),
      task({ parentId: "p", done: true }, "a"),
      task({ parentId: "p" }, "b"),
      task({ parentId: "missing" }, "c"),
    ];
    expect(childCounts(tasks).get("p")).toEqual({ done: 1, total: 2 });
    expect(childCounts(tasks).has("missing")).toBe(false);
  });
});

describe("mergeTasks and mergeTaskLists", () => {
  it("replaces a task in place and keeps the order a listing would give", () => {
    const current = [task({ title: "Water plants" }, "a"), task({ title: "Pay rent" }, "b")];
    const merged = mergeTasks(current, [task({ title: "Water plants", done: true }, "a")]);
    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
    expect(merged.find((item) => item.id === "a")?.done).toBe(true);
  });

  it("adds a task it has not seen", () => {
    const merged = mergeTasks([task({}, "a")], [task({ title: "New" }, "b")]);
    expect(merged.map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("drops a removed id, even when the same id was also written", () => {
    const current = [task({}, "a"), task({ title: "Child" }, "b")];
    const merged = mergeTasks(current, [task({}, "a")], ["a"]);
    expect(merged.map((item) => item.id)).toEqual(["b"]);
  });

  it("merges task lists the same way, default list first", () => {
    const current = [list("work", "Work"), list(DEFAULT_TASK_LIST_ID, "Tasks")];
    const merged = mergeTaskLists(current, [list("errands", "Errands")], ["work"]);
    expect(merged.map((item) => item.id)).toEqual([DEFAULT_TASK_LIST_ID, "errands"]);
  });
});
