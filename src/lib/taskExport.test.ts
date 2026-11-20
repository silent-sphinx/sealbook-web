import { describe, expect, it } from "vitest";
import { DEFAULT_TASK_LIST_ID, parseTask, parseTaskList, serializeTask, serializeTaskList } from "./task";
import { generateTaskExportData, parseTaskImport } from "./taskExport";
import type { TaskDraft } from "./types";

const lists = [
  parseTaskList(DEFAULT_TASK_LIST_ID, serializeTaskList("Default Task List")),
  parseTaskList("work", serializeTaskList("Work")),
];

function aTask(id: string, overrides: Partial<TaskDraft> = {}) {
  return parseTask(id, serializeTask({ title: id, taskListId: DEFAULT_TASK_LIST_ID, ...overrides }));
}

describe("a task export", () => {
  const tasks = [
    aTask("water", {
      notes: "jug",
      dueDate: "2026-10-23T08:30:00.000Z",
      priority: 3,
      tags: ["home"],
      recurrence: { frequency: "weekly", weekdays: [1, 4], interval: 2 },
      recurrenceAnchor: "2026-10-22",
      completions: ["2026-10-15T09:00:00.000Z"],
      taskListId: "work",
    }),
    aTask("old", { done: true, completedAt: "2026-10-01T09:00:00.000Z" }),
    aTask("child", { parentId: "water", taskListId: "work" }),
  ];

  it("names its type and carries the lists", () => {
    const { filename, mime, data } = generateTaskExportData(tasks, lists);
    const body = JSON.parse(data);
    expect(filename).toMatch(/^sealbook-tasks-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe("application/json");
    expect(body["@type"]).toBe("SealbookTasksExport");
    expect(body.lists.map((list: { name: string }) => list.name)).toEqual(["Default Task List", "Work"]);
    expect(body.tasks[0].listName).toBe("Work");
    expect(body.tasks[0].raw).toBeUndefined();
    expect(body.tasks[1].tags).toBeUndefined();
  });

  it("reads back as the tasks it was written from", () => {
    const { tasks: imported, skipped } = parseTaskImport(generateTaskExportData(tasks, lists).data);
    expect(skipped).toBe(0);
    expect(imported.map((entry) => entry.sourceId)).toEqual(["water", "old", "child"]);
    expect(imported[0]!.draft).toMatchObject({
      title: "water",
      notes: "jug",
      dueDate: "2026-10-23T08:30:00.000Z",
      priority: 3,
      tags: ["home"],
      recurrence: { frequency: "weekly", weekdays: [1, 4], interval: 2 },
      recurrenceAnchor: "2026-10-22",
      completions: ["2026-10-15T09:00:00.000Z"],
    });
    expect(imported[1]!.draft).toMatchObject({ done: true, completedAt: "2026-10-01T09:00:00.000Z" });
    expect(imported[2]!.draft.parentId).toBe("water");
  });
});

describe("parseTaskImport", () => {
  it("accepts a bare array of objects with a title", () => {
    const { tasks, skipped } = parseTaskImport('[{"title":"a","dueDate":"2026-10-23"},{"title":"b"}]');
    expect(tasks.map((entry) => entry.draft.title)).toEqual(["a", "b"]);
    expect(tasks[0]!.sourceId).toBeUndefined();
    expect(tasks[0]!.draft.dueDate).toBe("2026-10-23");
    expect(skipped).toBe(0);
  });

  it("skips entries with no title and counts them", () => {
    const { tasks, skipped } = parseTaskImport('[{"title":"a"},{"title":"  "},{"notes":"x"},7,null,[1]]');
    expect(tasks).toHaveLength(1);
    expect(skipped).toBe(5);
  });

  it("holds an entry to the rules a stored task is read by", () => {
    const { tasks } = parseTaskImport(
      '[{"title":"a","dueDate":"soon","priority":"high","done":"yes","tags":{"x":1},"recurrence":{"frequency":"hourly"}}]',
    );
    const draft = tasks[0]!.draft;
    expect(draft.dueDate).toBeUndefined();
    expect(draft.priority).toBeUndefined();
    expect(draft.done).toBeUndefined();
    expect(draft.recurrence).toBeUndefined();
    expect(draft.tags ?? []).toEqual([]);
  });

  it("refuses a document that is neither an export nor an array", () => {
    expect(() => parseTaskImport('{"title":"a"}')).toThrow(/Unrecognised format/);
    expect(() => parseTaskImport("7")).toThrow(/Unrecognised format/);
    expect(() => parseTaskImport("not json")).toThrow(/Unrecognised format/);
  });
});

describe("import order", () => {
  const ordered = (entries: [string, string?][]) =>
    parseTaskImport(
      JSON.stringify(entries.map(([id, parentId]) => ({ id, title: id, ...(parentId ? { parentId } : {}) }))),
    ).tasks;

  it("puts every parent before its subtasks, whatever order the file has", () => {
    const tasks = ordered([["leaf", "mid"], ["mid", "top"], ["top"]]);
    expect(tasks.map((task) => task.sourceId)).toEqual(["top", "mid", "leaf"]);
  });

  it("leaves a task at the top level when its parent is not in the file", () => {
    const [only] = ordered([["a", "missing"]]);
    expect(only!.draft.parentId).toBeUndefined();
  });

  it("breaks a cycle instead of looping", () => {
    const tasks = ordered([["a", "b"], ["b", "a"]]);
    expect(tasks).toHaveLength(2);
    expect(tasks.filter((task) => task.draft.parentId === undefined)).toHaveLength(1);
  });

  it("does not let a task be its own parent", () => {
    const [only] = ordered([["a", "a"]]);
    expect(only!.draft.parentId).toBeUndefined();
  });
});
