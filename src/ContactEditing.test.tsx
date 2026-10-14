// @vitest-environment jsdom
/**
 * The contacts editing flow, mounted end to end.
 *
 * The detail pane is the only edit path in the app: it owns the `editing` flag
 * and `ContactForm` snapshots its draft on mount. The list stays clickable
 * beside it, so a row can be selected with the form open, and the regression
 * these cover is what used to happen then: the pane swapped its header to the
 * new contact, kept the previous one's form, and the save wrote that draft to
 * the new contact's id.
 *
 * `lib/client` is faked rather than driven against the real protocol, because
 * reaching an online session needs an OPAQUE exchange only the server can
 * answer. What is under test is which object a save addresses and what it
 * carries, so the vault is a list and `putContact` is a recorder.
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
      sealed: [],
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

/**
 * A note is the field watched for a leak: it is carried both as a typed field
 * and inside `raw`, which `serializeCard` merges the next save onto.
 */
function withNote(name: string, id: string, note: string): Contact {
  return {
    ...aContact(name, id),
    notes: note,
    raw: JSON.stringify({
      "@type": "Card",
      name: { full: name },
      notes: { n1: { note } },
    }),
  };
}

/** Resolves once the pane's own controls are live, so a click is not refused. */
async function paneIdle() {
  await waitFor(() => {
    const close = screen.queryByRole("button", { name: "Close contact details" });
    if (!close) throw new Error("the detail pane is not open");
    if (close.hasAttribute("disabled")) throw new Error("a write is still in flight");
  });
}

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Ada Lovelace");
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText("Full name") as HTMLInputElement;
}

beforeEach(() => {
  store = [
    withNote("Ada Lovelace", "c1", "met at the Analytical Engine demo"),
    withNote("Grace Hopper", "c2", "met at the Harvard Mark I"),
  ];
  writes.length = 0;
});

describe("selecting another contact while the pane is editing one", () => {
  it("closes the form rather than swapping the contact under it", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    await screen.findByLabelText("Full name");
    expect(nameField().value).toBe("Ada Lovelace");

    fireEvent.click(screen.getByRole("button", { name: "View Grace Hopper" }));

    // The pane remounts, so it comes back in its read-only state on the new
    // contact instead of showing the previous one's half-finished form.
    expect(await screen.findByRole("button", { name: "Edit contact" })).toBeDefined();
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.getByRole("heading", { name: "Grace Hopper" })).toBeDefined();
  });

  it("writes a later edit to the contact the pane is showing", async () => {
    await unlock();

    // Open the first contact and leave an edit part-finished.
    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Ada King" },
    });

    // Move to the second contact and edit that one instead.
    fireEvent.click(screen.getByRole("button", { name: "View Grace Hopper" }));
    await paneIdle();
    fireEvent.click(await screen.findByRole("button", { name: "Edit contact" }));
    expect(nameField().value).toBe("Grace Hopper");
    fireEvent.change(nameField(), { target: { value: "Grace Murray Hopper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes.length).toBe(1));
    const [write] = writes;

    // One write, to the contact on screen, carrying nothing of the other.
    expect(write!.id).toBe("c2");
    expect(write!.draft.name).toBe("Grace Murray Hopper");
    expect(write!.draft.notes).toBe("met at the Harvard Mark I");
    // `raw` is the payload the save merges onto, so a leak here would survive
    // every key `CARD_KEYS` does not overwrite.
    expect(write!.draft.raw).toContain("Harvard Mark I");
    expect(write!.draft.raw).not.toContain("Analytical Engine");
  });

  it("keeps the pane on the same contact across its own save", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Ada King" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The key is the contact id, not the revision, so a save must not remount
    // the pane and bounce the user back to the list.
    await screen.findByRole("button", { name: "Edit contact" });
    await paneIdle();
    expect(writes.map((write) => write.id)).toEqual(["c1"]);
    expect(screen.getByRole("heading", { name: "Ada King" })).toBeDefined();
  });
});
