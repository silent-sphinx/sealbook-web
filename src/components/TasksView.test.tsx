// @vitest-environment jsdom
/**
 * The tasks view, mounted on its own.
 *
 * `lib/client` is faked rather than driven through a session, as in the other
 * view suites: every write would otherwise need an OPAQUE exchange only the
 * server can answer. Assertions are made against what the fake was asked to
 * write.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import {
  DEFAULT_TASK_LIST_ID,
  mergeTaskLists,
  mergeTasks,
  parseTask,
  parseTaskList,
  serializeTask,
  serializeTaskList,
} from "../lib/task";
import { useSidebar } from "./SidebarDrawer";
import type { Session } from "../lib/client";
import type { Task, TaskDraft, TaskList, TaskPatch } from "../lib/types";

let tasks: Task[] = [];
let taskLists: TaskList[] = [];
let writes: { id: string | undefined; draft: TaskDraft }[] = [];
let deletes: string[] = [];
let listWrites: { name: string; parentId?: string; id?: string; color?: string }[] = [];
let listDeletes: string[] = [];
let ensured = 0;
let refreshes = 0;
let applied = 0;

vi.mock("../lib/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/client")>("../lib/client");
  return {
    ...actual,
    ensureDefaultTaskList: async () => {
      ensured += 1;
      taskLists = [parseTaskList(DEFAULT_TASK_LIST_ID, serializeTaskList("Default Task List")), ...taskLists];
      return taskLists;
    },
    putTask: async (_session: unknown, draft: TaskDraft, id?: string) => {
      writes.push({ id, draft });
      const made = id ?? `task-${writes.length}`;
      const saved = parseTask(made, serializeTask(draft));
      tasks = tasks.some((item) => item.id === made)
        ? tasks.map((item) => (item.id === made ? saved : item))
        : [...tasks, saved];
      return saved;
    },
    deleteTask: async (_session: unknown, id: string) => {
      deletes.push(id);
      tasks = tasks.filter((item) => item.id !== id);
    },
    putTaskList: async (
      _session: unknown,
      name: string,
      parentId?: string,
      id?: string,
      _raw?: string,
      color?: string,
    ) => {
      listWrites.push({ name, parentId, id, color });
      const made = id ?? `list-${name}`;
      const saved = parseTaskList(made, serializeTaskList(name, parentId, undefined, color));
      taskLists = taskLists.some((item) => item.id === made)
        ? taskLists.map((item) => (item.id === made ? saved : item))
        : [...taskLists, saved];
      return saved;
    },
    deleteTaskList: async (_session: unknown, id: string) => {
      listDeletes.push(id);
      taskLists = taskLists.filter((item) => item.id !== id);
    },
  };
});

const { TasksView } = await import("./TasksView");

const SESSION = { state: { username: "ada" } } as unknown as Session;
const TZ = "Europe/London";
const DEFAULT_LIST = parseTaskList(DEFAULT_TASK_LIST_ID, serializeTaskList("Default Task List"));

function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
}

function aTask(id: string, overrides: Partial<TaskDraft> = {}): Task {
  return parseTask(id, serializeTask({ title: id, taskListId: DEFAULT_TASK_LIST_ID, ...overrides }));
}

function Harness({ readOnly }: { readOnly?: boolean }) {
  const [vault, setVault] = useState({ tasks, taskLists });
  const sidebar = useSidebar();
  return (
    <TasksView
      session={SESSION}
      tasks={vault.tasks}
      taskLists={vault.taskLists}
      busy={false}
      timezone={TZ}
      readOnly={readOnly}
      sidebar={sidebar}
      onRefresh={async () => {
        refreshes += 1;
        setVault({ tasks, taskLists });
      }}
      onApply={(patch: TaskPatch) => {
        applied += 1;
        setVault((current) => ({
          tasks: mergeTasks(current.tasks, patch.tasks ?? [], patch.removedTaskIds),
          taskLists: mergeTaskLists(
            current.taskLists,
            patch.taskLists ?? [],
            patch.removedTaskListIds,
          ),
        }));
      }}
    />
  );
}

function mount(seed: { tasks?: Task[]; taskLists?: TaskList[]; readOnly?: boolean } = {}) {
  tasks = seed.tasks ?? [];
  taskLists = seed.taskLists ?? [DEFAULT_LIST];
  return render(<Harness readOnly={seed.readOnly} />);
}

function sidebar(): HTMLElement {
  const aside = document.querySelector("aside");
  if (!aside) throw new Error("no sidebar");
  return aside as HTMLElement;
}

function pick(name: string): void {
  fireEvent.click(within(sidebar()).getByRole("button", { name: new RegExp(`^${name}\\d*$`) }));
}

function tick(title: string): void {
  fireEvent.click(screen.getByRole("checkbox", { name: `Complete ${title}` }));
}

/** Opens a parent's dropdown; subtasks are hidden until it is clicked. */
function expand(title: string): void {
  fireEvent.click(screen.getByRole("button", { name: `Expand ${title}` }));
}

