// @vitest-environment jsdom
/**
 * The search palette, mounted end to end: the shortcut and the header button
 * open it, results come back grouped by kind, and picking one opens it in its
 * own tab.
 *
 * `lib/client` is faked as in `ContactSearch.test.tsx`: reaching an online
 * session needs an OPAQUE exchange only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { DEFAULT_BOOKMARK_COLLECTION_ID, parseBookmark } from "./lib/bookmark";
import { DEFAULT_CALENDAR_ID, parseEvent } from "./lib/calendar";
import { DEFAULT_NOTEBOOK_ID, parseNote } from "./lib/note";
import { DEFAULT_TASK_LIST_ID, parseTask } from "./lib/task";

const PASSWORD = "correct horse battery";

const raw = (payload: object) => JSON.stringify(payload);

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
      contacts: [aContact("Ada Lovelace", "c1"), aContact("Basil Hallward", "c2")],
      calendars: [{ id: DEFAULT_CALENDAR_ID, name: "Calendar", color: "#3b82f6", raw: "{}" }],
      calendarEvents: [
        parseEvent("e1", raw({ title: "Basil tasting", start: "2099-06-01T12:00:00Z", calendarId: DEFAULT_CALENDAR_ID })),
      ],
      notes: [
        parseNote("n1", raw({ title: "Basil pesto", body: "Blend it.", notebookId: DEFAULT_NOTEBOOK_ID })),
        parseNote("n2", raw({ title: "Shopping", body: "Tomatoes and basil.", notebookId: DEFAULT_NOTEBOOK_ID })),
      ],
      notebooks: [{ id: DEFAULT_NOTEBOOK_ID, name: "Notes", raw: "{}" }],
      bookmarks: [
        parseBookmark("b1", raw({ url: "https://example.com", title: "Basil recipes", collectionId: DEFAULT_BOOKMARK_COLLECTION_ID })),
      ],
      bookmarkCollections: [{ id: DEFAULT_BOOKMARK_COLLECTION_ID, name: "Bookmarks", raw: "{}" }],
      tasks: [
        parseTask("t1", raw({ title: "Buy basil", taskListId: DEFAULT_TASK_LIST_ID })),
        parseTask("t2", raw({ title: "Basil seeds", done: true, taskListId: DEFAULT_TASK_LIST_ID })),
      ],
      taskLists: [{ id: DEFAULT_TASK_LIST_ID, name: "Tasks", raw: "{}" }],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
    ensureDefaultCalendar: async (_session: unknown, calendars: unknown) => calendars,
    ensureDefaultNotebook: async (_session: unknown, notebooks: unknown) => notebooks,
    ensureDefaultBookmarkCollection: async (_session: unknown, collections: unknown) => collections,
    ensureDefaultTaskList: async (_session: unknown, lists: unknown) => lists,
  };
});

import App from "./App";

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Search" });
}

function shortcut() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

async function type(query: string) {
  fireEvent.change(await screen.findByLabelText("Search everything"), { target: { value: query } });
}

/** Each group's name and its rows' titles, in order. The query is deferred. */
async function groupsShow(expected: Record<string, string[]>) {
  await waitFor(() => {
    const groups = Object.fromEntries(
      screen.queryAllByRole("group").map((group) => [
        group.getAttribute("aria-label"),
        within(group)
          .queryAllByRole("option")
          .map((option) => option.querySelector(".font-medium")?.textContent),
      ]),
    );
    expect(groups).toEqual(expected);
  });
}

function activeTab(): string | null {
  return screen
    .getByRole("navigation", { name: "Main Navigation" })
    .querySelector('[aria-current="page"]')
    ?.getAttribute("aria-label") ?? null;
}

beforeEach(() => {
  localStorage.clear();
});

describe("search palette", () => {
  it("opens on the shortcut and groups every kind in tab order, leaving finished tasks out", async () => {
    await unlock();
    shortcut();
    await type("basil");
    await groupsShow({
      Contacts: ["Basil Hallward"],
      Calendar: ["Basil tasting"],
      Notes: ["Basil pesto", "Shopping"],
      Bookmarks: ["Basil recipes"],
      Tasks: ["Buy basil"],
    });
  });

  it("closes on Escape and opens from the header button", async () => {
    await unlock();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = await screen.findByLabelText("Search everything");
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Search everything")).toBeNull());
  });

  it("shows a body hit's snippet", async () => {
    await unlock();
    shortcut();
    await type("tomatoes");
    await groupsShow({ Notes: ["Shopping"] });
    expect(screen.getByRole("option").textContent).toContain("Tomatoes and basil.");
  });

  it("opens a note picked with the keyboard", async () => {
    await unlock();
    shortcut();
    await type("pesto");
    await groupsShow({ Notes: ["Basil pesto"] });
    fireEvent.keyDown(screen.getByLabelText("Search everything"), { key: "Enter" });
    await screen.findByDisplayValue("Basil pesto");
    expect(activeTab()).toBe("Notes");
    expect(screen.queryByLabelText("Search everything")).toBeNull();
  });

  it("moves the cursor with the arrow keys", async () => {
    await unlock();
    shortcut();
    await type("basil");
    await groupsShow({
      Contacts: ["Basil Hallward"],
      Calendar: ["Basil tasting"],
      Notes: ["Basil pesto", "Shopping"],
      Bookmarks: ["Basil recipes"],
      Tasks: ["Buy basil"],
    });
    const field = screen.getByLabelText("Search everything");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    const selected = screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("Buy basil");
    expect(field.getAttribute("aria-activedescendant")).toBe(selected?.id);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(activeTab()).toBe("Tasks"));
  });

  it("opens a bookmark in its collection, highlighted", async () => {
    await unlock();
    shortcut();
    await type("recipes");
    await groupsShow({ Bookmarks: ["Basil recipes"] });
    fireEvent.click(screen.getByRole("option"));
    await waitFor(() => expect(activeTab()).toBe("Bookmarks"));
    const row = await waitFor(() => {
      const found = document.querySelector('[data-bookmark-id="b1"]');
      if (!found) throw new Error("the bookmark row is not shown");
      return found;
    });
    expect(row.className).toContain("bg-surface/70");
  });

  it("opens an event on its day, with its date in the row", async () => {
    await unlock();
    shortcut();
    await type("tasting");
    await groupsShow({ Calendar: ["Basil tasting"] });
    expect(screen.getByRole("option").textContent).toContain("2099");
    fireEvent.click(screen.getByRole("option"));
    await waitFor(() => expect(activeTab()).toBe("Calendar"));
    await screen.findByDisplayValue("Basil tasting");
  });

  it("opens a contact in the detail pane", async () => {
    await unlock();
    shortcut();
    await type("hallward");
    await groupsShow({ Contacts: ["Basil Hallward"] });
    fireEvent.click(screen.getByRole("option"));
    await waitFor(() => expect(activeTab()).toBe("Contacts"));
    await screen.findByRole("button", { name: "Close contact details" });
  });
});
