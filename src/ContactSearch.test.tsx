// @vitest-environment jsdom
/**
 * The contacts search, mounted end to end.
 *
 * The haystack is built per contact in a memo rather than inside the filter
 * callback, so what these cover is that every field it used to read inline is
 * still matched, that it is rebuilt when a contact or an address book changes,
 * and that the archive is searched by the same text as the list. The typed
 * value is deferred, so the assertions wait on the list rather than reading it
 * straight after the keystroke.
 *
 * `lib/client` is faked as in `ContactEditing.test.tsx`: reaching an online
 * session needs an OPAQUE exchange only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain, snapshotWritten } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { emptyProfile } from "./lib/contactProfile";
import type { Contact, ContactDraft } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK_ID = "book-work";

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
        { id: WORK_BOOK_ID, name: "Admiralty", raw: "{}" },
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
  await screen.findByText("Ada Lovelace");
  // The list is on screen one derivation before the unlock is finished.
  await snapshotWritten();
}

function search(query: string) {
  fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: query } });
}

/** The deferred query makes the list a frame behind the field. */
async function listShows(...names: string[]) {
  await waitFor(() => {
    const shown = screen
      .queryAllByRole("button", { name: /^View / })
      .map((row) => row.getAttribute("aria-label")?.replace("View ", ""));
    expect(shown).toEqual(names);
  });
}

async function paneIdle() {
  await waitFor(() => {
    const close = screen.queryByRole("button", { name: "Close contact details" });
    if (!close) throw new Error("the detail pane is not open");
    if (close.hasAttribute("disabled")) throw new Error("a write is still in flight");
  });
}

beforeEach(() => {
  store = [
    {
      ...aContact("Ada Lovelace", "c1"),
      phones: [{ id: "p1", kind: "mobile", value: "+44 7700 900123" }],
      profile: { ...emptyProfile(), howWeMet: "At the Royal Society" },
    },
    {
      ...aContact("Grace Hopper", "c2"),
      addressBookId: WORK_BOOK_ID,
      notes: "wrote the first compiler",
    },
  ];
});

describe("the contacts search", () => {
  it("keeps the contacts whose name matches", async () => {
    await unlock();
    await listShows("Ada Lovelace", "Grace Hopper");

    search("hopp");
    await listShows("Grace Hopper");
  });

  it("matches a field the row does not show", async () => {
    await unlock();

    search("900123");
    await listShows("Ada Lovelace");

    search("royal society");
    await listShows("Ada Lovelace");

    search("first compiler");
    await listShows("Grace Hopper");
  });

  it("matches the name of the address book a contact is in", async () => {
    await unlock();

    search("admiralty");
    await listShows("Grace Hopper");
  });

  it("ignores case and the query's own padding", async () => {
    await unlock();

    search("  LOVELACE  ");
    await listShows("Ada Lovelace");
  });

  it("offers to clear a query that matches nothing", async () => {
    await unlock();

    search("babbage");
    await listShows();
    // The field's own cross carries the same name, so the empty state's button
    // is the last of the two.
    const clear = await screen.findAllByRole("button", { name: "Clear search" });
    fireEvent.click(clear[clear.length - 1]!);
    await listShows("Ada Lovelace", "Grace Hopper");
  });

  it("searches the archive by the same text", async () => {
    store[1] = { ...store[1]!, archived: true };
    await unlock();

    search("first compiler");
    // Archived, so not in the list the search is over.
    await listShows();

    fireEvent.click(screen.getByTitle("Show archived contacts"));
    await listShows("Grace Hopper");
  });

  it("follows a contact renamed under the open query", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Ada King" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await paneIdle();

    // The haystack is memoised on the contacts, so the save has to rebuild it.
    search("king");
    await listShows("Ada King");

    search("lovelace");
    await listShows();
  });
});
