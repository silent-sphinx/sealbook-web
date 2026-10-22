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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import {
  DEFAULT_TASK_LIST_ID,
  parseTask,
  parseTaskList,
  serializeTask,
  serializeTaskList,
} from "../lib/task";
import { useSidebar } from "./SidebarDrawer";
import type { Session } from "../lib/client";
import type { Task, TaskDraft, TaskList } from "../lib/types";

let tasks: Task[] = [];
let taskLists: TaskList[] = [];
let writes: { id: string | undefined; draft: TaskDraft }[] = [];
let deletes: string[] = [];
let listWrites: { name: string; parentId?: string; id?: string }[] = [];
let listDeletes: string[] = [];
let ensured = 0;
let refreshes = 0;

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
      return made;
    },
    deleteTask: async (_session: unknown, id: string) => {
      deletes.push(id);
      tasks = tasks.filter((item) => item.id !== id);
    },
    putTaskList: async (_session: unknown, name: string, parentId?: string, id?: string) => {
      listWrites.push({ name, parentId, id });
      if (id) {
        taskLists = taskLists.map((item) => (item.id === id ? { ...item, name, parentId } : item));
        return id;
      }
      const made = `list-${name}`;
      taskLists = [...taskLists, parseTaskList(made, serializeTaskList(name, parentId))];
      return made;
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
});

describe("TasksView, the default list", () => {
  it("creates it on first entry, once", async () => {
    mount({ taskLists: [] });
    await waitFor(() => expect(ensured).toBe(1));
    expect(refreshes).toBe(1);
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
    fireEvent.change(screen.getByLabelText("New sublist under Default Task List"), {
      target: { value: "Errands" },
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(listWrites).toEqual([{ name: "Errands", parentId: DEFAULT_TASK_LIST_ID, id: undefined }]));
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "Errands" }).getAttribute("aria-current")).toBe("true"),
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

  it("refuses to drop a task under its own subtask", () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" })] });
    pick("Default Task List");
    const handle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("alpha")), rowOf(handle("beta")));
    expect(writes).toEqual([]);
  });
});
