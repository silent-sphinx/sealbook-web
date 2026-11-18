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
/** Each id `trashItems` moved to the trash, in order. */
let trashed: string[] = [];
let hideWrites: (boolean | undefined)[] = [];
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
      _archived?: boolean,
      hideFromAll?: boolean,
    ) => {
      listWrites.push({ name, parentId, id, color });
      hideWrites.push(hideFromAll);
      const made = id ?? `list-${name}`;
      const saved = parseTaskList(made, serializeTaskList(name, parentId, undefined, color, undefined, hideFromAll));
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

/** Ids under `id` by `parentId`, itself included, as the trash hides them. */
function under<T extends { id: string; parentId?: string }>(items: T[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

vi.mock("../lib/trashApi", () => ({
  trashItems: async (_session: unknown, entries: { kind: string; item: { id: string } }[]) => {
    for (const { kind, item } of entries) {
      trashed.push(item.id);
      if (kind === "task_list") {
        const gone = under(taskLists, item.id);
        taskLists = taskLists.filter((list) => !gone.has(list.id));
        tasks = tasks.filter((task) => !gone.has(task.taskListId ?? ""));
      } else {
        const gone = under(tasks, item.id);
        tasks = tasks.filter((task) => !gone.has(task.id));
      }
    }
  },
}));

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

/** The task list beside the sidebar, which repeats the open list's tasks. */
function board(): HTMLElement {
  const section = [...document.querySelectorAll("section")].find((node) => !node.closest("aside"));
  if (!section) throw new Error("no task board");
  return section as HTMLElement;
}

function pick(name: string): void {
  fireEvent.click(within(sidebar()).getByRole("button", { name: new RegExp(`^${name}\\d*$`) }));
}

function tick(title: string): void {
  fireEvent.click(screen.getByRole("checkbox", { name: `Complete ${title}` }));
}

/** Opens a parent's dropdown; subtasks are hidden until it is clicked. */
function expand(title: string): void {
  fireEvent.click(within(board()).getByRole("button", { name: `Expand ${title}` }));
}

function field(label: string): HTMLElement {
  return screen.getByLabelText(label);
}

function addTags(...tags: string[]): void {
  const input = field("Tags");
  for (const tag of tags) {
    fireEvent.change(input, { target: { value: tag } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
}

beforeEach(() => {
  tasks = [];
  taskLists = [DEFAULT_LIST];
  writes = [];
  deletes = [];
  listWrites = [];
  listDeletes = [];
  trashed = [];
  hideWrites = [];
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

  it("opens on Up next, grouped by when each task is due", () => {
    mount({ tasks: seed() });
    const groups = within(board())
      .getAllByRole("region")
      .map((region) => [
        region.getAttribute("aria-label"),
        within(region).queryAllByRole("checkbox").map((box) => box.getAttribute("aria-label")),
      ]);
    expect(groups).toEqual([
      ["Overdue", ["Complete late"]],
      ["Today", ["Complete today"]],
      ["This week", ["Complete soon"]],
      ["No date", ["Complete undated"]],
    ]);
  });

  it("keeps Today on screen when nothing is due, and adds a task due then", () => {
    mount({ tasks: [aTask("undated")] });
    expect(within(board()).getByText("Nothing due today.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a task due today" }));
    expect((field("Due date") as HTMLInputElement).value).toBe(day(0));
  });

  it("shows ten undated tasks until asked for the rest", () => {
    mount({ tasks: Array.from({ length: 12 }, (_, index) => aTask(`t${String(index).padStart(2, "0")}`)) });
    expect(screen.getAllByRole("checkbox")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(12);
  });

  it("names a subtask's parent and folds what was done today", () => {
    const now = new Date().toISOString();
    mount({
      tasks: [
        aTask("trip", { dueDate: day(9) }),
        aTask("pack", { parentId: "trip", dueDate: day(0) }),
        aTask("posted", { done: true, completedAt: now }),
      ],
    });
    const today = within(board()).getByRole("region", { name: "Today" });
    expect(today.textContent).toContain("in trip");
    const done = within(board()).getByRole("region", { name: "Done today" });
    expect(within(done).queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(within(done).getByRole("button", { expanded: false }));
    expect(within(done).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("says all clear with nothing open", () => {
    mount({ tasks: [aTask("posted", { done: true, completedAt: new Date().toISOString() })] });
    expect(within(board()).getByText("All clear")).not.toBeNull();
    expect(within(board()).getByText(/1 task done today/)).not.toBeNull();
  });

  it("filters Completed", () => {
    mount({ tasks: seed() });
    pick("Completed");
    expect(screen.queryAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual([
      "Complete finished",
    ]);
  });

  it("filters by search across the current view", () => {
    mount({ tasks: [aTask("water plants", { tags: ["home"] }), aTask("pay rent")] });
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "home" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "zebra" } });
    expect(screen.getByText("No tasks match that search.")).not.toBeNull();
  });
});

describe("TasksView, tags", () => {
  const tagged = () => [
    aTask("water", { tags: ["Home"] }),
    aTask("rent", { tags: ["home", "money"] }),
    aTask("plain"),
    aTask("old", { tags: ["home"], done: true, completedAt: new Date().toISOString() }),
  ];
  const rows = () => within(board()).queryAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));

  it("lists each tag once, counted across the view, and filters on click", () => {
    mount({ tasks: tagged() });
    pick("All tasks");
    const home = screen.getByRole("button", { name: /^Home/, pressed: false });
    expect(home.textContent).toContain("3");
    fireEvent.click(screen.getByRole("button", { name: /^money/ }));
    expect(rows()).toEqual(["Complete rent"]);
    fireEvent.click(screen.getByRole("button", { name: /^money/ }));
    expect(rows()).toHaveLength(4);
  });

  it("filters the Up next agenda too", () => {
    mount({ tasks: [aTask("water", { tags: ["home"], dueDate: day(0) }), aTask("rent", { tags: ["money"], dueDate: day(0) })] });
    fireEvent.click(screen.getByRole("button", { name: /^money/ }));
    expect(rows()).toEqual(["Complete rent"]);
  });

  it("says so when no task has the tag in the view, and drops a tag that is gone", () => {
    mount({ tasks: tagged() });
    pick("All tasks");
    fireEvent.click(screen.getByRole("button", { name: /^money/ }));
    pick("Completed");
    expect(screen.queryByRole("button", { name: /^money/ })).toBeNull();
    expect(rows()).toEqual(["Complete old"]);
  });

  it("hides the tag bar while searching", () => {
    mount({ tasks: tagged() });
    pick("All tasks");
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "wat" } });
    expect(screen.queryByRole("button", { name: /^money/ })).toBeNull();
  });

  it("offers earlier tags in the form and keeps their first spelling", async () => {
    mount({ tasks: tagged() });
    fireEvent.click(within(board()).getByRole("button", { name: /New/ }));
    fireEvent.change(field("Title"), { target: { value: "Pay" } });
    addTags("HOME", "new");
    expect(screen.getByRole("button", { name: "Remove tag: Home" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.tags).toEqual(["Home", "new"]);
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
    pick("Completed");
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
    fireEvent.click(within(board()).getByRole("button", { name: /New/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Give the task a title.");
    expect(writes).toEqual([]);
  });

  it("refuses a repeat with no due date", () => {
    mount();
    fireEvent.click(within(board()).getByRole("button", { name: /New/ }));
    fireEvent.change(field("Title"), { target: { value: "Water" } });
    fireEvent.change(field("Repeat"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Set a due date to repeat a task.");
    expect(writes).toEqual([]);
  });

  it("writes what was entered, into the list that is open", async () => {
    mount({ taskLists: [DEFAULT_LIST, parseTaskList("work", serializeTaskList("Work"))] });
    pick("Work");
    fireEvent.click(within(board()).getByRole("button", { name: /New/ }));
    fireEvent.change(field("Title"), { target: { value: "  Ship it  " } });
    fireEvent.change(field("Due date"), { target: { value: day(2) } });
    fireEvent.change(field("Priority"), { target: { value: "3" } });
    addTags("a", "A", "b");
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
    fireEvent.click(within(board()).getByRole("button", { name: /^water/ }));
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
    fireEvent.click(within(board()).getByRole("button", { name: "Add subtask to deploy" }));
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
    fireEvent.click(within(board()).getByRole("button", { name: /^parent/ }));
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
  it("moves a task to the trash with its subtasks", async () => {
    mount({
      tasks: [
        aTask("grand"),
        aTask("middle", { parentId: "grand" }),
        aTask("leaf", { parentId: "middle" }),
      ],
    });
    pick("Default Task List");
    expand("grand");
    fireEvent.click(within(board()).getByRole("button", { name: "Delete middle" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(trashed).toEqual(["middle"]));
    expect(writes).toEqual([]);
    expect(deletes).toEqual([]);
    expect(tasks.map((task) => task.id)).toEqual(["grand"]);
  });

  it("moves a list to the trash with its tasks and sublists", async () => {
    mount({
      taskLists: [
        DEFAULT_LIST,
        parseTaskList("work", serializeTaskList("Work")),
        parseTaskList("deep", serializeTaskList("Deep", "work")),
      ],
      tasks: [aTask("a", { taskListId: "work" })],
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Delete Work" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(trashed).toEqual(["work"]));
    expect(listWrites).toEqual([]);
    expect(writes).toEqual([]);
    expect(listDeletes).toEqual([]);
    expect(taskLists.map((list) => list.id)).toEqual([DEFAULT_TASK_LIST_ID]);
    expect(tasks).toEqual([]);
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
    pick("Work");
    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: /^Deep/ }));
    expect(screen.queryByRole("menuitem", { name: "Change colour" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: /^Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "List colour" })).getByRole("button", { name: "Deep teal" }));
    await waitFor(() =>
      expect(listWrites).toEqual([{ name: "Work", parentId: undefined, id: "work", color: "#4fae9f" }]),
    );
    const tint = (name: RegExp) =>
      (within(sidebar()).getByRole("button", { name }).querySelector("span") as HTMLElement).style.color;
    await waitFor(() => expect(tint(/^Work/)).toBe("rgb(79, 174, 159)"));
    expect(tint(/^Deep/)).toBe("rgb(79, 174, 159)");
  });
});

describe("TasksView, read only", () => {
  it("offers no way to change anything", () => {
    mount({ tasks: [aTask("water")], readOnly: true });
    pick("Default Task List");
    expect(screen.queryByRole("button", { name: /New/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete water" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add subtask to water" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Complete water" }) as HTMLInputElement).disabled).toBe(true);
    expect(within(sidebar()).queryByRole("button", { name: "Add list" })).toBeNull();
    expect(screen.queryByLabelText("List colour")).toBeNull();
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
    pick("Work");
    drag(rowOf(listButton("Work")), rowOf(listButton("Deep")));
    expect(listWrites).toEqual([]);
  });

  it("brings a nested list back to the top level", async () => {
    mount({ taskLists: lists() });
    pick("Work");
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
    const handle = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("beta")), rowOf(handle("alpha")));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: "beta", draft: { parentId: "alpha" } });
  });

  it("drops a task beside a subtask, under the same parent", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" }), aTask("gamma")] });
    pick("Default Task List");
    expand("alpha");
    const handle = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
    dragAt(rowOf(handle("gamma")), rowOf(handle("beta")), 38);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: "gamma", draft: { parentId: "alpha" } });
  });

  it("lifts a subtask out beside a top-level task", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" }), aTask("gamma")] });
    pick("Default Task List");
    expand("alpha");
    const handle = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
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
    const handle = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("beta")), rowOf(handle("alpha")));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toMatchObject({ id: "beta", draft: { parentId: "alpha", taskListId: "work" } });
    expect(writes[1]).toMatchObject({ id: "child", draft: { parentId: "beta", taskListId: "work" } });
  });

  it("refuses to drop a task under its own subtask", () => {
    mount({ tasks: [aTask("alpha"), aTask("beta", { parentId: "alpha" })] });
    pick("Default Task List");
    expand("alpha");
    const handle = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
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
  const row = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
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

  it("falls back to the parent when the selected task is moved to the trash", async () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    expand("parent");
    fireEvent.click(row("child"));
    fireEvent.click(within(pane("child")).getByRole("button", { name: "Delete this task" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(trashed).toEqual(["child"]));
    expect(pane("parent")).not.toBeNull();
  });

  it("shows a task it has just saved", async () => {
    mount({ tasks: [] });
    pick("Default Task List");
    fireEvent.click(within(board()).getByRole("button", { name: /New/ }));
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
    fireEvent.click(within(board()).getByRole("button", { name: "invoices" }));
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
    fireEvent.click(within(board()).getByRole("button", { name: "Collapse parent" }));
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
    expect(within(board()).queryByRole("button", { name: "Expand child" })).toBeNull();
  });

  it("gives a leaf task no arrow", () => {
    mount({ tasks: [aTask("alone")] });
    pick("Default Task List");
    expect(within(board()).queryByRole("button", { name: "Expand alone" })).toBeNull();
  });

  it("opens the parent when a subtask is added to it", async () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    fireEvent.click(within(board()).getByRole("button", { name: "Add subtask to parent" }));
    fireEvent.change(field("Title"), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(within(board()).getByRole("button", { name: "Collapse parent" })).not.toBeNull();
  });

  it("opens the parent when a task is dropped on it", async () => {
    mount({ tasks: [aTask("alpha"), aTask("beta")] });
    pick("Default Task List");
    const handle = (title: string) => within(board()).getByRole("button", { name: new RegExp(`^${title}`) });
    drag(rowOf(handle("beta")), rowOf(handle("alpha")));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(titles()).toEqual(["Complete alpha", "Complete beta"]);
  });
});

describe("TasksView, the sidebar", () => {
  it("lists only the lists, never their tasks", () => {
    mount({ tasks: [aTask("parent"), aTask("child", { parentId: "parent" })] });
    pick("Default Task List");
    const side = within(sidebar());
    expect(side.queryByRole("button", { name: "parent" })).toBeNull();
    expect(side.queryByRole("button", { name: "Expand parent" })).toBeNull();
    expect(side.queryByRole("button", { name: "New task" })).toBeNull();
  });
});

describe("TasksView, bulk editing", () => {
  // The first pick uses the row's hover button; once selecting, each row has a checkbox.
  const pickRow = (title: string) =>
    fireEvent.click(
      within(board()).queryByRole("checkbox", { name: `Select ${title}` }) ??
        within(board()).getByRole("button", { name: `Select ${title}` }),
    );
  const bar = () => screen.getByRole("toolbar", { name: "Bulk edit tasks" });

  it("selects tasks and completes them together", async () => {
    mount({ tasks: [aTask("a"), aTask("b"), aTask("c")] });
    pick("Default Task List");
    expect(screen.queryByRole("toolbar", { name: "Bulk edit tasks" })).toBeNull();
    pickRow("a");
    pickRow("b");
    expect(within(bar()).getByText("2 selected")).not.toBeNull();
    fireEvent.click(within(bar()).getByRole("button", { name: /Actions/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Complete 2 tasks" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((write) => write.id).sort()).toEqual(["a", "b"]);
    expect(writes.every((write) => write.draft.done === true)).toBe(true);
    expect(screen.queryByRole("toolbar", { name: "Bulk edit tasks" })).toBeNull();
  });

  it("extends a selection with shift and from the keyboard", () => {
    mount({ tasks: [aTask("a"), aTask("b"), aTask("c")] });
    pick("Default Task List");
    pickRow("a");
    fireEvent.click(within(board()).getByRole("checkbox", { name: "Select c" }), { shiftKey: true });
    expect(within(bar()).getByText("3 selected")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Bulk edit tasks" })).toBeNull();
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(within(bar()).getByText("3 selected")).not.toBeNull();
  });

  it("starts a selection on ctrl-click", () => {
    mount({ tasks: [aTask("a"), aTask("b")] });
    pick("Default Task List");
    fireEvent.click(within(board()).getByRole("button", { name: /^a/ }), { ctrlKey: true });
    expect(within(bar()).getByText("1 selected")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "a details" })).toBeNull();
  });

  it("moves the selection to another list", async () => {
    const work = parseTaskList("work", serializeTaskList("Work"));
    mount({ tasks: [aTask("a"), aTask("b")], taskLists: [DEFAULT_LIST, work] });
    pick("Default Task List");
    pickRow("a");
    pickRow("b");
    fireEvent.change(within(bar()).getByLabelText("Move selected tasks to"), { target: { value: "work" } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.every((write) => write.draft.taskListId === "work")).toBe(true);
  });

  it("sets one due date on the selection", async () => {
    mount({ tasks: [aTask("a"), aTask("b")] });
    pick("Default Task List");
    pickRow("a");
    pickRow("b");
    fireEvent.change(within(bar()).getByLabelText("Set due date for selected tasks"), {
      target: { value: "2030-05-01" },
    });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.every((write) => write.draft.dueDate === "2030-05-01")).toBe(true);
  });

  it("asks before moving to the trash, and takes subtasks along", async () => {
    mount({ tasks: [aTask("p"), aTask("c", { parentId: "p" }), aTask("other")] });
    pick("Default Task List");
    pickRow("p");
    pickRow("other");
    fireEvent.click(within(bar()).getByRole("button", { name: /Actions/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete 2 tasks" }));
    expect(trashed).toEqual([]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect([...trashed].sort()).toEqual(["other", "p"]));
    expect(writes).toEqual([]);
    expect(tasks).toEqual([]);
  });

  it("offers no selection when read only", () => {
    mount({ tasks: [aTask("a")], readOnly: true });
    pick("Default Task List");
    expect(screen.queryByRole("button", { name: "Select a" })).toBeNull();
  });
});

describe("TasksView, hiding a list", () => {
  const hiddenSeed = () => ({
    taskLists: [
      DEFAULT_LIST,
      parseTaskList("secret", serializeTaskList("Secret", undefined, undefined, undefined, undefined, true)),
      parseTaskList("inner", serializeTaskList("Inner", "secret")),
    ],
    tasks: [
      aTask("visible"),
      aTask("hidden", { taskListId: "secret" }),
      aTask("nested", { taskListId: "inner" }),
    ],
  });

  it("leaves a hidden list's tasks, and its sublists', out of the smart views", () => {
    mount(hiddenSeed());
    pick("All tasks");
    expect(screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual([
      "Complete visible",
    ]);
  });

  it("still lists the hidden list, opens it with its tasks, and finds them by search", () => {
    mount(hiddenSeed());
    pick("Secret");
    expect(screen.getByRole("checkbox", { name: "Complete hidden" })).not.toBeNull();
    pick("All tasks");
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "hidden" } });
    expect(screen.getByRole("checkbox", { name: "Complete hidden" })).not.toBeNull();
  });

  it("writes the flag from the list's menu, and clears it from a hidden one", async () => {
    mount(hiddenSeed());
    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: /^Default Task List/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide from overview" }));
    await waitFor(() => expect(hideWrites).toEqual([true]));

    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: /^Secret/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in overview" }));
    await waitFor(() => expect(hideWrites).toEqual([true, false]));
  });
});
