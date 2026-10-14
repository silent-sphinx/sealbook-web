// @vitest-environment jsdom
/**
 * Creating an address book from the sidebar, mounted end to end.
 *
 * `lib/client` is faked for the same reason as in the editing suite: an online
 * session needs an OPAQUE exchange only the server can answer. What is under
 * test is how many objects one commit of the name field writes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { AddressBook, Contact } from "./lib/types";

const PASSWORD = "correct horse battery";

const vault = vi.hoisted(() => ({
  books: [] as { id: string; name: string; raw: string }[],
  store: [] as unknown[],
}));

const putAddressBook = vi.hoisted(() =>
  vi.fn<(session: unknown, name: string, id?: string) => Promise<string>>(async (_session, name, id) => {
    const bookId = id ?? `book-${vault.books.length + 1}`;
    vault.books = [
      ...vault.books.filter((book) => book.id !== bookId),
      { id: bookId, name, raw: "{}" },
    ];
    return bookId;
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
      sealed: [],
      addressBooks: [...vault.books] as AddressBook[],
      contacts: [...vault.store] as Contact[],
      calendars: [],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, existing: unknown) => existing,
    putAddressBook,
  };
});

import App from "./App";

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Ada Lovelace");
}

beforeEach(() => {
  putAddressBook.mockClear();
  vault.books = [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }];
  vault.store = [aContact("Ada Lovelace", "c1")];
});

describe("naming a new address book", () => {
  it("writes one book when the field is submitted and then loses focus", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "Add address book" }));
    const field = screen.getByLabelText("New address book name");
    fireEvent.change(field, { target: { value: "Work" } });

    // The browser blurs a focused field the moment it is disabled, which is what
    // the pending write does to it, so submit and blur both reach the commit.
    fireEvent.submit(field.closest("form")!);
    fireEvent.blur(field);

    expect(await screen.findAllByRole("button", { name: "Work" })).toHaveLength(1);
    expect(putAddressBook.mock.calls.filter((call) => call[1] === "Work")).toHaveLength(1);
  });

  it("writes one book when the field is only blurred", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "Add address book" }));
    const field = screen.getByLabelText("New address book name");
    fireEvent.change(field, { target: { value: "Family" } });
    fireEvent.blur(field);

    expect(await screen.findAllByRole("button", { name: "Family" })).toHaveLength(1);
    expect(putAddressBook.mock.calls.filter((call) => call[1] === "Family")).toHaveLength(1);
  });
});
