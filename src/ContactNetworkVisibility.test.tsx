// @vitest-environment jsdom
/**
 * The contact network map's address book filter, mounted end to end.
 *
 * `lib/client` is faked for the same reason as in the visibility suite: an
 * online session needs an OPAQUE exchange only the server can answer. What is
 * under test is that switching a book off drops its contacts, and the links
 * reaching them, from the map.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { profileOf } from "./lib/contactProfile";
import type { Contact } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK = "book-work";

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
      accountSettings: { ...DEFAULT_ACCOUNT_SETTINGS, contactMode: "detailed" },
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
  };
});

import App from "./App";

/** A contact in `addressBookId`, linked reciprocally to `friendId` as a friend. */
function linked(name: string, id: string, addressBookId: string, friend: {
  id: string;
  name: string;
}): Contact {
  return {
    ...aContact(name, id),
    addressBookId,
    profile: {
      ...profileOf(),
      friends: [{ id: `p-${id}`, name: friend.name, contactId: friend.id }],
    },
  };
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
  store = [
    linked("Ada Lovelace", "c1", DEFAULT_ADDRESS_BOOK_ID, { id: "c2", name: "Grace Hopper" }),
    linked("Grace Hopper", "c2", WORK_BOOK, { id: "c1", name: "Ada Lovelace" }),
  ];
});

describe("the contact network map", () => {
  it("shows a node per linked contact while every book is visible", async () => {
    await unlock();
    expect(screen.getByRole("button", { name: "Ada Lovelace" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Grace Hopper" })).toBeDefined();
  });

  it("drops contacts in a switched-off book, and the links reaching them", async () => {
    await unlock();
    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    // Grace's book is hidden, so her node goes; Ada's only link was to her, so
    // Ada has no edges left and leaves the map too.
    expect(screen.queryByRole("button", { name: "Grace Hopper" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ada Lovelace" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all address books" }));
    expect(screen.getByRole("button", { name: "Grace Hopper" })).toBeDefined();
  });
});
