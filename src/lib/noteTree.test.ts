import { describe, expect, it } from "vitest";

import { ancestorsOf, buildNoteTree, canReparent, flattenTree, noteSubtree } from "./noteTree";
import { DEFAULT_NOTEBOOK_ID } from "./note";
import type { Note } from "./types";

const BOOK = DEFAULT_NOTEBOOK_ID;
const OTHER = "11111111-1111-1111-1111-111111111111";

function note(id: string, parentId?: string, notebookId: string = BOOK): Note {
  return {
    id,
    raw: "",
    title: id,
    body: "",
    notebookId,
    parentId,
    pinned: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Ids in draw order, each prefixed by its depth. */
function shape(notes: Note[], notebookId: string = BOOK): string[] {
  return flattenTree(buildNoteTree(notes, notebookId)).map((row) => `${row.depth}:${row.note.id}`);
}

describe("buildNoteTree", () => {
  it("nests a child under its parent", () => {
    expect(shape([note("a"), note("b", "a")])).toEqual(["0:a", "1:b"]);
  });

  it("puts a note with no parent at the top level", () => {
    expect(shape([note("a"), note("b")])).toEqual(["0:a", "0:b"]);
  });

  it("promotes a note whose parent was deleted", () => {
    expect(shape([note("b", "gone")])).toEqual(["0:b"]);
  });

  it("promotes a note that is its own parent", () => {
    expect(shape([note("a", "a")])).toEqual(["0:a"]);
  });

  it("breaks a two-note cycle rather than hiding both", () => {
    const rows = shape([note("a", "b"), note("b", "a")]);
    expect(rows).toHaveLength(2);
    expect(rows).toContain("0:a");
  });

  it("breaks a longer cycle", () => {
    const rows = shape([note("a", "c"), note("b", "a"), note("c", "b")]);
    expect(rows).toHaveLength(3);
  });

  it("keeps a note out of a notebook it does not belong to", () => {
    expect(shape([note("a"), note("b", undefined, OTHER)])).toEqual(["0:a"]);
  });

  it("promotes a child whose parent is in another notebook", () => {
    // The parent moved away; the child must still be reachable where it is.
    expect(shape([note("parent", undefined, OTHER), note("child", "parent")])).toEqual(["0:child"]);
  });

  it("sorts each level on its own", () => {
    const notes = [
      { ...note("a"), updatedAt: "2026-01-01T00:00:00.000Z" },
      { ...note("b"), updatedAt: "2026-06-01T00:00:00.000Z" },
      { ...note("a1", "a"), updatedAt: "2026-02-01T00:00:00.000Z" },
      { ...note("a2", "a"), updatedAt: "2026-03-01T00:00:00.000Z" },
    ];
    expect(shape(notes)).toEqual(["0:b", "0:a", "1:a2", "1:a1"]);
  });

  it("puts a pinned note first at its own level", () => {
    const notes = [note("a"), { ...note("b"), pinned: true }];
    expect(shape(notes)).toEqual(["0:b", "0:a"]);
  });

  it("returns every note exactly once", () => {
    const notes = [note("a"), note("b", "a"), note("c", "b"), note("d"), note("e", "d")];
    expect(shape(notes)).toHaveLength(notes.length);
  });
});

describe("noteSubtree", () => {
  const notes = [note("a"), note("b", "a"), note("c", "b"), note("d"), note("e", "a")];

  it("includes the note itself", () => {
    expect(noteSubtree(notes, "d")).toEqual(["d"]);
  });

  it("includes every descendant", () => {
    expect(noteSubtree(notes, "a").sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("treats a cycle as roots, so neither note is the other's descendant", () => {
    // The link is dropped the same way the tree drops it, which is what keeps a
    // delete of one from taking the other with it.
    expect(noteSubtree([note("a", "b"), note("b", "a")], "a")).toEqual(["a"]);
  });
});

describe("canReparent", () => {
  const notes = [note("a"), note("b", "a"), note("c", "b"), note("d")];

  it("allows a move to the top level", () => {
    expect(canReparent(notes, "b", null)).toBe(true);
  });

  it("allows a move under an unrelated note", () => {
    expect(canReparent(notes, "b", "d")).toBe(true);
  });

  it("refuses a note as its own parent", () => {
    expect(canReparent(notes, "a", "a")).toBe(false);
  });

  it("refuses a move into the note's own subtree", () => {
    expect(canReparent(notes, "a", "c")).toBe(false);
  });

  it("refuses a parent that does not exist", () => {
    expect(canReparent(notes, "a", "gone")).toBe(false);
  });
});

describe("ancestorsOf", () => {
  const notes = [note("a"), note("b", "a"), note("c", "b")];

  it("lists ancestors nearest first", () => {
    expect(ancestorsOf(notes, "c")).toEqual(["b", "a"]);
  });

  it("is empty for a top-level note", () => {
    expect(ancestorsOf(notes, "a")).toEqual([]);
  });

  it("terminates on a cycle", () => {
    expect(ancestorsOf([note("a", "b"), note("b", "a")], "a").length).toBeLessThanOrEqual(2);
  });
});
