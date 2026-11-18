// @vitest-environment jsdom
/**
 * The contacts sidebar's address book visibility, mounted end to end.
 *
 * `lib/client` is faked for the same reason as in the editing suite: an online
 * session needs an OPAQUE exchange only the server can answer. What is under
 * test is which contacts the list shows for a given set of switched-off books,
 * that the choice is stored on the book rather than in this browser, and that a
 * set an older build kept in this browser is moved onto the books.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK = "book-work";
const HIDDEN_KEY = "sealbook.hidden-address-books.collection-1";

let store: Contact[] = [];
let books: { id: string; name: string; raw: string; hideFromAll?: boolean }[] = [];
let bookWrites: { id: string; hideFromAll?: boolean }[] = [];

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
      _name: string,
      id: string,
      _raw?: string,
      _archived?: boolean,
      _color?: string,
      hideFromAll?: boolean,
    ) => {
      bookWrites.push({ id, hideFromAll });
      books = books.map((book) => (book.id === id ? { ...book, hideFromAll: hideFromAll || undefined } : book));
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

function localIds(): string[] {
  return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
}

beforeEach(() => {
  books = [
    { id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" },
    { id: WORK_BOOK, name: "Work", raw: "{}" },
  ];
  bookWrites = [];
  store = [
    inBook("Ada Lovelace", "c1", DEFAULT_ADDRESS_BOOK_ID),
    inBook("Grace Hopper", "c2", WORK_BOOK),
  ];
});

describe("switching an address book off in the sidebar", () => {
  it("drops its contacts from the list and stores the choice on the book", async () => {
    await unlock();
    expect(screen.getByText("Grace Hopper")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    await waitFor(() => expect(screen.queryByText("Grace Hopper")).toBeNull());
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    // Stored on the book, not in this browser: every device reads it back.
    expect(bookWrites).toEqual([{ id: WORK_BOOK, hideFromAll: true }]);
    expect(localIds()).toEqual([]);
    // One book left showing, so the list is titled after it.
    expect(screen.getByRole("heading", { name: "Contacts", level: 1 })).toBeDefined();
  });

  it("is still in force on the next render, and Show all clears it", async () => {
    books = books.map((book) => (book.id === WORK_BOOK ? { ...book, hideFromAll: true } : book));
    await unlock();

    expect(screen.queryByText("Grace Hopper")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all address books" }));

    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    expect(bookWrites).toEqual([{ id: WORK_BOOK, hideFromAll: false }]);
    expect(screen.getByRole("heading", { name: "All contacts", level: 1 })).toBeDefined();
  });

  it("moves a set an older build kept in this browser onto the books, once", async () => {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([WORK_BOOK, "book-gone"]));
    await unlock();

    await waitFor(() => expect(bookWrites).toEqual([{ id: WORK_BOOK, hideFromAll: true }]));
    await waitFor(() => expect(screen.queryByText("Grace Hopper")).toBeNull());
    expect(localIds()).toEqual([]);
  });

  it("leaves a book another device has already hidden alone, and never shows one", async () => {
    books = books.map((book) => (book.id === WORK_BOOK ? { ...book, hideFromAll: true } : book));
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([WORK_BOOK]));
    await unlock();

    await waitFor(() => expect(localIds()).toEqual([]));
    expect(bookWrites).toEqual([]);
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });
});