function field(label: string): HTMLElement {
  return screen.getByLabelText(label);
}

beforeEach(() => {
  tasks = [];
  taskLists = [DEFAULT_LIST];
  writes = [];
  deletes = [];
  listWrites = [];
  listDeletes = [];
  ensured = 0;
  refreshes = 0;
  applied = 0;
});

describe("TasksView, the default list", () => {
  it("creates it on first entry, once", async () => {
    mount({ taskLists: [] });
    await waitFor(() => expect(ensured).toBe(1));
    expect(applied).toBe(1);
    expect(refreshes).toBe(0);
    await waitFor(() => expect(within(sidebar()).getByText("Default Task List")).not.toBeNull());
  });

  it("does not write when it is already there", async () => {
    mount();
    await Promise.resolve();
    expect(ensured).toBe(0);
  });

  it("writes nothing when read only", async () => {
    mount({ taskLists: [], readOnly: true });
    await Promise.resolve();
    expect(ensured).toBe(0);
  });
});

describe("TasksView, the views", () => {
  const seed = () => [
    aTask("today", { dueDate: day(0) }),
    aTask("late", { dueDate: day(-3) }),
    aTask("soon", { dueDate: day(4) }),
    aTask("finished", { done: true, dueDate: day(-1) }),
    aTask("undated"),
  ];

  it("shows every open task under All tasks, newest due first", () => {
    mount({ tasks: seed() });
    pick("All tasks");
    const titles = screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
    expect(titles).toEqual([
      "Complete late",
      "Complete today",
      "Complete soon",
      "Complete undated",
      "Complete finished",
    ]);
  });

  it("filters Today, Overdue and Completed", () => {
    mount({ tasks: seed() });
    const shown = () => screen.queryAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
    pick("Today");
    expect(shown()).toEqual(["Complete today"]);
    pick("Overdue");
    expect(shown()).toEqual(["Complete late"]);
    pick("Completed");
    expect(shown()).toEqual(["Complete finished"]);
  });

  it("filters by search across the current view", () => {
    mount({ tasks: [aTask("water plants", { tags: ["home"] }), aTask("pay rent")] });
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "home" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "zebra" } });
    expect(screen.getByText("No tasks match that search.")).not.toBeNull();
  });
});

describe("TasksView, ticking a task", () => {
  it("marks a plain task done", async () => {
    mount({ tasks: [aTask("water")] });
    tick("water");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.id).toBe("water");
    expect(writes[0]!.draft.done).toBe(true);
  });

  it("reopens a done task", async () => {
    mount({ tasks: [aTask("water", { done: true })] });
    tick("water");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.done).toBeUndefined();
  });

  it("rolls a recurring task forward instead of finishing it, and can undo", async () => {
    mount({ tasks: [aTask("water", { dueDate: day(0), recurrence: { frequency: "daily" } })] });
    tick("water");
    await waitFor(() => expect(writes).toHaveLength(1));
    const rolled = JSON.parse(serializeTask(writes[0]!.draft)) as Record<string, unknown>;
    expect(rolled.done).toBeUndefined();
    expect(rolled.dueDate).toBe(day(1));
    expect((await screen.findByRole("status")).textContent).toContain("next due Tomorrow");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.draft.dueDate).toBe(day(0));
    expect(writes[1]!.draft.completions ?? []).toEqual([]);
  });

  it("reopens done subtasks when a recurring task rolls forward, and undo restores them", async () => {
    mount({
      tasks: [
        aTask("water", { dueDate: day(0), recurrence: { frequency: "daily" } }),
        aTask("fill", { parentId: "water", done: true }),
      ],
    });
    tick("water");
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.draft.title).toBe("fill");
    expect(writes[1]!.draft.done).toBeUndefined();

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(writes).toHaveLength(4));
    expect(writes[3]!.draft.done).toBe(true);
  });
});

