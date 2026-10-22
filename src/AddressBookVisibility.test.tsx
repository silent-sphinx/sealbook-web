// @vitest-environment jsdom
/**
 * The contacts sidebar's address book visibility, mounted end to end.
 *
 * `lib/client` is faked for the same reason as in the editing suite: an online
 * session needs an OPAQUE exchange only the server can answer. What is under
 * test is which contacts the list shows for a given set of switched-off books,
 * and that the choice is still in force on the next render.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain, snapshotWritten } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK = "book-work";
const HIDDEN_KEY = "sealbook.hidden-address-books.collection-1";

let store: Contact[] = [];

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
      addressBooks: [
        { id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" },
        { id: WORK_BOOK, name: "Work", raw: "{}" },
      ],
      contacts: [...store],
      calendars: [],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
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
  // The list is on screen one derivation before the unlock is finished.
  await snapshotWritten();
}

function hiddenIds(): string[] {
  return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
}

beforeEach(() => {
  store = [
    inBook("Ada Lovelace", "c1", DEFAULT_ADDRESS_BOOK_ID),
    inBook("Grace Hopper", "c2", WORK_BOOK),
  ];
});

describe("switching an address book off in the sidebar", () => {
  it("drops its contacts from the list and records the choice", async () => {
    await unlock();
    expect(screen.getByText("Grace Hopper")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(screen.queryByText("Grace Hopper")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    // Stored, not merely held in state: the next session reads this back.
    expect(hiddenIds()).toEqual([WORK_BOOK]);
    // One book left showing, so the list is titled after it.
    expect(screen.getByRole("heading", { name: "Contacts", level: 1 })).toBeDefined();
  });

  it("is still in force on the next render", async () => {
    setConnectionDomain();
    await enrolDevice(PASSWORD);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([WORK_BOOK]));

    render(<App />);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText("Ada Lovelace");
    // The list is on screen one derivation before the unlock is finished.
    await snapshotWritten();

    expect(screen.queryByText("Grace Hopper")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all address books" }));

    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    expect(hiddenIds()).toEqual([]);
    expect(screen.getByRole("heading", { name: "All contacts", level: 1 })).toBeDefined();
  });
});
