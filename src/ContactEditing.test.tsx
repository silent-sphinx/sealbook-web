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
import { aContact, enrolDevice, setConnectionDomain, snapshotWritten } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact, ContactDraft } from "./lib/types";

const PASSWORD = "correct horse battery";
/** The `updated` stamp the fake server writes onto a card it stores. */
const SAVED_AT = "2026-10-22T09:30:00.000Z";

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
      // As a real save does: what lands in the vault is the serialized card,
      // carrying an `updated` stamp the draft that produced it never had.
      if (at !== -1) {
        store[at] = {
          ...store[at]!,
          ...draft,
          updatedAt: SAVED_AT,
          raw: JSON.stringify({ ...JSON.parse(draft.raw ?? "{}"), updated: SAVED_AT }),
        } as Contact;
      }
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
  // The list is on screen one derivation before the unlock is finished.
  await snapshotWritten();
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

describe("leaving a contact that is open for editing", () => {
  it("keeps the draft when the prompt is dismissed", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Ada King" },
    });

    fireEvent.click(screen.getByRole("button", { name: "View Grace Hopper" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

    // Still the same form, still carrying what was typed into it.
    expect(nameField().value).toBe("Ada King");
    expect(screen.queryByRole("heading", { name: "Grace Hopper" })).toBeNull();
  });
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
    // Leaving an open edit is held until the draft is given up.
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
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

  it("shows the stored revision after its own save, not the one it opened", async () => {
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Ada King" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await paneIdle();

    // The pane holds a contact, not an id, so a save that only merged the draft
    // in left it on the revision it opened with: no stored `updated` stamp.
    await waitFor(() =>
      expect(screen.getByLabelText("Ada King details").textContent).toContain("Modified"),
    );

    // And the next save merges onto the raw the refresh brought back, so a key
    // only the stored card carries is not dropped on the way out.
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Ada Byron" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes.length).toBe(2));
    expect(writes[1]!.draft.raw).toContain(SAVED_AT);
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