describe("TasksView, the form", () => {
  it("refuses a task with no title", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Give the task a title.");
    expect(writes).toEqual([]);
  });

  it("refuses a repeat with no due date", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.change(field("Title"), { target: { value: "Water" } });
    fireEvent.change(field("Repeat"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Set a due date to repeat a task.");
    expect(writes).toEqual([]);
  });

  it("writes what was entered, into the list that is open", async () => {
    mount({ taskLists: [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))] });
    pick("Work");
    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.change(field("Title"), { target: { value: "  Ship it  " } });
    fireEvent.change(field("Due date"), { target: { value: day(2) } });
    fireEvent.change(field("Priority"), { target: { value: "3" } });
    fireEvent.change(field("Tags"), { target: { value: "a, A, b" } });
    fireEvent.change(field("Repeat"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByLabelText("Mon"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.id).toBeUndefined();
    expect(writes[0]!.draft).toMatchObject({
      title: "Ship it",
      taskListId: "work",
      dueDate: day(2),
      priority: 3,
      tags: ["a", "b"],
      recurrence: { frequency: "weekly", weekdays: [1] },
      recurrenceAnchor: day(2),
    });
  });

  it("keeps the anchor of an untouched recurring task when other fields change", async () => {
    mount({
      tasks: [
        aTask("water", {
          dueDate: day(3),
          recurrence: { frequency: "monthly" },
          recurrenceAnchor: "2026-01-31",
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /^water/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit this task" }));
    fireEvent.change(field("Notes"), { target: { value: "jug" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.recurrenceAnchor).toBe("2026-01-31");
  });

  it("adds a subtask under a task, in the same list", async () => {
    mount({
      taskLists: [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))],
      tasks: [aTask("deploy", { taskListId: "work" })],
    });
    pick("Work");
    fireEvent.click(screen.getByRole("button", { name: "Add subtask to deploy" }));
    fireEvent.change(field("Title"), { target: { value: "tag release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft).toMatchObject({ parentId: "deploy", taskListId: "work" });
  });

  it("moves a task's subtasks along when it changes list", async () => {
    mount({
      taskLists: [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))],
      tasks: [aTask("parent"), aTask("child", { parentId: "parent" })],
    });
    pick("Default Task List");
    fireEvent.click(screen.getByRole("button", { name: /^parent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit this task" }));
    fireEvent.change(field("List"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((write) => [write.id, write.draft.taskListId])).toEqual([
      ["parent", "work"],
      ["child", "work"],
    ]);
  });
});

describe("TasksView, deleting", () => {
  it("moves a deleted task's subtasks up a level", async () => {
    mount({
      tasks: [
        aTask("grand"),
        aTask("middle", { parentId: "grand" }),
        aTask("leaf", { parentId: "middle" }),
      ],
    });
    pick("Default Task List");
    expand("grand");
    fireEvent.click(screen.getByRole("button", { name: "Delete middle" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletes).toEqual(["middle"]));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ id: "leaf", draft: { parentId: "grand" } });
  });

  it("moves a deleted list's tasks and sublists up, rather than cascading", async () => {
    mount({
      taskLists: [
        DEFAULT_LIST,
        parseTaskList("work", serializeTaskList("Work")),
        parseTaskList("deep", serializeTaskList("Deep", "work")),
      ],
      tasks: [aTask("a", { taskListId: "work" })],
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Delete Work" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(listDeletes).toEqual(["work"]));
    expect(listWrites).toEqual([{ name: "Deep", parentId: undefined, id: "deep" }]);
    expect(writes[0]).toMatchObject({ id: "a", draft: { taskListId: DEFAULT_TASK_LIST_ID } });
  });

  it("offers no delete for the default list", () => {
    mount();
    expect(within(sidebar()).queryByRole("button", { name: "Delete Default Task List" })).toBeNull();
  });
});

describe("TasksView, lists", () => {
  it("creates a sublist under a list and opens it", async () => {
    mount();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Add sublist under Default Task List" }));
    const field = screen.getByLabelText("New sublist under Default Task List");
    fireEvent.change(field, { target: { value: "Errands" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() => expect(listWrites).toEqual([{ name: "Errands", parentId: DEFAULT_TASK_LIST_ID, id: undefined }]));
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "Errands" }).getAttribute("aria-current")).toBe("true"),
    );
  });

  it("recolours a top-level list, and its sublists follow", async () => {
    mount({
      taskLists: [
        DEFAULT_LIST,
        parseTaskList("work", serializeTaskList("Work")),
        parseTaskList("deep", serializeTaskList("Deep", "work")),
      ],
    });
    expect(within(sidebar()).queryByLabelText("Change colour for Deep")).toBeNull();
    fireEvent.change(within(sidebar()).getByLabelText("Change colour for Work"), {
      target: { value: "#123456" },
    });
    await waitFor(() =>
      expect(listWrites).toEqual([{ name: "Work", parentId: undefined, id: "work", color: "#123456" }]),
    );
    await waitFor(() =>
      expect((within(sidebar()).getByLabelText("Change colour for Work") as HTMLInputElement).value).toBe("#123456"),
    );
  });
});

describe("TasksView, read only", () => {
  it("offers no way to change anything", () => {
    mount({ tasks: [aTask("water")], readOnly: true });
    pick("Default Task List");
    expect(screen.queryByRole("button", { name: /New/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete water" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Complete water" }) as HTMLInputElement).disabled).toBe(true);
    expect(within(sidebar()).queryByRole("button", { name: "Add list" })).toBeNull();
    expect(within(sidebar()).queryByLabelText("Change colour for Default Task List")).toBeNull();
  });
});

class FakeDataTransfer {
  private store = new Map<string, string>();
  effectAllowed = "none";
  dropEffect = "none";
  setData(type: string, value: string) {
    this.store.set(type, value);
  }
  getData(type: string) {
    return this.store.get(type) ?? "";
  }
}

function dragEvent(type: string, transfer: FakeDataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

function rowOf(button: HTMLElement): HTMLElement {
  const row = button.closest('[draggable="true"]');
  if (!row) throw new Error("no draggable row");
  return row as HTMLElement;
}

/** Drops on a 40px row at `offset` from its top, so the edge zones can be hit. */
function dragAt(from: HTMLElement, to: HTMLElement, offset: number): void {
  to.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) });
  const transfer = new FakeDataTransfer();
  fireEvent(from, dragEvent("dragstart", transfer));
  for (const type of ["dragover", "drop"]) {
    const event = dragEvent(type, transfer);
    Object.defineProperty(event, "clientY", { value: offset });
    fireEvent(to, event);
  }
  fireEvent(from, dragEvent("dragend", transfer));
}

function drag(from: HTMLElement, to: HTMLElement | null): FakeDataTransfer {
  const transfer = new FakeDataTransfer();
  fireEvent(from, dragEvent("dragstart", transfer));
  if (to) {
    fireEvent(to, dragEvent("dragover", transfer));
    fireEvent(to, dragEvent("drop", transfer));
  }
  fireEvent(from, dragEvent("dragend", transfer));
  return transfer;
}

describe("TasksView, drag and drop", () => {
  const lists = () => [
    DEFAULT_LIST,
    parseTaskList("work", serializeTaskList("Work")),
    parseTaskList("deep", serializeTaskList("Deep", "work")),
    parseTaskList("play", serializeTaskList("Play")),
  ];
  const listButton = (name: string) => within(sidebar()).getByRole("button", { name: new RegExp(`^${name}\\d*$`) });

  it("nests a list under the one it is dropped on", async () => {
    mount({ taskLists: lists() });
    drag(rowOf(listButton("Play")), rowOf(listButton("Work")));
    await waitFor(() => expect(listWrites).toEqual([{ name: "Play", parentId: "work", id: "play" }]));
  });

  it("refuses a drop on its own descendant", () => {
    mount({ taskLists: lists() });
    drag(rowOf(listButton("Work")), rowOf(listButton("Deep")));
    expect(listWrites).toEqual([]);
  });

  it("brings a nested list back to the top level", async () => {
    mount({ taskLists: lists() });
    const transfer = new FakeDataTransfer();
    fireEvent(rowOf(listButton("Deep")), dragEvent("dragstart", transfer));
    const zone = await screen.findByText("Move to top level");
    fireEvent(zone, dragEvent("dragover", transfer));
    fireEvent(zone, dragEvent("drop", transfer));
    await waitFor(() => expect(listWrites).toEqual([{ name: "Deep", parentId: undefined, id: "deep" }]));
  });

  it("nests a task under another task", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta")] });
    pick("Default Task List");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("beta")), rowOf(handle("alpha")));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: "beta", draft: { parentId: "alpha" } });
  });

  it("drops a task beside a subtask, under the same parent", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" }), aTask("gamma")] });
    pick("Default Task List");
    expand("alpha");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    dragAt(rowOf(handle("gamma")), rowOf(handle("beta")), 38);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: "gamma", draft: { parentId: "alpha" } });
  });

  it("lifts a subtask out beside a top-level task", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" }), aTask("gamma")] });
    pick("Default Task List");
    expand("alpha");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    dragAt(rowOf(handle("beta")), rowOf(handle("gamma")), 2);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: "beta", draft: { parentId: undefined } });
  });

  it("drags in a smart view, and the subtree follows its new parent's list", async () => {
    mount({
      taskLists: [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))],
      tasks: [
        aTask("alpha", { taskListId: "work" }),
        aTask("beta"),
        aTask("child", { parentId: "beta" }),
      ],
    });
    pick("All tasks");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("beta")), rowOf(handle("alpha")));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toMatchObject({ id: "beta", draft: { parentId: "alpha", taskListId: "work" } });
    expect(writes[1]).toMatchObject({ id: "child", draft: { parentId: "beta", taskListId: "work" } });
  });

  it("refuses to drop a task under its own subtask", () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" })] });
    pick("Default Task List");
    expand("alpha");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("alpha")), rowOf(handle("beta")));
    expect(writes).toEqual([]);
  });
});

