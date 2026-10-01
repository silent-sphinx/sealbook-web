import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTEBOOK_ID,
  DEFAULT_NOTEBOOK_NAME,
  emptyNoteDraft,
  noteMatches,
  notePreview,
  notebookNameById,
  parseNote,
  parseNotebook,
  resolveNotebookId,
  serializeNote,
  serializeNotebook,
  sortNotebooks,
  sortNotes,
} from "./note";
import type { Note } from "./types";

const note = (over: Partial<Note>): Note => ({
  id: "n",
  raw: "",
  title: "t",
  body: "",
  notebookId: DEFAULT_NOTEBOOK_ID,
  ...over,
});

describe("note serialization", () => {
  it("round trips a draft through the stored payload", () => {
    const draft = {
      title: "  Weekly plan  ",
      body: "# Monday\n\n- ship notes\n",
      notebookId: "11111111-1111-1111-1111-111111111111",
      pinned: true,
      createdAt: "2026-01-02T03:04:05.000Z",
    };
    const parsed = parseNote("id-1", serializeNote(draft));
    expect(parsed.title).toBe("Weekly plan");
    expect(parsed.body).toBe(draft.body);
    expect(parsed.notebookId).toBe(draft.notebookId);
    expect(parsed.pinned).toBe(true);
    expect(parsed.createdAt).toBe(draft.createdAt);
    expect(parsed.updatedAt).toBeDefined();
  });

  it("keeps the original creation time and moves the edit time", () => {
    const first = serializeNote(emptyNoteDraft(DEFAULT_NOTEBOOK_ID));
    const created = parseNote("id", first).createdAt;
    const again = parseNote("id", serializeNote({ ...parseNote("id", first), body: "edited" }));
    expect(again.createdAt).toBe(created);
  });

  it("reads a payload the CLI wrote without timestamps", () => {
    const parsed = parseNote(
      "id",
      JSON.stringify({ "@type": "Note", title: "From the CLI", body: "hi" }),
    );
    expect(parsed.createdAt).toBeUndefined();
    expect(parsed.updatedAt).toBeUndefined();
    expect(parsed.notebookId).toBe(DEFAULT_NOTEBOOK_ID);
    expect(parsed.pinned).toBe(false);
  });

  it("falls back rather than throwing on a payload that will not parse", () => {
    const parsed = parseNote("id", "not json at all");
    expect(parsed.title).toBe("Unreadable note");
    expect(parsed.body).toBe("not json at all");
  });

  it("names an untitled note rather than leaving it blank", () => {
    expect(parseNote("id", JSON.stringify({ title: "   " })).title).toBe("Untitled note");
  });
});

describe("notebooks", () => {
  it("round trips a notebook", () => {
    expect(parseNotebook("b", serializeNotebook("  Work  "))).toMatchObject({
      id: "b",
      name: "Work",
    });
  });

  it("matches the id reserved in the Rust protocol crate", () => {
    expect(DEFAULT_NOTEBOOK_ID).toBe("00000000-0000-0000-0000-000000000002");
  });

  it("resolves a missing or blank notebook to the default", () => {
    expect(resolveNotebookId(undefined)).toBe(DEFAULT_NOTEBOOK_ID);
    expect(resolveNotebookId("   ")).toBe(DEFAULT_NOTEBOOK_ID);
    expect(resolveNotebookId("abc")).toBe("abc");
  });

  it("sorts the default first, then by name regardless of case", () => {
    const books = [
      { id: "b", name: "beta", raw: "" },
      { id: "a", name: "Alpha", raw: "" },
      { id: DEFAULT_NOTEBOOK_ID, name: "Default Notebook", raw: "" },
    ];
    expect(sortNotebooks(books).map((book) => book.name)).toEqual([
      "Default Notebook",
      "Alpha",
      "beta",
    ]);
  });

  it("names an unknown notebook as the default", () => {
    expect(notebookNameById([], "missing")).toBe(DEFAULT_NOTEBOOK_NAME);
  });
});

describe("sortNotes", () => {
  it("puts pinned notes first, then most recently edited, then title", () => {
    const sorted = sortNotes([
      note({ id: "old", title: "old", updatedAt: "2026-01-01T00:00:00Z" }),
      note({ id: "pin", title: "pinned", pinned: true, updatedAt: "2020-01-01T00:00:00Z" }),
      note({ id: "new", title: "new", updatedAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["pin", "new", "old"]);
  });

  it("tolerates a missing or unparseable timestamp", () => {
    const sorted = sortNotes([
      note({ id: "none", title: "b" }),
      note({ id: "bad", title: "a", updatedAt: "not a date" }),
      note({ id: "good", title: "c", updatedAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(sorted[0].id).toBe("good");
    expect(sorted.slice(1).map((entry) => entry.id)).toEqual(["bad", "none"]);
  });

  it("falls back to createdAt when there is no edit time", () => {
    const sorted = sortNotes([
      note({ id: "a", title: "a", createdAt: "2020-01-01T00:00:00Z" }),
      note({ id: "b", title: "b", createdAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("notePreview", () => {
  it("strips markers and collapses whitespace", () => {
    expect(notePreview("# Title\n\n- **one**\n- two")).toBe("Title one two");
  });

  it("truncates on a word boundary", () => {
    const preview = notePreview("alpha bravo charlie delta echo", 18);
    expect(preview).toBe("alpha bravo...");
  });

  it("costs the same for a long body as a short one", () => {
    const started = Date.now();
    expect(notePreview(`word `.repeat(400_000)).length).toBeLessThanOrEqual(143);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("noteMatches", () => {
  it("matches an empty query, a title and a body", () => {
    const subject = note({ title: "Weekly plan", body: "buy an okapi" });
    expect(noteMatches(subject, "  ")).toBe(true);
    expect(noteMatches(subject, "WEEKLY")).toBe(true);
    expect(noteMatches(subject, "okapi")).toBe(true);
    expect(noteMatches(subject, "quetzal")).toBe(false);
  });
});
