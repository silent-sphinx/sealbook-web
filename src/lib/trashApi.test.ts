// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./client";
import type { SealedWrite } from "./clientFlush";
import { DEFAULT_NOTEBOOK_ID, NOTEBOOK_CONTENT_TYPE, NOTE_CONTENT_TYPE } from "./note";
import { splitTrash, type TrashableItems } from "./trash";
import type { Contact, Note, Notebook } from "./types";

const flushed: SealedWrite[][] = [];
const contactWrites: { id?: string; profile: unknown }[] = [];

vi.mock("./clientFlush", async () => {
  const actual = await vi.importActual<typeof import("./clientFlush")>("./clientFlush");
  return {
    ...actual,
    putSealedMany: async (_session: unknown, writes: SealedWrite[]) => {
      flushed.push(writes);
    },
  };
});

vi.mock("./addressBookApi", async () => {
  const actual = await vi.importActual<typeof import("./addressBookApi")>("./addressBookApi");
  return {
    ...actual,
    putContact: async (_session: unknown, draft: { profile?: unknown }, id?: string) => {
      contactWrites.push({ id, profile: draft.profile });
      return id ?? "new";
    },
  };
});

const { DEFAULT_CONTAINER_REFUSAL, TRASH_SWEEP_INTERVAL_MS, purgeItems, restoreItem, sweepTrashIfDue, trashItems } =
  await import("./trashApi");

const SESSION = { offline: false, state: { collection_id: "col" } } as unknown as Session;
const STAMP = "2026-11-01T00:00:00Z";

function items(overrides: Partial<TrashableItems>): TrashableItems {
  return {
    addressBooks: [],
    contacts: [],
    calendars: [],
    calendarEvents: [],
    notes: [],
    notebooks: [],
    bookmarks: [],
    bookmarkCollections: [],
    tasks: [],
    taskLists: [],
    ...overrides,
  };
}

const notebook = (id: string, extra: Partial<Notebook> = {}): Notebook => ({
  id,
  name: id,
  raw: JSON.stringify({ "@type": "Notebook", version: "1.0", name: id }),
  ...extra,
});

const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id,
  title: id,
  body: "",
  notebookId: "book",
  raw: JSON.stringify({ "@type": "Note", version: "1.0", title: id, notebookId: extra.notebookId ?? "book" }),
  ...extra,
});

beforeEach(() => {
  flushed.length = 0;
  contactWrites.length = 0;
  localStorage.clear();
});

describe("trashItems", () => {
  it("stamps each item in one flush, under its own content type", async () => {
    await trashItems(
      SESSION,
      [
        { kind: "notebook", item: notebook("book") },
        { kind: "note", item: note("a") },
      ],
      STAMP,
    );
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.map((write) => [write.id, write.contentType, write.tombstone])).toEqual([
      ["book", NOTEBOOK_CONTENT_TYPE, false],
      ["a", NOTE_CONTENT_TYPE, false],
    ]);
    expect(JSON.parse(flushed[0]![0]!.payload).trashedAt).toBe(STAMP);
    expect(JSON.parse(flushed[0]![0]!.payload).name).toBe("book");
  });

  it("refuses a default container, which every client would recreate empty", async () => {
    await expect(
      trashItems(SESSION, [{ kind: "notebook", item: notebook(DEFAULT_NOTEBOOK_ID) }]),
    ).rejects.toThrow(DEFAULT_CONTAINER_REFUSAL);
    expect(flushed).toEqual([]);
  });
});

describe("restoreItem", () => {
  it("clears the stamp, and moves a note out of a notebook still in the trash", async () => {
    const { trash } = splitTrash(
      items({
        notebooks: [notebook("book", { trashedAt: STAMP })],
        notes: [note("a", { trashedAt: STAMP, raw: JSON.stringify({ "@type": "Note", version: "1.0", title: "a", notebookId: "book", trashedAt: STAMP }) })],
      }),
    );
    await restoreItem(SESSION, trash, "a");
    const written = JSON.parse(flushed[0]![0]!.payload) as Record<string, unknown>;
    expect(written.trashedAt).toBeUndefined();
    expect(written.notebookId).toBe(DEFAULT_NOTEBOOK_ID);
  });

  it("brings a container back where it was", async () => {
    const { trash } = splitTrash(items({ notebooks: [notebook("book", { trashedAt: STAMP })], notes: [note("a")] }));
    await restoreItem(SESSION, trash, "book");
    expect(flushed[0]!.map((write) => write.id)).toEqual(["book"]);
    expect(JSON.parse(flushed[0]![0]!.payload).trashedAt).toBeUndefined();
  });
});

describe("purgeItems", () => {
  it("tombstones a container and everything inside it, innermost first", async () => {
    const { trash } = splitTrash(
      items({
        notebooks: [notebook("book", { trashedAt: STAMP })],
        notes: [note("a"), note("b", { parentId: "a" })],
      }),
    );
    expect(await purgeItems(SESSION, trash, ["book"], [])).toBe(3);
    expect(flushed[0]!.map((write) => [write.id, write.tombstone])).toEqual([
      ["b", true],
      ["a", true],
      ["book", true],
    ]);
  });

  it("unlinks a purged contact from the live cards that point at it", async () => {
    const gone = { id: "c2", name: "Grace", trashedAt: STAMP, raw: "{}" } as unknown as Contact;
    const linking = {
      id: "c1",
      name: "Ada",
      raw: "{}",
      profile: { friends: [{ id: "f1", name: "Grace", contactId: "c2" }, { id: "f2", name: "Someone" }] },
    } as unknown as Contact;
    const bystander = { id: "c3", name: "Charles", raw: "{}" } as unknown as Contact;
    const { trash } = splitTrash(items({ contacts: [gone] }));

    await purgeItems(SESSION, trash, ["c2"], [linking, bystander]);

    expect(flushed[0]!.map((write) => write.id)).toEqual(["c2"]);
    expect(contactWrites.map((write) => write.id)).toEqual(["c1"]);
    const friends = (contactWrites[0]!.profile as { friends: { name: string }[] }).friends;
    expect(friends.map((friend) => friend.name)).toEqual(["Someone"]);
  });
});

describe("sweepTrashIfDue", () => {
  const old = new Date(Date.parse(STAMP) - 31 * 24 * 60 * 60 * 1000).toISOString();

  it("deletes for good what is past the retention period, at most once a day", async () => {
    const { trash } = splitTrash(
      items({ notebooks: [notebook("stale", { trashedAt: old }), notebook("fresh", { trashedAt: STAMP })] }),
    );
    const now = Date.parse(STAMP);
    expect(await sweepTrashIfDue(SESSION, { trash, contacts: [], unopened: 0 }, now)).toBe(1);
    expect(flushed[0]!.map((write) => write.id)).toEqual(["stale"]);

    expect(await sweepTrashIfDue(SESSION, { trash, contacts: [], unopened: 0 }, now + 1000)).toBeNull();
    expect(
      await sweepTrashIfDue(SESSION, { trash, contacts: [], unopened: 0 }, now + TRASH_SWEEP_INTERVAL_MS),
    ).toBe(1);
  });

  it("is skipped offline, or while any row could not be opened", async () => {
    const { trash } = splitTrash(items({ notebooks: [notebook("stale", { trashedAt: old })] }));
    const offline = { ...SESSION, offline: true } as Session;
    expect(await sweepTrashIfDue(offline, { trash, contacts: [], unopened: 0 })).toBeNull();
    expect(await sweepTrashIfDue(SESSION, { trash, contacts: [], unopened: 2 })).toBeNull();
    expect(flushed).toEqual([]);
  });
});
