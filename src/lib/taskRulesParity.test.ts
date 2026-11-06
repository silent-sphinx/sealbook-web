import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  draftFrom,
  listTo,
  parseTask,
  parseTaskList,
  serializeTask,
  serializeTaskList,
  taskTo,
  tickTask,
} from "./task";
import { parseTaskImport } from "./taskExport";
import { localInputToUtc } from "./timezone";
import {
  coreOrderTasks,
  coreTaskAgenda,
  coreTaskListMovePlan,
  coreTaskListRemovePlan,
  coreTaskMovePlan,
  coreTaskRelistPlan,
  coreTaskRemovePlan,
} from "./wasm";
import type {
  CoreTaskAgenda,
  CoreTaskAgendaItem,
  CoreTaskClock,
  CoreTaskOrderItem,
  CoreTaskPlan,
} from "./wasm";
import { readFixture } from "../test/fixtures";

/**
 * The shared task rules fixture, held to the same document as
 * `sealbook-core/tests/task_rules.rs`. Every write goes through this client's
 * own draft mapping, so a field lost on the way to core shows up here.
 */
type Stored = { id: string; raw: string };
type Written = { id: string; payload: string };

type Fixture = {
  now: string;
  refusals: { import: string };
  completions: {
    case: string;
    tasks: Stored[];
    id: string;
    clock: CoreTaskClock;
    rolled: boolean;
    local_due?: string | null;
    writes: Written[];
  }[];
  plans: {
    case: string;
    action: string;
    tasks: Stored[];
    lists: Stored[];
    id: string;
    parent_id?: string | null;
    refusal?: string | null;
    task_writes: Written[];
    list_writes: Written[];
    removed_tasks: string[];
    removed_lists: string[];
  }[];
  orders: { case: string; items: CoreTaskOrderItem[]; order: string[] }[];
  agendas: { case: string; now_local: string; items: CoreTaskAgendaItem[]; agenda: CoreTaskAgenda }[];
  imports: {
    case: string;
    text: string;
    refused: boolean;
    skipped: number;
    tasks: { source_id?: string | null; payload: string }[];
  }[];
};

const fixture = JSON.parse(readFixture("payloads/task-rules.json")) as Fixture;

// One hour ahead of UTC in November, which is the offset the timed case uses.
const TZ = "Europe/Paris";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(fixture.now));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("ticking a task", () => {
  it.each(fixture.completions)("$case", (entry) => {
    const tasks = entry.tasks.map((stored) => parseTask(stored.id, stored.raw));
    const task = tasks.find((candidate) => candidate.id === entry.id)!;
    const tick = tickTask(task, tasks, new Date(entry.clock.now), TZ);
    expect(tick.rolled).toBe(entry.rolled);
    // A rolled timed task is stored in UTC, which the fixture leaves to the host.
    const hostDue = entry.local_due ? localInputToUtc(entry.local_due, TZ) : undefined;
    expect(entry.local_due ? tick.draft.dueDate : undefined).toBe(hostDue);
    const draft = entry.local_due ? { ...tick.draft, dueDate: undefined } : tick.draft;
    const writes = [
      { id: entry.id, payload: serializeTask(draft) },
      ...tick.reopened.map((write) => ({ id: write.id, payload: serializeTask(write.draft) })),
    ];
    expect(writes).toEqual(entry.writes);
  });
});

function planFor(entry: Fixture["plans"][number]): CoreTaskPlan {
  const tasks = entry.tasks.map((stored) => taskTo(parseTask(stored.id, stored.raw)));
  const lists = entry.lists.map((stored) => listTo(parseTaskList(stored.id, stored.raw)));
  const parent = entry.parent_id ?? undefined;
  switch (entry.action) {
    case "remove":
      return coreTaskRemovePlan(tasks, entry.id);
    case "move":
      return coreTaskMovePlan(tasks, entry.id, parent);
    case "relist":
      return coreTaskRelistPlan(tasks, entry.id, parent ?? "");
    case "list_move":
      return coreTaskListMovePlan(lists, entry.id, parent);
    case "list_remove":
      return coreTaskListRemovePlan(lists, tasks, entry.id);
    default:
      throw new Error(`unknown action ${entry.action}`);
  }
}

describe("deleting and moving", () => {
  it.each(fixture.plans)("$case", (entry) => {
    const plan = planFor(entry);
    expect(plan.refusal ?? null).toBe(entry.refusal ?? null);
    expect(
      plan.tasks.map(({ id, draft }) => ({ id, payload: serializeTask(draftFrom(draft)) })),
    ).toEqual(entry.task_writes);
    expect(
      plan.lists.map(({ id, draft }) => ({
        id,
        payload: serializeTaskList(draft.name, draft.parent_id, draft.raw, draft.color),
      })),
    ).toEqual(entry.list_writes);
    expect(plan.removed_tasks).toEqual(entry.removed_tasks);
    expect(plan.removed_lists).toEqual(entry.removed_lists);
  });
});

describe("task order", () => {
  it.each(fixture.orders)("$case", (entry) => {
    expect(coreOrderTasks(entry.items)).toEqual(entry.order);
  });
});

describe("the agenda", () => {
  it.each(fixture.agendas)("$case", (entry) => {
    expect(coreTaskAgenda(entry.items, entry.now_local)).toEqual(entry.agenda);
  });
});

describe("importing a task file", () => {
  it.each(fixture.imports.filter((entry) => !entry.refused))("$case", (entry) => {
    const read = parseTaskImport(entry.text);
    expect(read.skipped).toBe(entry.skipped);
    expect(
      read.tasks.map((task) => ({
        source_id: task.sourceId ?? null,
        payload: serializeTask(task.draft),
      })),
    ).toEqual(entry.tasks.map((task) => ({ ...task, source_id: task.source_id ?? null })));
  });

  it.each(fixture.imports.filter((entry) => entry.refused))("$case is refused", (entry) => {
    expect(() => parseTaskImport(entry.text)).toThrow(fixture.refusals.import);
  });
});
