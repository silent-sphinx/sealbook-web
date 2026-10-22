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
 * The second regression is the lightbox: its loader was keyed on the index with
 * no cancellation, so arrowing faster than the downloads let a stale resolution
 * paint the previous photo under the current name.
 *
 * `lib/client` is faked as in the linking suite: an online session needs an
 * OPAQUE exchange only the server can answer. `uploadAttachment` is faked too,
 * because what is under test is which files each contact write carries, not the
 * sealing underneath it. `loadAttachment` is faked where a test needs to choose
 * the order two downloads resolve in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { Contact, ContactDraft, NoteAttachment } from "./lib/types";

const PASSWORD = "correct horse battery";

let store: Contact[] = [];
const writes: { id?: string; draft: ContactDraft }[] = [];
/** Contact writes and server deletes in the order they were issued. */
const order: string[] = [];
let writeFails = false;

const uploadAttachment = vi.hoisted(() =>
  vi.fn<(session: unknown, file: { name: string; type: string }) => Promise<NoteAttachment>>(),
);

const loadAttachment = vi.hoisted(() =>
  vi.fn<(session: unknown, attachment: NoteAttachment) => Promise<Blob>>(),
);

const deleteAttachment = vi.hoisted(() => vi.fn<(session: unknown, id: string) => Promise<void>>());

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
      if (writeFails) throw lostNetwork();
      order.push("write");
      writes.push({ id, draft });
      const at = store.findIndex((contact) => contact.id === id);
      if (at !== -1) store[at] = { ...store[at]!, ...draft } as Contact;
      return id ?? "new";
    },
  };
});

