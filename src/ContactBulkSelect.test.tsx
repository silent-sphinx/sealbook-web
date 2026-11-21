// @vitest-environment jsdom
/**
 * Bulk editing from the contact list: clicking a row's avatar selects it, and
 * the bar that appears applies one change to every selected contact.
 *
 * `lib/client` is faked as in `ContactRowMenu.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact, ContactDraft } from "./lib/types";

const PASSWORD = "correct horse battery";

let store: Contact[] = [];
const writes: { id?: string; draft: ContactDraft }[] = [];
const deleted: string[] = [];
const trashed: string[] = [];

vi.mock("./lib/trashApi", async () => {
  const actual = await vi.importActual<typeof import("./lib/trashApi")>("./lib/trashApi");
  return {
    ...actual,
    trashItems: async (_session: unknown, entries: { item: { id: string } }[]) => {
      for (const { item } of entries) trashed.push(item.id);
      const gone = new Set(entries.map((entry) => entry.item.id));
      store = store.filter((contact) => !gone.has(contact.id));
    },
    sweepTrashIfDue: async () => null,
  };
});

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
      contacts: [...store],
      calendars: [],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
    deleteContact: async (_session: unknown, id: string) => {
      deleted.push(id);
      store = store.filter((contact) => contact.id !== id);
    },
    putContact: async (_session: unknown, draft: ContactDraft, id?: string) => {
      writes.push({ id, draft });
      const at = store.findIndex((contact) => contact.id === id);
      if (at !== -1) store[at] = { ...store[at]!, ...draft } as Contact;
      return id ?? "new";
    },
  };
});

import App from "./App";

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Grace Hopper");
}


beforeEach(() => {
  store = [aContact("Ada Lovelace", "c1"), aContact("Grace Hopper", "c2")];
  writes.length = 0;
  deleted.length = 0;
});

function pick(name: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
}

describe("bulk selecting contacts", () => {
  it("selects by avatar without opening the contact", async () => {
    await unlock();

    pick("Ada Lovelace");

    expect(screen.getByText("1 selected")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Close contact details" })).toBeNull();
  });

  it("toggles further rows by clicking them once a selection exists", async () => {
    await unlock();

    pick("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "View Grace Hopper" }));

    expect(screen.getByText("2 selected")).toBeDefined();
  });

  it("selects a range with shift-click", async () => {
    store = [aContact("Ada Lovelace", "c1"), aContact("Grace Hopper", "c2"), aContact("Alan Turing", "c3")];
    await unlock();

    pick("Grace Hopper");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }), { shiftKey: true });

    expect(screen.getByText("3 selected")).toBeDefined();
  });

  it("archives every selected contact", async () => {
    await unlock();

    pick("Ada Lovelace");
    pick("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    const item = screen.getByRole("menuitem", { name: "Archive 2 contacts" });
    fireEvent.pointerDown(item);
    fireEvent.click(item);

    await waitFor(() => expect(writes.length).toBe(2));
    expect(writes.map((write) => write.id).sort()).toEqual(["c1", "c2"]);
    expect(writes.every((write) => write.draft.archived === true)).toBe(true);
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
  });

  it("asks before moving the selection to the trash, then moves each contact", async () => {
    await unlock();

    pick("Ada Lovelace");
    pick("Grace Hopper");
    fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Move 2 contacts to the trash?")).toBeDefined();
    expect(trashed).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Move to trash" }));

    await waitFor(() => expect([...trashed].sort()).toEqual(["c1", "c2"]));
    expect(deleted).toEqual([]);
  });

  it("starts a selection from a ctrl-click on the row", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }), { ctrlKey: true });

    expect(screen.getByText("1 selected")).toBeDefined();
  });

  it("selects everything with Ctrl+A, and clears on a second press", async () => {
    await unlock();

    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.getByText("2 selected")).toBeDefined();

    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("moves the selection with the Move to dropdown", async () => {
    await unlock();

    pick("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: /Move to/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Move selected contacts to" })).getByRole("button", { name: "Contacts" }),
    );

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]!.id).toBe("c1");
    expect(writes[0]!.draft.addressBookId).toBe(DEFAULT_ADDRESS_BOOK_ID);
  });

  it("offers a way to make an address book from the Move to dropdown", async () => {
    await unlock();

    pick("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: /Move to/ }));
    expect(
      within(screen.getByRole("dialog", { name: "Move selected contacts to" })).getByRole("button", { name: "New address book" }),
    ).not.toBeNull();
  });

  it("clears the selection with Escape", async () => {
    await unlock();

    pick("Ada Lovelace");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(writes.length).toBe(0);
  });
});
