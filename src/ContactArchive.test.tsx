// @vitest-environment jsdom
/**
 * Archiving a contact, mounted end to end.
 *
 * The archive is a view over `sealbook:archived` rather than a stored book, so
 * what these cover is that the flag alone moves a contact between the two
 * lists, and that restoring it puts the contact back in the address book it
 * started in rather than in the default one.
 *
 * `lib/client` is faked as in `ContactEditing.test.tsx`: reaching an online
 * session needs an OPAQUE exchange only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact, ContactDraft } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK_ID = "book-work";

let store: Contact[] = [];
const writes: { id?: string; draft: ContactDraft }[] = [];

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
      addressBooks: [
        { id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" },
        { id: WORK_BOOK_ID, name: "Work", raw: "{}" },
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
  // Grace is the contact no test archives, so she is on screen either way.
  await screen.findByText("Grace Hopper");
}

function openArchive() {
  fireEvent.click(screen.getByTitle("Show archived contacts"));
}

/** The archive action lives in the detail pane, so a row has to be opened first. */
async function openContact(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `View ${name}` }));
  await waitFor(() => {
    const close = screen.queryByRole("button", { name: "Close contact details" });
    if (!close) throw new Error("the detail pane is not open");
    if (close.hasAttribute("disabled")) throw new Error("a write is still in flight");
  });
}

beforeEach(() => {
  store = [
    { ...aContact("Ada Lovelace", "c1"), addressBookId: WORK_BOOK_ID },
    aContact("Grace Hopper", "c2"),
  ];
  writes.length = 0;
});

describe("archiving a contact", () => {
  it("writes the flag and takes the contact out of the list", async () => {
    await unlock();

    await openContact("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "Archive contact" }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]!.id).toBe("c1");
    expect(writes[0]!.draft.archived).toBe(true);
    // The book is kept rather than cleared, so a restore has somewhere to go.
    expect(writes[0]!.draft.addressBookId).toBe(WORK_BOOK_ID);

    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
    expect(screen.getByText("Grace Hopper")).toBeDefined();
  });

  it("shows it in the archive, which is not one of the address books", async () => {
    store[0] = { ...store[0]!, archived: true };
    await unlock();

    // Not in the contact list, even with every address book showing.
    expect(screen.queryByText("Ada Lovelace")).toBeNull();

    openArchive();
    expect(screen.getByRole("heading", { name: "Archived Contacts" })).toBeDefined();
    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });

  it("is left by clicking an address book, without hiding that book", async () => {
    store[0] = { ...store[0]!, archived: true };
    await unlock();

    openArchive();
    expect(screen.queryByText("Grace Hopper")).toBeNull();

    // These rows hide rather than show, so the way back out of the archive
    // must not take the book that was clicked with it.
    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    expect(screen.getByRole("heading", { name: "All contacts", level: 1 })).toBeDefined();
  });

  it("restores it to the book it came from, clearing the flag", async () => {
    store[0] = { ...store[0]!, archived: true };
    await unlock();

    openArchive();
    await openContact("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "Restore contact" }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]!.draft.archived).toBeUndefined();
    expect(writes[0]!.draft.addressBookId).toBe(WORK_BOOK_ID);

    // The archive empties out, and the contact is back in the list behind it.
    expect(await screen.findByText("The Archive is empty")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Back to contacts" }));
    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
  });
});
