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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { profileOf } from "./lib/contactProfile";
import type { Contact } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_BOOK = "book-work";

let store: Contact[] = [];
let workHidden = false;

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
        { id: WORK_BOOK, name: "Work", raw: "{}", hideFromAll: workHidden || undefined },
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
    putAddressBook: async (
      _session: unknown,
      _name: string,
      id: string,
      _raw?: string,
      _archived?: boolean,
      _color?: string,
      hideFromAll?: boolean,
    ) => {
      workHidden = hideFromAll === true;
      return id;
    },
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

/** A contact linked reciprocally to `colleagueId` as a colleague. */
function colleague(name: string, id: string, peer: { id: string; name: string }): Contact {
  return {
    ...aContact(name, id),
    profile: {
      ...profileOf(),
      colleagues: [{ id: `p-${id}`, name: peer.name, contactId: peer.id }],
    },
  };
}

/** A contact linked reciprocally to `peer` as both a friend and a colleague. */
function friendAndColleague(name: string, id: string, peer: { id: string; name: string }): Contact {
  return {
    ...aContact(name, id),
    profile: {
      ...profileOf(),
      friends: [{ id: `pf-${id}`, name: peer.name, contactId: peer.id }],
      colleagues: [{ id: `pc-${id}`, name: peer.name, contactId: peer.id }],
    },
  };
}

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  const result = render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Ada Lovelace");
  return result;
}

beforeEach(() => {
  workHidden = false;
  store = [
    linked("Ada Lovelace", "c1", DEFAULT_ADDRESS_BOOK_ID, { id: "c2", name: "Grace Hopper" }),
    linked("Grace Hopper", "c2", WORK_BOOK, { id: "c1", name: "Ada Lovelace" }),
    colleague("Lin Wei", "c3", { id: "c4", name: "Noor Khan" }),
    colleague("Noor Khan", "c4", { id: "c3", name: "Lin Wei" }),
    aContact("Marie Curie", "c5"),
    friendAndColleague("Rosa Parks", "c6", { id: "c7", name: "Malcolm X" }),
    friendAndColleague("Malcolm X", "c7", { id: "c6", name: "Rosa Parks" }),
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "Grace Hopper" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Ada Lovelace" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all address books" }));
    expect(await screen.findByRole("button", { name: "Grace Hopper" })).toBeDefined();
  });

  it("shows a node per colleague-linked contact, same as family or friends", async () => {
    await unlock();
    expect(screen.getByRole("button", { name: "Lin Wei" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Noor Khan" })).toBeDefined();
  });

  it("hides contacts with no links until 'Every contact' is picked", async () => {
    await unlock();
    expect(screen.queryByRole("button", { name: "Marie Curie" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Every contact" }));
    expect(screen.getByRole("button", { name: "Marie Curie" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clusters only" }));
    expect(screen.queryByRole("button", { name: "Marie Curie" })).toBeNull();
  });

  it("draws one line per relationship when a pair shares more than one", async () => {
    const { container } = await unlock();

    const friendLines = container.querySelectorAll("line.stroke-link-friend");
    const colleagueLines = container.querySelectorAll("line.stroke-link-colleague");

    // Rosa and Malcolm are linked as both friends and colleagues, so their
    // pair contributes a line to each kind alongside the other fixtures'
    // single-kind pairs (Ada/Grace as friends, Lin/Noor as colleagues),
    // rather than collapsing to one line per pair.
    expect(friendLines.length).toBe(2);
    expect(colleagueLines.length).toBe(2);
  });
});