describe("TasksView, showing a write", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a tick without re-reading the vault", async () => {
    mount({ tasks: [aTask("water")] });
    tick("water");
    await waitFor(() => expect(applied).toBe(1));
    expect(refreshes).toBe(0);
    pick("Completed");
    expect(screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual([
      "Complete water",
    ]);
  });

  it("re-reads once the writing has stopped", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount({ tasks: [aTask("water"), aTask("feed cat")] });
    tick("water");
    await waitFor(() => expect(applied).toBe(1));
    await vi.advanceTimersByTimeAsync(9_000);
    tick("feed cat");
    await waitFor(() => expect(applied).toBe(2));
    // The window restarts on the second write, so the first one did not spend a walk.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(refreshes).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refreshes).toBe(1);
  });
});

describe("TasksView, the detail pane", () => {
  const row = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
  const pane = (title: string) => screen.getByRole("region", { name: `${title} details` });

  it("shows the selected task's details beside the list", () => {
    mount({
      tasks: [
        aTask("water", {
          dueDate: day(1),
          priority: 2,
          tags: ["home", "plants"],
          notes: "the big jug",
          recurrence: { frequency: "weekly", interval: 2 },
        }),
      ],
    });
    pick("Default Task List");
    expect(screen.getByText("Select a task to see its details.")).not.toBeNull();
    fireEvent.click(row("water"));
    const text = pane("water").textContent ?? "";
    expect(text).toContain("Default Task List");
    expect(text).toContain("Medium");
    expect(text).toContain("the big jug");
    expect(text).toContain("home");
    expect(text).toContain("Every 2 weeks");
  });

  it("lists a task's subtasks and opens one from the pane", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    fireEvent.click(row("parent"));
    const subtask = within(pane("parent")).getByRole("button", { name: "child" });
    fireEvent.click(subtask);
    expect(within(pane("child")).getByRole("button", { name: "parent" })).not.toBeNull();
  });

  it("completes the selected task from the pane", async () => {
    mount({ tasks: [aTask("water")] });
    pick("Default Task List");
    fireEvent.click(row("water"));
    fireEvent.click(within(pane("water")).getByRole("checkbox", { name: "Complete this task" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.done).toBe(true);
  });

  it("falls back to the parent when the selected task is deleted", async () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    expand("parent");
    fireEvent.click(row("child"));
    fireEvent.click(within(pane("child")).getByRole("button", { name: "Delete this task" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletes).toEqual(["child"]));
    expect(pane("parent")).not.toBeNull();
  });

  it("shows a task it has just saved", async () => {
    mount({ tasks: [] });
    pick("Default Task List");
    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.change(field("Title"), { target: { value: "tag release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(await screen.findByRole("region", { name: "tag release details" })).not.toBeNull();
  });

  it("closes the pane when a different list is picked", () => {
    mount({
      taskLists: [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))],
      tasks: [aTask("water")],
    });
    pick("Default Task List");
    fireEvent.click(row("water"));
    expect(pane("water")).not.toBeNull();
    pick("Work");
    expect(screen.queryByRole("region", { name: "water details" })).toBeNull();
  });
});

describe("TasksView, the list pills", () => {
  const lists = () => [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))];
  const seed = () => [aTask("laundry"), aTask("invoices", { taskListId: "work" })];

  function taskRow(title: string): HTMLElement {
    const row = screen.getByRole("checkbox", { name: `Complete ${title}` }).closest("[data-task-id]");
    if (!row) throw new Error("no row");
    return row as HTMLElement;
  }

  it("names each task's list in a smart view", () => {
    mount({ tasks: seed(), taskLists: lists() });
    pick("All tasks");
    expect(within(taskRow("laundry")).getByText("Default Task List")).not.toBeNull();
    expect(within(taskRow("invoices")).getByText("Work")).not.toBeNull();
  });

  it("leaves the pill off when the whole list is one list", () => {
    mount({ tasks: seed(), taskLists: lists() });
    pick("Work");
    expect(within(taskRow("invoices")).queryByText("Work")).toBeNull();
  });

  it("names the list on the detail pane", () => {
    mount({ tasks: seed(), taskLists: lists() });
    pick("Work");
    fireEvent.click(screen.getByRole("button", { name: "invoices" }));
    const pane = screen.getByRole("region", { name: "invoices details" });
    expect(within(pane).getByText("Work")).not.toBeNull();
  });
});

