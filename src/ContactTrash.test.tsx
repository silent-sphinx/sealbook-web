// @vitest-environment jsdom
/**
 * The contacts trash, end to end through `App`: a deleted contact leaves the
 * list, shows in the Trash row's view, and comes back on restore.
 *
 * `lib/client` is faked as in `ContactBulkSelect.test.tsx`; `lib/trashApi`
 * stamps the faked store, and the listing is split by the real `splitTrash`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { splitTrash } from "./lib/trash";
import type { Contact } from "./lib/types";

const PASSWORD = "correct horse battery";

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
    listVault: async () => {
      const { live, trash } = splitTrash({
        addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
        contacts: [...store],
        calendars: [],
        calendarEvents: [],
        notes: [],
        notebooks: [],
        bookmarks: [],
        bookmarkCollections: [],
        tasks: [],
        taskLists: [],
      });
      return { ...live, trash, accountSettings: DEFAULT_ACCOUNT_SETTINGS, deviceLabels: [], unopened: 0, unreadReferences: 0 };
    },
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
  };
});

vi.mock("./lib/trashApi", async () => {
  const actual = await vi.importActual<typeof import("./lib/trashApi")>("./lib/trashApi");
  const stamp = (id: string, trashedAt: string | undefined) => {
    store = store.map((contact) => (contact.id === id ? { ...contact, trashedAt } : contact));
  };
  return {
    ...actual,
    trashItems: async (_session: unknown, entries: { item: { id: string } }[]) => {
      for (const { item } of entries) stamp(item.id, new Date().toISOString());
    },
    restoreItem: async (_session: unknown, _trash: unknown, id: string) => stamp(id, undefined),
    sweepTrashIfDue: async () => null,
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
});

describe("the contacts trash", () => {
  it("holds a deleted contact until it is restored", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
    fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move to trash" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "View Ada Lovelace" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /^Trash/ }));
    const panel = await screen.findByRole("region", { name: "Trash" });
    const row = within(panel).getByRole("listitem");
    expect(row.textContent).toContain("Ada Lovelace");
    expect(row.textContent).toContain("Deletes in 30 days");

    fireEvent.click(within(row).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(within(panel).getByText("The trash is empty")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /^Trash/ }));
    expect(await screen.findByRole("button", { name: "View Ada Lovelace" })).toBeDefined();
  });
});
