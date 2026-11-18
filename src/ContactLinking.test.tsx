// @vitest-environment jsdom
/**
 * The reciprocal half of the relationship links, mounted end to end.
 *
 * A link is two writes: the viewed contact's section and the back-reference on
 * the other card. The regressions covered here are the second write reaching
 * further than the click did, taking a pair's other sections with it, which
 * `buildContactNetwork` then kept drawing from whichever side still held it,
 * and a delete leaving the back-reference behind pointing at a card that is
 * gone.
 *
 * `lib/client` is faked for the same reason as in the editing suite: an online
 * session needs an OPAQUE exchange only the server can answer. What is under
 * test is which profile each write carries, so the vault is a list and
 * `putContact` is a recorder.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { profileOf, type LinkableSection } from "./lib/contactProfile";
import type { Contact, ContactDraft } from "./lib/types";

const PASSWORD = "correct horse battery";

let store: Contact[] = [];
const writes: { id?: string; draft: ContactDraft }[] = [];
const deletions: string[] = [];
const trashed: string[] = [];

vi.mock("./lib/trashApi", async () => {
  const actual = await vi.importActual<typeof import("./lib/trashApi")>("./lib/trashApi");
  return {
    ...actual,
    trashItems: async (_session: unknown, entries: { item: { id: string } }[]) => {
      for (const { item } of entries) trashed.push(item.id);
      const gone = new Set(entries.map((entry) => entry.item.id));
      store = store.filter((contact) => !gone.has(contact.id));
    },
    sweepTrashIfDue: async () => null,
  };
});

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
      accountSettings: { ...DEFAULT_ACCOUNT_SETTINGS, contactMode: "detailed" },
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
    putContact: async (_session: unknown, draft: ContactDraft, id?: string) => {
      writes.push({ id, draft });
      const at = store.findIndex((contact) => contact.id === id);
      if (at !== -1) store[at] = { ...store[at]!, ...draft } as Contact;
      return id ?? "new";
    },
    deleteContact: async (_session: unknown, id: string) => {
      deletions.push(id);
      store = store.filter((contact) => contact.id !== id);
    },
  };
});

import App from "./App";

/** Both relationship sections present, so the form offers each a link button. */
function unlinkedSections(name: string, id: string): Contact {
  return {
    ...aContact(name, id),
    profile: {
      ...profileOf(),
      friends: [{ id: `uf-${id}`, name: "Someone Else" }],
      colleagues: [{ id: `uc-${id}`, name: "Someone Else" }],
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
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "View Ada Lovelace" });
}

/** Resolves once the pane's own controls are live, so a click is not refused. */
async function paneIdle() {
  await waitFor(() => {
    const close = screen.queryByRole("button", { name: "Close contact details" });
    if (!close) throw new Error("the detail pane is not open");
    if (close.hasAttribute("disabled")) throw new Error("a write is still in flight");
  });
}

/** The named relationship section of the open pane. */
function sectionOf(section: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: section, level: 4 });
  const body = heading.closest("section");
  if (!body) throw new Error(`the ${section} section is not rendered`);
  return body as HTMLElement;
}

/** The same, in the edit form, whose section headings sit a level higher. */
function formSectionOf(section: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: section, level: 3 });
  const body = heading.closest("section");
  if (!body) throw new Error(`the ${section} form section is not rendered`);
  return body as HTMLElement;
}

/**
 * The names of the linked rows the named section lists. A linked row draws its
 * name as the button that navigates to the card, so the section's other two
 * controls are what is dropped here.
 */
function linkedIn(section: string): string[] {
  return within(sectionOf(section))
    .queryAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => label !== "Unlink" && label !== "Link a contact");
}

/** What a write left in one of the target's linkable sections. */
function names(draft: ContactDraft, section: LinkableSection): string[] {
  return profileOf(draft.profile)[section].map((person) => person.name);
}

beforeEach(() => {
  store = [
    friendAndColleague("Ada Lovelace", "c1", { id: "c2", name: "Grace Hopper" }),
    friendAndColleague("Grace Hopper", "c2", { id: "c1", name: "Ada Lovelace" }),
  ];
  writes.length = 0;
  deletions.length = 0;
});

