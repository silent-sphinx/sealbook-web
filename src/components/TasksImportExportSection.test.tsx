// @vitest-environment jsdom
/**
 * The tasks import and export section, mounted on its own.
 *
 * `lib/client` is faked rather than driven through a session: every write would
 * otherwise need an OPAQUE exchange only the server can answer. What matters
 * here is what reaches the vault, above all that a subtask is written under its
 * parent's new id rather than the id the file gave it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/dom";
import { DEFAULT_TASK_LIST_ID, parseTask, parseTaskList, serializeTask, serializeTaskList } from "../lib/task";
import type { Session } from "../lib/client";
import type { Task, TaskDraft } from "../lib/types";

let writes: { id: string | undefined; draft: TaskDraft }[] = [];
let listWrites: string[] = [];
let issued = 0;
let downloads: { filename: string; mime: string; data: string }[] = [];

vi.mock("../lib/taskApi", () => ({
  newTaskId: () => `new-${(issued += 1)}`,
  putTask: async (_session: unknown, draft: TaskDraft, id?: string) => {
    writes.push({ id, draft });
    const made = id ?? "unissued";
    return parseTask(made, serializeTask(draft));
  },
  putTaskList: async (_session: unknown, name: string) => {
    listWrites.push(name);
    return parseTaskList(`list-${name}`, serializeTaskList(name));
  },
}));

vi.mock("../lib/importExport", async () => {
  const actual = await vi.importActual<typeof import("../lib/importExport")>("../lib/importExport");
  return {
    ...actual,
    triggerDownload: (filename: string, mime: string, data: string) => {
      downloads.push({ filename, mime, data });
    },
  };
});

const { TasksImportExportSection } = await import("./TasksImportExportSection");

const SESSION = { state: { username: "ada" } } as unknown as Session;
const LISTS = [
  parseTaskList(DEFAULT_TASK_LIST_ID, serializeTaskList("Default Task List")),
  parseTaskList("work", serializeTaskList("Work")),
];

function aTask(id: string, overrides: Partial<TaskDraft> = {}): Task {
  return parseTask(id, serializeTask({ title: id, taskListId: DEFAULT_TASK_LIST_ID, ...overrides }));
}

function mount(tasks: Task[] = []) {
  const onRefresh = vi.fn<() => Promise<void>>(async () => undefined);
  render(<TasksImportExportSection session={SESSION} tasks={tasks} taskLists={LISTS} onRefresh={onRefresh} />);
  return { onRefresh };
}

function choose(content: string, name = "tasks.json"): void {
  const file = new File([content], name, { type: "application/json" });
  fireEvent.change(screen.getByLabelText("Tasks file"), { target: { files: [file] } });
}

beforeEach(() => {
  writes = [];
  listWrites = [];
  downloads = [];
  issued = 0;
});

describe("importing tasks", () => {
  const file = JSON.stringify({
    "@type": "sealbook-task-export",
    version: 1,
    tasks: [
      { id: "kid", parentId: "boss", title: "Tag release" },
      { id: "boss", title: "Ship it", dueDate: "2026-10-30", priority: 3, recurrence: { frequency: "weekly" } },
      { title: "" },
    ],
  });

  it("previews what it found and counts what it skipped", async () => {
    mount();
    choose(file);
    expect(await screen.findByText(/2 tasks found · 1 skipped/)).not.toBeNull();
    expect(screen.getByText("Ship it")).not.toBeNull();
  });

  it("writes parents first and points each subtask at its parent's new id", async () => {
    const { onRefresh } = mount();
    choose(file);
    fireEvent.change(await screen.findByLabelText("Target list"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 tasks" }));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((write) => write.id)).toEqual(["new-1", "new-2"]);
    expect(writes[0]!.draft).toMatchObject({
      title: "Ship it",
      taskListId: "work",
      dueDate: "2026-10-30",
      priority: 3,
      recurrence: { frequency: "weekly" },
    });
    expect(writes[0]!.draft.parentId).toBeUndefined();
    expect(writes[1]!.draft).toMatchObject({ title: "Tag release", taskListId: "work", parentId: "new-1" });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect((await screen.findByRole("status")).textContent).toContain('Imported 2 tasks into "Work"');
  });

  it("can create the list it imports into", async () => {
    mount();
    choose(file);
    fireEvent.click(await screen.findByRole("button", { name: "+ Create new list" }));
    const importButton = screen.getByRole("button", { name: "Import 2 tasks" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Target list"), { target: { value: "Imported" } });
    fireEvent.click(importButton);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(listWrites).toEqual(["Imported"]);
    expect(writes[0]!.draft.taskListId).toBe("list-Imported");
  });

  it("reports a file it cannot read", async () => {
    mount();
    choose('{"title":"not an export"}');
    expect((await screen.findByRole("alert")).textContent).toContain("Unrecognised format");
    expect(writes).toEqual([]);
  });

  it("reports a file that is not JSON", async () => {
    mount();
    choose("not json at all");
    expect((await screen.findByRole("alert")).textContent).toBe("That file is not valid JSON.");
  });

  it("reports a file with nothing usable in it", async () => {
    mount();
    choose('[{"notes":"no title"}]');
    expect((await screen.findByRole("alert")).textContent).toContain("missing a title");
  });
});

describe("exporting tasks", () => {
  it("downloads every task with its fields", () => {
    mount([aTask("water", { dueDate: "2026-10-30", taskListId: "work" }), aTask("old", { done: true })]);
    fireEvent.click(screen.getByRole("button", { name: "Export 2 tasks" }));
    expect(downloads).toHaveLength(1);
    const body = JSON.parse(downloads[0]!.data);
    expect(downloads[0]!.mime).toBe("application/json");
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.find((task: { id: string }) => task.id === "water")).toMatchObject({
      listName: "Work",
      dueDate: "2026-10-30",
    });
  });

  it("exports only the list that is chosen", () => {
    mount([aTask("water", { taskListId: "work" }), aTask("old")]);
    fireEvent.change(screen.getByLabelText("Source list"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Export 1 task" }));
    expect(JSON.parse(downloads[0]!.data).tasks.map((task: { id: string }) => task.id)).toEqual(["water"]);
  });

  it("will not export an empty list", () => {
    mount([aTask("old")]);
    fireEvent.change(screen.getByLabelText("Source list"), { target: { value: "work" } });
    expect((screen.getByRole("button", { name: "Export 0 tasks" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
