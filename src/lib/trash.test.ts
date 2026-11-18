import { describe, expect, it } from "vitest";
import { findTrashItem, splitTrash, trashItemTitle, trashNodes, type TrashableItems } from "./trash";
import { coreTrashRoots } from "./wasm";
import type { Note, Notebook } from "./types";

const STAMP = "2026-11-01T00:00:00Z";

function items(overrides: Partial<TrashableItems> = {}): TrashableItems {
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

const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id,
  title: id,
  body: "",
  notebookId: "book",
  raw: "{}",
  ...extra,
});
const book = (id: string, extra: Partial<Notebook> = {}): Notebook => ({ id, name: id, raw: "{}", ...extra });

describe("splitTrash", () => {
  it("hands back the listing untouched when nothing is trashed", () => {
    const listing = items({ notes: [note("a")], notebooks: [book("book")] });
    const { live, trash } = splitTrash(listing);
    expect(live).toBe(listing);
    expect(trash.notes).toEqual([]);
    expect(trash.nodes).toHaveLength(2);
  });

  it("moves a trashed notebook, and every note filed in it, out of the live lists", () => {
    const { live, trash } = splitTrash(
      items({
        notebooks: [book("book", { trashedAt: STAMP }), book("other")],
        notes: [note("a"), note("b", { parentId: "a" }), note("c", { notebookId: "other" })],
      }),
    );
    expect(live.notebooks.map((each) => each.id)).toEqual(["other"]);
    expect(live.notes.map((each) => each.id)).toEqual(["c"]);
    expect(trash.notebooks.map((each) => each.id)).toEqual(["book"]);
    expect(trash.notes.map((each) => each.id)).toEqual(["a", "b"]);
  });

  it("hides the notes under a trashed note, leaving its notebook", () => {
    const { live, trash } = splitTrash(
      items({
        notebooks: [book("book")],
        notes: [note("a", { trashedAt: STAMP }), note("b", { parentId: "a" }), note("c")],
      }),
    );
    expect(live.notes.map((each) => each.id)).toEqual(["c"]);
    expect(trash.notes.map((each) => each.id)).toEqual(["a", "b"]);
    expect(live.notebooks).toHaveLength(1);
  });

  it("lists only the outermost trashed item, with what it took", () => {
    const { trash } = splitTrash(
      items({
        notebooks: [book("book", { trashedAt: STAMP })],
        notes: [note("a"), note("b", { trashedAt: STAMP })],
      }),
    );
    const roots = coreTrashRoots(trash.nodes, Date.parse(STAMP));
    expect(roots.map((root) => [root.id, root.contained])).toEqual([["book", 2]]);
  });
});

describe("trashNodes", () => {
  it("names a contact's book and a task's list as their containers", () => {
    const nodes = trashNodes(
      items({
        contacts: [{ id: "c", name: "Ada", addressBookId: "ab" } as TrashableItems["contacts"][number]],
        tasks: [{ id: "t", title: "x", taskListId: "l", parentId: "p", raw: "{}" } as TrashableItems["tasks"][number]],
      }),
    );
    expect(nodes).toEqual([
      { id: "c", kind: "contact", container_id: "ab", parent_id: undefined, trashed_at: undefined },
      { id: "t", kind: "task", container_id: "l", parent_id: "p", trashed_at: undefined },
    ]);
  });
});

describe("findTrashItem", () => {
  it("finds an item by id with its kind and title", () => {
    const { trash } = splitTrash(items({ notebooks: [book("book", { name: "Work", trashedAt: STAMP })] }));
    const found = findTrashItem(trash, "book");
    expect(found?.kind).toBe("notebook");
    expect(found && trashItemTitle(found)).toBe("Work");
    expect(findTrashItem(trash, "missing")).toBeUndefined();
  });
});