vi.mock("./lib/attachments", async () => {
  const actual = await vi.importActual<typeof import("./lib/attachments")>("./lib/attachments");
  return { ...actual, uploadAttachment, loadAttachment, deleteAttachment };
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
 * stand in for files up to the whole size ceiling, so the size is declared rather
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

/** A blob the object-URL stub can name, standing in for a decrypted photo. */
interface TaggedBlob extends Blob {
  tag: string;
}

function tagged(tag: string): Blob {
  return { tag } as unknown as Blob;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Ada, with photos already on her card, as a vault read would return her. */
function withPhotos(...names: string[]): Contact {
  return {
    ...aContact("Ada Lovelace", "c1"),
    attachments: names.map((name) => sealed(name, "image/png", 2048)),
  };
}

/** The image the lightbox is currently showing. */
function shownPhoto(): HTMLImageElement {
  const dialog = screen.getByRole("dialog", { name: "Attachment viewer" });
  const img = dialog.querySelector("img");
  if (!img) throw new Error("the viewer is showing no image");
  return img;
}

/** The delete confirmation raised by the viewer's trash button. */
function confirmation(): HTMLElement {
  return screen.getByRole("dialog", { name: "Delete attachment" });
}

/** The filenames a contact write recorded on the card. */
function recorded(draft: ContactDraft): string[] {
  return (draft.attachments ?? []).map((attachment) => attachment.filename);
}

beforeEach(() => {
  store = [aContact("Ada Lovelace", "c1")];
  writes.length = 0;
  order.length = 0;
  writeFails = false;
  uploadAttachment.mockReset();
  loadAttachment.mockReset();
  deleteAttachment.mockReset();
  deleteAttachment.mockImplementation(async () => {
    order.push("delete");
  });
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

describe("the lightbox", () => {
  /**
   * jsdom has no object URL store, and the test needs to tell the two photos
   * apart by `src`. Each blob is tagged and the stub hands back that tag.
   */
  let createObjectURL: typeof URL.createObjectURL;
  let revokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    createObjectURL = URL.createObjectURL;
    revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => `blob:${(blob as TaggedBlob).tag}`) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  it("ignores a download that resolves after the viewer has moved on", async () => {
    store = [withPhotos("first.png", "second.png")];
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    loadAttachment.mockImplementation(async (_session, attachment) =>
      attachment.filename === "first.png" ? await first.promise : await second.promise,
    );
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByTitle("first.png"));

    // Arrow on before the first photo has arrived, then let the second land.
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    second.resolve(tagged("second.png"));
    await waitFor(() => expect(shownPhoto().getAttribute("src")).toBe("blob:second.png"));

    // The stale resolution must not paint itself under the current name.
    await act(async () => {
      first.resolve(tagged("first.png"));
    });
    expect(shownPhoto().getAttribute("src")).toBe("blob:second.png");
    expect(shownPhoto().getAttribute("alt")).toBe("second.png");
  });

  it("loads what is now at the index after a delete", async () => {
    store = [withPhotos("first.png", "second.png", "third.png")];
    loadAttachment.mockImplementation(async (_session, attachment) =>
      tagged(attachment.filename),
    );
    await unlock();

    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByTitle("first.png"));
    await waitFor(() => expect(shownPhoto().getAttribute("src")).toBe("blob:first.png"));

    // Deleting the first leaves the viewer on index 0, which is now the second.
    fireEvent.click(screen.getByRole("button", { name: "Delete attachment" }));
    fireEvent.click(within(confirmation()).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(shownPhoto().getAttribute("src")).toBe("blob:second.png"));
    // The viewer moves on once the card is written, so the server delete that
    // follows it is waited for rather than assumed to have happened already.
    await waitFor(() =>
      expect(deleteAttachment).toHaveBeenCalledWith(expect.anything(), "att-first.png"),
    );
    expect(recorded(store[0]! as ContactDraft)).toEqual(["second.png", "third.png"]);
  });
});

describe("deleting an attachment", () => {
  let createObjectURL: typeof URL.createObjectURL;
  let revokeObjectURL: typeof URL.revokeObjectURL;
  const revoked: string[] = [];

  beforeEach(() => {
    createObjectURL = URL.createObjectURL;
    revokeObjectURL = URL.revokeObjectURL;
    revoked.length = 0;
    URL.createObjectURL = ((blob: Blob) => `blob:${(blob as TaggedBlob).tag}`) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url);
    }) as typeof URL.revokeObjectURL;
    store = [withPhotos("first.png", "second.png")];
    loadAttachment.mockImplementation(async (_session, attachment) =>
      tagged(attachment.filename),
    );
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  /** Opens the first photo in the viewer and presses the trash button. */
  async function openAndPressTrash() {
    await unlock();
    fireEvent.click(screen.getByRole("button", { name: "View Ada Lovelace" }));
    await paneIdle();
    fireEvent.click(screen.getByTitle("first.png"));
    await waitFor(() => expect(shownPhoto().getAttribute("src")).toBe("blob:first.png"));
    fireEvent.click(screen.getByRole("button", { name: "Delete attachment" }));
    return await screen.findByRole("dialog", { name: "Delete attachment" });
  }

  it("asks first, and deletes nothing if the prompt is dismissed", async () => {
    const dialog = await openAndPressTrash();
    expect(dialog.textContent).toContain("first.png");
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete attachment" })).toBeNull(),
    );
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(recorded(store[0]! as ContactDraft)).toEqual(["first.png", "second.png"]);
    // Still on screen, and its object URL is still the one the img is using.
    expect(shownPhoto().getAttribute("src")).toBe("blob:first.png");
    expect(revoked).toEqual([]);
  });

  it("records the shortened list before deleting the file at the server", async () => {
    const dialog = await openAndPressTrash();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAttachment).toHaveBeenCalledTimes(1));
    // The card is unreferenced first: the other order leaves it pointing at
    // bytes that are gone if the write never lands.
    expect(order.slice(0, 2)).toEqual(["write", "delete"]);
    expect(recorded(writes[0]!.draft)).toEqual(["second.png"]);
    expect(revoked).toEqual(["blob:first.png"]);
  });

  it("closes only the confirmation on Escape", async () => {
    const dialog = await openAndPressTrash();
    // The viewer's own key handler is on `document`, which bubbles before the
    // dialog's, so without a guard one Escape would dismiss both.
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete attachment" })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "Attachment viewer" })).toBeDefined();
    expect(deleteAttachment).not.toHaveBeenCalled();
  });

  it("keeps the file when the contact write fails", async () => {
    const dialog = await openAndPressTrash();
    writeFails = true;
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("could not be saved");
    // Nothing deleted at the server, so the card's reference still resolves,
    // and the list the pane shows is the one that is actually stored.
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(recorded(store[0]! as ContactDraft)).toEqual(["first.png", "second.png"]);
    expect(revoked).toEqual([]);
    expect(screen.getByTitle("first.png")).toBeDefined();
  });
});
