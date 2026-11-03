// @vitest-environment jsdom
/**
 * The bookmark collections sidebar, mounted end to end: creating a top-level
 * collection versus a subcollection, expand/collapse, and drag-and-drop
 * reparenting. `lib/client` is faked for the same reason as the address book
 * suites — an online session needs an OPAQUE exchange only the server can
 * answer, and what is under test here is which `parentId` each action writes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { DEFAULT_BOOKMARK_COLLECTION_ID, DEFAULT_BOOKMARK_COLLECTION_NAME } from "./lib/bookmark";
import type { BookmarkCollection } from "./lib/types";

const PASSWORD = "correct horse battery";

const vault = vi.hoisted(() => ({
  collections: [] as { id: string; name: string; parentId?: string; raw: string }[],
}));

const putBookmarkCollection = vi.hoisted(() =>
  vi.fn<
    (
      session: unknown,
      name: string,
      parentId?: string,
      existingId?: string,
      previousRaw?: string,
    ) => Promise<string>
  >(async (_session, name, parentId, existingId) => {
    const id = existingId ?? `collection-${vault.collections.length + 1}`;
    vault.collections = [
      ...vault.collections.filter((collection) => collection.id !== id),
      { id, name, parentId, raw: "{}" },
    ];
    return id;
  }),
);

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
      contacts: [aContact("Ada Lovelace", "c1")],
      calendars: [],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      bookmarks: [],
      bookmarkCollections: [...vault.collections] as BookmarkCollection[],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultBookmarkCollection: async (_session: unknown, existing: unknown) => existing,
    putBookmarkCollection,
  };
});

import App from "./App";

/** A fake `DataTransfer`: jsdom has no native one for a real drag event to carry. */
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

/**
 * Builds a native drag event carrying a fake `dataTransfer`, bypassing
 * `fireEvent`'s init dict (which cannot set a read-only `DragEvent` property)
 * by defining it directly on the plain `Event` React's plugin reads it from.
 */
function dragEvent(type: string, transfer: FakeDataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

function dragRow(name: string): HTMLElement {
  const row = screen.getByRole("button", { name }).closest('[draggable="true"]');
  if (!row) throw new Error(`no draggable row for ${name}`);
  return row as HTMLElement;
}

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Ada Lovelace");
  fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
  await screen.findByRole("button", { name: DEFAULT_BOOKMARK_COLLECTION_NAME });
}

beforeEach(() => {
  putBookmarkCollection.mockClear();
  vault.collections = [
    { id: DEFAULT_BOOKMARK_COLLECTION_ID, name: DEFAULT_BOOKMARK_COLLECTION_NAME, raw: "{}" },
  ];
});

describe("adding a collection versus a subcollection", () => {
  it("the header's + always starts a top-level collection", async () => {
    await unlock();
    // Scoped to an existing collection first: the header button must not read
    // that as "nest the new one here," which is the whole complaint this
    // split fixes.
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_BOOKMARK_COLLECTION_NAME }));

    fireEvent.click(screen.getByRole("button", { name: "Add collection" }));
    fireEvent.change(screen.getByLabelText("New collection name"), {
      target: { value: "Work" },
    });
    fireEvent.submit(screen.getByLabelText("New collection name").closest("form") ?? document.body);
    fireEvent.keyDown(screen.getByLabelText("New collection name"), { key: "Enter" });

    await screen.findAllByRole("button", { name: "Work" });
    const call = putBookmarkCollection.mock.calls.find((call) => call[1] === "Work");
    expect(call?.[2]).toBeUndefined();
  });

  it("a row's Add subcollection nests under that row, not the current scope", async () => {
    await unlock();
    fireEvent.click(screen.getByRole("button", { name: "Add collection" }));
    fireEvent.change(screen.getByLabelText("New collection name"), {
      target: { value: "Work" },
    });
    fireEvent.keyDown(screen.getByLabelText("New collection name"), { key: "Enter" });
    const workButton = await screen.findByRole("button", { name: "Work" });

    fireEvent.click(screen.getByRole("button", { name: "Add subcollection under Work" }));
    fireEvent.change(screen.getByLabelText("New subcollection under Work"), {
      target: { value: "Research" },
    });
    fireEvent.keyDown(screen.getByLabelText("New subcollection under Work"), { key: "Enter" });

    await screen.findAllByRole("button", { name: "Research" });
    const call = putBookmarkCollection.mock.calls.find((call) => call[1] === "Research");
    const workId = vault.collections.find((collection) => collection.name === "Work")?.id;
    expect(call?.[2]).toBe(workId);
    expect(workButton).toBeTruthy();
  });
});

describe("expand and collapse", () => {
  it("collapsing a collection hides its children, the toggle reveals them again", async () => {
    vault.collections.push(
      { id: "work", name: "Work", raw: "{}" },
      { id: "research", name: "Research", parentId: "work", raw: "{}" },
    );
    await unlock();

    await screen.findByText("Research");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Work" }));
    expect(screen.queryByText("Research")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Work" }));
    expect(screen.getByText("Research")).toBeTruthy();
  });
});

describe("dragging a collection onto another", () => {
  it("nests it under the collection it is dropped on", async () => {
    vault.collections.push(
      { id: "work", name: "Work", raw: "{}" },
      { id: "research", name: "Research", raw: "{}" },
    );
    await unlock();

    const transfer = new FakeDataTransfer();
    fireEvent(dragRow("Research"), dragEvent("dragstart", transfer));
    fireEvent(dragRow("Work"), dragEvent("dragover", transfer));
    fireEvent(dragRow("Work"), dragEvent("drop", transfer));

    const call = putBookmarkCollection.mock.calls.find(
      (call) => call[3] === "research",
    );
    expect(call?.[2]).toBe("work");
  });

  it("offers a top-level drop zone that clears a collection's parent", async () => {
    vault.collections.push(
      { id: "work", name: "Work", raw: "{}" },
      { id: "research", name: "Research", parentId: "work", raw: "{}" },
    );
    await unlock();
    await screen.findByText("Research");

    const transfer = new FakeDataTransfer();
    fireEvent(dragRow("Research"), dragEvent("dragstart", transfer));
    const dropZone = await screen.findByText("Move to top level");
    fireEvent(dropZone, dragEvent("dragover", transfer));
    fireEvent(dropZone, dragEvent("drop", transfer));

    const call = putBookmarkCollection.mock.calls.find((call) => call[3] === "research");
    expect(call?.[2]).toBeUndefined();
  });
});
