// @vitest-environment jsdom
/**
 * The overview, mounted end to end: that a new session lands on it, that it
 * lists what is coming up across the features that are on, and that a row opens
 * the item in its own tab. `lib/client` is faked as in the other shell suites.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS, withFeature } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { DEFAULT_CALENDAR_ID } from "./lib/calendar";
import { DEFAULT_TASK_LIST_ID, parseTask, parseTaskList, serializeTask, serializeTaskList } from "./lib/task";
import type { AccountSettings, CalendarEvent, Contact, Task } from "./lib/types";

const PASSWORD = "correct horse battery";

const vault = vi.hoisted(() => ({
  tasks: [] as unknown[],
  events: [] as unknown[],
  contacts: [] as unknown[],
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
      addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
      contacts: vault.contacts,
      calendars: [{ id: DEFAULT_CALENDAR_ID, name: "Default Calendar", color: "#7aa2f7", raw: "{}" }],
      calendarEvents: vault.events,
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

function withBirthday(contact: Contact, date: string): Contact {
  return { ...contact, dates: [{ id: "bday", kind: "birthday", date }] };
}

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ });
}

function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  // The shared setup starts the shell on contacts; this suite is about where it starts.
  sessionStorage.clear();
  vault.settings = DEFAULT_ACCOUNT_SETTINGS;
  vault.tasks = [aTask("Water the plants", { dueDate: dayKey() }), aTask("File taxes", { dueDate: dayKey(-2) })];
  vault.events = [
    { id: "lunch", title: "Lunch with Ada", start: dayKey(1), calendarId: DEFAULT_CALENDAR_ID } satisfies CalendarEvent,
  ];
  vault.contacts = [withBirthday(aContact("Ada Lovelace", "c1"), `1815-${dayKey(3).slice(5)}`)];
});

describe("the overview", () => {
  it("is where a new session lands, first in the navigation", async () => {
    await unlock();
    const nav = screen.getByRole("navigation", { name: "Main Navigation" });
    const [logo, overview] = within(nav).getAllByRole("button");
    expect(logo.getAttribute("aria-label")).toBe("Sealbook home");
    expect(overview.getAttribute("aria-label")).toBe("Overview");
    expect(overview.getAttribute("aria-current")).toBe("page");
  });

  it("lists what is coming up in each feature", async () => {
    await unlock();
    expect(within(card("Coming up")).getByText("Lunch with Ada")).not.toBeNull();
    expect(within(card("Coming up")).getByText("Nothing scheduled.")).not.toBeNull();

    const tasks = card("Due soon");
    expect(within(tasks).getByText("Overdue")).not.toBeNull();
    expect(within(tasks).getByText("File taxes")).not.toBeNull();
    expect(within(tasks).getByText("Water the plants")).not.toBeNull();

    expect(within(card("Birthdays and dates")).getByText("Ada Lovelace")).not.toBeNull();
    expect(within(card("Birthdays and dates")).getByText(/turns \d+/)).not.toBeNull();
  });

  it("leaves out a feature that is switched off", async () => {
    vault.settings = withFeature(DEFAULT_ACCOUNT_SETTINGS, "tasks", false) satisfies AccountSettings;
    await unlock();
    expect(screen.queryByRole("region", { name: "Due soon" })).toBeNull();
    expect(card("Coming up")).not.toBeNull();
  });

  it("opens a task in the Tasks tab", async () => {
    await unlock();
    fireEvent.click(within(card("Due soon")).getByRole("button", { name: /Water the plants/ }));
    const box = await screen.findByRole("checkbox", { name: "Complete Water the plants" });
    expect(box.closest("[data-task-id]")?.className).toContain("border-l-accent");
  });

  it("opens a contact in the Contacts tab", async () => {
    await unlock();
    fireEvent.click(within(card("Birthdays and dates")).getByRole("button", { name: /Ada Lovelace/ }));
    const nav = screen.getByRole("navigation", { name: "Main Navigation" });
    expect(within(nav).getByRole("button", { name: "Contacts" }).getAttribute("aria-current")).toBe("page");
  });

  it("goes to a feature's tab from its card", async () => {
    await unlock();
    fireEvent.click(within(card("Coming up")).getByRole("button", { name: "Calendar" }));
    expect(await screen.findByRole("button", { name: "New event" })).not.toBeNull();
  });
});
