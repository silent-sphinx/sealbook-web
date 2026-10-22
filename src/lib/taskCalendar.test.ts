import { describe, expect, it } from "vitest";
import { dueTaskMarks } from "./taskCalendar";
import { DEFAULT_TASK_LIST_ID, parseTask, serializeTask } from "./task";
import type { TaskDraft } from "./types";

const TZ = "Europe/London";
const now = new Date("2026-10-22T10:00:00Z");

function aTask(id: string, overrides: Partial<TaskDraft> = {}) {
  return parseTask(id, serializeTask({ title: id, taskListId: DEFAULT_TASK_LIST_ID, ...overrides }));
}

describe("dueTaskMarks", () => {
  it("keys open tasks by the day they are due, soonest first", () => {
    const marks = dueTaskMarks(
      [
        aTask("b", { dueDate: "2026-10-25T14:00:00.000Z" }),
        aTask("a", { dueDate: "2026-10-25" }),
        aTask("c", { dueDate: "2026-10-26" }),
      ],
      now,
      TZ,
    );
    expect([...marks.keys()]).toEqual(["2026-10-25", "2026-10-26"]);
    expect(marks.get("2026-10-25")?.map((mark) => [mark.id, mark.timeLabel])).toEqual([
      ["a", null],
      ["b", "14:00"],
    ]);
  });

  it("puts a late-evening due time on the local day, not the UTC one", () => {
    const marks = dueTaskMarks([aTask("late", { dueDate: "2026-07-01T23:30:00.000Z" })], now, TZ);
    expect([...marks.keys()]).toEqual(["2026-07-02"]);
  });

  it("leaves out done and undated tasks", () => {
    const marks = dueTaskMarks([aTask("done", { done: true, dueDate: "2026-10-25" }), aTask("none")], now, TZ);
    expect(marks.size).toBe(0);
  });

  it("gives a recurring task one mark, at its current due date", () => {
    const marks = dueTaskMarks(
      [aTask("water", { dueDate: "2026-10-25", recurrence: { frequency: "daily" } })],
      now,
      TZ,
    );
    expect([...marks.values()].flat()).toHaveLength(1);
  });

  it("flags an overdue task", () => {
    const marks = dueTaskMarks([aTask("late", { dueDate: "2026-10-20" })], now, TZ);
    expect(marks.get("2026-10-20")?.[0]?.overdue).toBe(true);
  });
});