describe("TasksView, the subtask dropdown", () => {
  const titles = () =>
    screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));

  it("keeps subtasks behind the parent's arrow until it is opened", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" }), aTask("other")] });
    pick("Default Task List");
    expect(titles()).toEqual(["Complete other", "Complete parent"]);
    expand("parent");
    expect(titles()).toEqual(["Complete other", "Complete parent", "Complete child"]);
  });

  it("draws the open subtasks as a group inside the parent", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    expand("parent");
    const child = screen.getByRole("checkbox", { name: "Complete child" }).closest("[data-task-id]");
    const group = child?.closest(".task-subtree");
    expect(group).not.toBeNull();
    expect(group?.closest("li")?.querySelector('[data-task-id="parent"]')).not.toBeNull();
  });

  it("closes again on a second click", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    expand("parent");
    fireEvent.click(screen.getByRole("button", { name: "Collapse parent" }));
    expect(titles()).toEqual(["Complete parent"]);
  });

  it("nests subtasks under their parent in a smart view too", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("All tasks");
    expect(titles()).toEqual(["Complete parent"]);
    expand("parent");
    expect(titles()).toEqual(["Complete parent", "Complete child"]);
  });

  it("gives a matching subtask its own row when the parent is filtered out", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "child" } });
    expect(titles()).toEqual(["Complete child"]);
    expect(screen.queryByRole("button", { name: "Expand child" })).toBeNull();
  });

  it("gives a leaf task no arrow", () => {
    mount({ tasks: [aTask("alone")] });
    pick("Default Task List");
    expect(screen.queryByRole("button", { name: "Expand alone" })).toBeNull();
  });

  it("opens the parent when a subtask is added to it", async () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    fireEvent.click(screen.getByRole("button", { name: "Add subtask to parent" }));
    fireEvent.change(field("Title"), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Collapse parent" })).not.toBeNull();
  });

  it("opens the parent when a task is dropped on it", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta")] });
    pick("Default Task List");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("beta")), rowOf(handle("alpha")));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(titles()).toEqual(["Complete alpha", "Complete beta"]);
  });
});