describe("unlinking one section of a pair linked in several", () => {
  it("leaves the other contact's remaining sections alone", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(within(sectionOf("Friends")).getByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(writes.length).toBe(2));
    const [mine, theirs] = writes;

    // The viewed contact loses the friend and keeps the colleague.
    expect(mine!.id).toBe("c1");
    expect(names(mine!.draft, "friends")).toEqual([]);
    expect(names(mine!.draft, "colleagues")).toEqual(["Grace Hopper"]);

    // And the same on the other card, rather than every section cleared.
    expect(theirs!.id).toBe("c2");
    expect(names(theirs!.draft, "friends")).toEqual([]);
    expect(names(theirs!.draft, "colleagues")).toEqual(["Ada Lovelace"]);
  });

  it("keeps the surviving link on screen from either side", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(within(sectionOf("Friends")).getByRole("button", { name: "Unlink" }));
    await paneIdle();

    // The pane Ada left shows the colleague link alone.
    expect(linkedIn("Friends")).toEqual([]);
    expect(linkedIn("Colleagues")).toEqual(["Grace Hopper"]);

    fireEvent.click(screen.getByRole("button", { name: "View Grace Hopper" }));
    await paneIdle();

    // Grace's card agrees, so the map is not drawing an edge one side denies.
    expect(linkedIn("Friends")).toEqual([]);
    expect(linkedIn("Colleagues")).toEqual(["Ada Lovelace"]);
  });
});

describe("linking one contact into two sections in a single save", () => {
  beforeEach(() => {
    store = [unlinkedSections("Ada Lovelace", "c1"), aContact("Grace Hopper", "c2")];
    writes.length = 0;
  });

  it("writes the target once, carrying both back-references", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));

    for (const section of ["Friends", "Colleagues"]) {
      fireEvent.click(
        within(formSectionOf(section)).getByRole("button", { name: "Link a contact" }),
      );
      const picker = await screen.findByRole("dialog", {
        name: `Link a contact to ${section.toLowerCase()}`,
      });
      fireEvent.click(within(picker).getByRole("button", { name: /Grace Hopper/ }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Ada's own card and one write for Grace, not one per section.
    await waitFor(() => expect(writes.length).toBe(2));
    const theirs = writes.filter((write) => write.id === "c2");
    expect(theirs.length).toBe(1);
    expect(names(theirs[0]!.draft, "friends")).toEqual(["Ada Lovelace"]);
    expect(names(theirs[0]!.draft, "colleagues")).toEqual(["Ada Lovelace"]);
  });

  it("shows both links from the other side after the save", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));

    for (const section of ["Friends", "Colleagues"]) {
      fireEvent.click(
        within(formSectionOf(section)).getByRole("button", { name: "Link a contact" }),
      );
      const picker = await screen.findByRole("dialog", {
        name: `Link a contact to ${section.toLowerCase()}`,
      });
      fireEvent.click(within(picker).getByRole("button", { name: /Grace Hopper/ }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await paneIdle();

    fireEvent.click(screen.getByRole("button", { name: "View Grace Hopper" }));
    await paneIdle();

    expect(linkedIn("Friends")).toEqual(["Ada Lovelace"]);
    expect(linkedIn("Colleagues")).toEqual(["Ada Lovelace"]);
  });
});

describe("deleting a contact other cards link to", () => {
  beforeEach(() => {
    store = [
      {
        ...aContact("Ada Lovelace", "c1"),
        profile: {
          ...profileOf(),
          friends: [
            { id: "f1", name: "Grace Hopper", contactId: "c2" },
            { id: "f2", name: "Someone Else" },
          ],
          colleagues: [{ id: "k1", name: "Grace Hopper", contactId: "c2" }],
        },
      },
      aContact("Grace Hopper", "c2"),
      {
        ...aContact("Charles Babbage", "c3"),
        profile: {
          ...profileOf(),
          family: [{ id: "m1", name: "Grace Hopper", contactId: "c2" }],
        },
      },
    ];
    writes.length = 0;
    deletions.length = 0;
    trashed.length = 0;
  });

  /** Opens the named contact's pane and confirms the move to the trash. */
  async function deleteViaPane(name: string) {
    fireEvent.click(screen.getByRole("button", { name: `View ${name}` }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
    const dialog = await screen.findByRole("dialog", { name: "Move to trash" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
  }

  it("moves it to the trash and leaves the cards that link to it alone, for a restore", async () => {
    await unlock();
    await deleteViaPane("Grace Hopper");

    await waitFor(() => expect(trashed).toEqual(["c2"]));
    expect(deletions).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("shows a link to a contact in the trash as a plain name, not a way to it", async () => {
    await unlock();
    await deleteViaPane("Grace Hopper");
    await waitFor(() => expect(trashed.length).toBe(1));

    fireEvent.click(await screen.findByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();

    expect(linkedIn("Friends")).toEqual([]);
    expect(within(sectionOf("Friends")).getByText("Grace Hopper")).toBeDefined();
    expect(screen.queryByRole("button", { name: "View Grace Hopper" })).toBeNull();
  });
});
