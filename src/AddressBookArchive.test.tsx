// @vitest-environment jsdom
/**
 * Archiving an address book, mounted end to end.
 *
 * `lib/client` is faked as in `AddressBookVisibility.test.tsx`. What is under
 * test is that an archived book leaves the live list for its own group, takes
 * its contacts out of the list until it is switched on, and that archive and
 * restore write the flag without touching the name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { AddressBook, Contact } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK = "book-work";
const SHOWN_KEY = "sealbook.shown-archived-address-books.collection-1";

let store: Contact[] = [];
let books: AddressBook[] = [];
const bookWrites: { id: string; name: string; archived: boolean }[] = [];

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
      addressBooks: books.map((book) => ({ ...book })),
      contacts: [...store],
      calendars: [],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, listed: unknown) => listed,
    putAddressBook: async (
      _session: unknown,
      name: string,
      id: string,
      _raw?: string,
      archived = false,
    ) => {
      bookWrites.push({ id, name, archived });
      books = books.map((book) =>
        book.id === id ? { ...book, name, archived: archived || undefined } : book,
      );
      return id;
    },
  };
});

import App from "./App";

function inBook(name: string, id: string, addressBookId: string): Contact {
  return { ...aContact(name, id), addressBookId };
}

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Ada Lovelace");
}

beforeEach(() => {
  bookWrites.length = 0;
  store = [
    inBook("Ada Lovelace", "c1", DEFAULT_ADDRESS_BOOK_ID),
    inBook("Grace Hopper", "c2", WORK_BOOK),
  ];
  books = [
    { id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" },
    { id: WORK_BOOK, name: "Work", raw: "{}" },
  ];
});

describe("an archived address book", () => {
  it("leaves the live list and hides its contacts until it is switched on", async () => {
    books[1] = { ...books[1]!, archived: true };
    await unlock();

    expect(screen.queryByText("Grace Hopper")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide Work" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Archived address books/ }));
    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    expect(localStorage.getItem(SHOWN_KEY)).toBe(JSON.stringify([WORK_BOOK]));
  });

  it("is offered no archive action for the default book", async () => {
    await unlock();

    expect(screen.queryByRole("button", { name: "Archive Contacts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Archive Work" })).toBeDefined();
  });

  it("is written archived by the row action, and restored from its group", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "Archive Work" }));
    expect(await screen.findByRole("button", { name: /Archived address books/ })).toBeDefined();
    expect(bookWrites).toEqual([{ id: WORK_BOOK, name: "Work", archived: true }]);
    expect(screen.queryByText("Grace Hopper")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Archived address books/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore Work address book" }));

    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    expect(bookWrites[1]).toEqual({ id: WORK_BOOK, name: "Work", archived: false });
  });
});
