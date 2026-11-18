// @vitest-environment jsdom
/**
 * The contact list row's context menu, mounted end to end.
 *
 * The row itself carries no action buttons, so what these cover is that the
 * three actions the detail pane holds are reachable from the row without
 * opening it, and that a row in the archive offers the restore instead.
 *
 * `lib/client` is faked as in `ContactArchive.test.tsx`: reaching an online
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

/** The row's own button spans it, so right-clicking the row lands there. */
function openRowMenu(name: string) {
  fireEvent.contextMenu(screen.getByRole("button", { name: `View ${name}` }), {
    clientX: 40,
    clientY: 60,
  });
}

/** A real click fires `pointerdown` first, which the menu must not read as outside. */
function choose(label: string) {
  const item = screen.getByRole("menuitem", { name: label });
  fireEvent.pointerDown(item);
  fireEvent.click(item);
}

beforeEach(() => {
  store = [aContact("Ada Lovelace", "c1"), aContact("Grace Hopper", "c2")];
  writes.length = 0;
});

describe("the contact row context menu", () => {
  it("opens the contact straight into editing", async () => {
    await unlock();

    openRowMenu("Ada Lovelace");
    choose("Edit contact");

    expect(await screen.findByText("Editing contact")).toBeDefined();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("archives without opening the contact", async () => {
    await unlock();

    openRowMenu("Ada Lovelace");
    choose("Archive contact");

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]!.id).toBe("c1");
    expect(writes[0]!.draft.archived).toBe(true);
    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
    // The detail pane was never opened by the action it carried out.
    expect(screen.queryByRole("button", { name: "Close contact details" })).toBeNull();
  });

  it("offers the restore on a row in the archive", async () => {
    store[0] = { ...store[0]!, archived: true };
    await unlock();

    fireEvent.click(screen.getByTitle("Show archived contacts"));
    await screen.findByText("Ada Lovelace");
    openRowMenu("Ada Lovelace");
    expect(screen.queryByRole("menuitem", { name: "Archive contact" })).toBeNull();
    choose("Restore from archive");

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]!.draft.archived).toBeUndefined();
  });

  it("asks before deleting, rather than deleting from the menu", async () => {
    await unlock();

    openRowMenu("Ada Lovelace");
    choose("Delete contact");

    expect(await screen.findByText(/Move .Ada Lovelace. to the trash\?/u)).toBeDefined();
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
  });
});
