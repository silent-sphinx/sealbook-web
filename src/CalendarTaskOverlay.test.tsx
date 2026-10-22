// @vitest-environment jsdom
/**
 * Tasks on the calendar, mounted end to end: the read-only overlay of open
 * tasks that have a due date, its switch, and the click-through to the Tasks
 * tab. `lib/client` is faked because an online session needs an OPAQUE exchange
 * only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain, snapshotWritten } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS, withFeature } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { DEFAULT_CALENDAR_ID } from "./lib/calendar";
import { DEFAULT_TASK_LIST_ID, parseTask, parseTaskList, serializeTask, serializeTaskList } from "./lib/task";
import type { AccountSettings, Task } from "./lib/types";

const PASSWORD = "correct horse battery";

const vault = vi.hoisted(() => ({
  tasks: [] as unknown[],
  settings: null as unknown,
}));

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    loginAccount: async (state: unknown) => ({
      state,
      collectionKey: "k",
      token: "t",
      latestRevision: 1,
      keyEpoch: 0,
      manifestSeq: 1,
    }),
    listVault: async () => ({
      sealed: [],
      addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
      contacts: [aContact("Ada Lovelace", "c1")],
      calendars: [{ id: DEFAULT_CALENDAR_ID, name: "Default Calendar", color: "#7aa2f7", raw: "{}" }],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      bookmarks: [],
      bookmarkCollections: [],
      tasks: vault.tasks,
      taskLists: [parseTaskList(DEFAULT_TASK_LIST_ID, serializeTaskList("Default Task List"))],
      accountSettings: vault.settings,
      unopened: 0,
    }),
    ensureDefaultCalendar: async (_session: unknown, existing: unknown) => existing,
    ensureDefaultTaskList: async (_session: unknown, existing: unknown) => existing,
  };
});

import App from "./App";

function dayKey(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function aTask(id: string, overrides: Record<string, unknown> = {}): Task {
  return parseTask(id, serializeTask({ title: id, taskListId: DEFAULT_TASK_LIST_ID, ...overrides }));
}

async function unlockToCalendar() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Ada Lovelace");
  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  await screen.findByRole("button", { name: "Create event" });
  await snapshotWritten();
}

function overlaySwitch(): HTMLInputElement | null {
  return screen.queryByLabelText("Show tasks with a due date") as HTMLInputElement | null;
}

beforeEach(() => {
  vault.settings = DEFAULT_ACCOUNT_SETTINGS;
  vault.tasks = [
    aTask("water", { dueDate: dayKey() }),
    aTask("finished", { dueDate: dayKey(), done: true }),
    aTask("undated"),
  ];
});

describe("the calendar's task overlay", () => {
  it("marks an open task on the day it is due, and nothing else", async () => {
    await unlockToCalendar();
    expect(screen.getByRole("button", { name: "Open task water" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open task finished" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open task undated" })).toBeNull();
  });

  it("hides the marks with the switch and remembers the choice", async () => {
    await unlockToCalendar();
    fireEvent.click(overlaySwitch()!);
    expect(screen.queryByRole("button", { name: "Open task water" })).toBeNull();
    const stored = Object.keys(localStorage).filter((key) => key.startsWith("sealbook.tasks-overlay."));
    expect(stored).toHaveLength(1);
    expect(localStorage.getItem(stored[0]!)).toBe("0");

    fireEvent.click(overlaySwitch()!);
    expect(screen.getByRole("button", { name: "Open task water" })).not.toBeNull();
    expect(localStorage.getItem(stored[0]!)).toBe("1");
  });

  it("opens the task in the Tasks tab when a mark is clicked", async () => {
    await unlockToCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Open task water" }));

    const box = await screen.findByRole("checkbox", { name: "Complete water" });
    expect(box.closest("[data-task-id]")?.getAttribute("data-task-id")).toBe("water");
    expect(box.closest("[data-task-id]")?.className).toContain("ring-accent-ring");
    const aside = document.querySelector("aside") as HTMLElement;
    expect(
      within(aside).getByRole("button", { name: /^Default Task List\d*$/ }).getAttribute("aria-current"),
    ).toBe("true");
  });

  it("opens the task again after leaving and returning", async () => {
    await unlockToCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Open task water" }));
    await screen.findByRole("checkbox", { name: "Complete water" });
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open task water" }));
    expect((await screen.findByRole("checkbox", { name: "Complete water" })).closest("[data-task-id]")).not.toBeNull();
  });

  it("is absent altogether when the tasks feature is off", async () => {
    vault.settings = withFeature(DEFAULT_ACCOUNT_SETTINGS, "tasks", false) satisfies AccountSettings;
    await unlockToCalendar();
    expect(overlaySwitch()).toBeNull();
    expect(screen.queryByRole("button", { name: "Open task water" })).toBeNull();
  });
});
