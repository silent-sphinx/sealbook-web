// @vitest-environment jsdom
/**
 * Picking several files for a contact, mounted end to end.
 *
 * An upload is two halves: the chunks sealed and committed at the server, and
 * the contact write that records the attachment on the card. Only the second
 * makes it real, since `sweepOrphanedAttachments` reclaims anything the vault
 * does not reference. The regression covered here is a batch that collected
 * its results and wrote them once at the end, so losing the network partway
 * through discarded the uploads that had already succeeded.
 *
 * `lib/client` is faked as in the linking suite: an online session needs an
 * OPAQUE exchange only the server can answer. `uploadAttachment` is faked too,
 * because what is under test is which files each contact write carries, not the
 * sealing underneath it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact, ContactDraft, NoteAttachment } from "./lib/types";

const PASSWORD = "correct horse battery";

let store: Contact[] = [];
const writes: { id?: string; draft: ContactDraft }[] = [];

const uploadAttachment = vi.hoisted(() =>
  vi.fn<(session: unknown, file: { name: string; type: string }) => Promise<NoteAttachment>>(),
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

vi.mock("./lib/attachments", async () => {
  const actual = await vi.importActual<typeof import("./lib/attachments")>("./lib/attachments");
  return { ...actual, uploadAttachment };
});

import App from "./App";
import { MAX_ATTACHMENT_SIZE } from "./lib/attachments";

/** What the real sealing would hand back for a file that went up whole. */
function sealed(name: string, type: string, size: number): NoteAttachment {
  return {
    id: `att-${name}`,
    filename: name,
    mimeType: type,
    byteSize: size,
    adk: "AAAAAAAAAAAAAAAAAAAAAA==",
    contentHash: "AAAAAAAAAAAAAAAAAAAAAA==",
    chunkSize: size,
    chunkCount: 1,
  };
}

/** What `client` throws when the request never reaches the server. */
function lostNetwork(): Error {
  const error = new Error("Failed to fetch");
  error.name = "ServerUnreachableError";
  return error;
}

/**
 * A picked file. jsdom's own `File` reports the size of its parts, and these
 * stand in for files up to the 200 MB ceiling, so the size is declared rather
 * than allocated and `arrayBuffer` answers for the bytes the fake never reads.
 */
function file(name: string, type: string, size: number): File {
  return {
    name,
    type,
    size,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as File;
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

/** The attachment picker, which is the pane's one multiple-file input. */
function picker(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
  if (!input) throw new Error("the attachment picker is not rendered");
  return input;
}

/** The filenames a contact write recorded on the card. */
function recorded(draft: ContactDraft): string[] {
  return (draft.attachments ?? []).map((attachment) => attachment.filename);
}

beforeEach(() => {
  store = [aContact("Ada Lovelace", "c1")];
  writes.length = 0;
  uploadAttachment.mockReset();
});

describe("picking several attachments at once", () => {
  it("keeps the uploads that landed before one failed", async () => {
    uploadAttachment.mockImplementation(async (_session, file) => {
      if (file.name === "third.txt") throw lostNetwork();
      return sealed(file.name, file.type, 1024);
    });
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.change(picker(), {
      target: {
        files: [
          file("first.txt", "text/plain", 1024),
          file("second.txt", "text/plain", 1024),
          file("third.txt", "text/plain", 1024),
        ],
      },
    });

    // One write per file that landed, each carrying the ones before it, rather
    // than a single write the failure never reached.
    await waitFor(() => expect(writes.length).toBe(2));
    expect(recorded(writes[0]!.draft)).toEqual(["first.txt"]);
    expect(recorded(writes[1]!.draft)).toEqual(["first.txt", "second.txt"]);
    expect(writes.every((write) => write.id === "c1")).toBe(true);

    // The two that survived are on the card, and the failure is reported.
    expect(recorded(store[0]! as ContactDraft)).toEqual(["first.txt", "second.txt"]);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach the server");
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
  });

  it("names every file that was over the size limit", async () => {
    uploadAttachment.mockImplementation(async (_session, file) =>
      sealed(file.name, file.type, 1024),
    );
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.change(picker(), {
      target: {
        files: [
          file("huge.bin", "application/octet-stream", MAX_ATTACHMENT_SIZE + 1),
          file("small.txt", "text/plain", 1024),
          file("enormous.bin", "application/octet-stream", MAX_ATTACHMENT_SIZE * 2),
        ],
      },
    });

    await waitFor(() => expect(writes.length).toBe(1));
    expect(recorded(writes[0]!.draft)).toEqual(["small.txt"]);

    // Both rejected names, not just the last one to set the message.
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("huge.bin");
    expect(alert).toContain("enormous.bin");
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
  });
});
