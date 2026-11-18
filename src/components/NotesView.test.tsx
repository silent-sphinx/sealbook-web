// @vitest-environment jsdom
/**
 * The notes view, mounted on its own.
 *
 * `App` owns the vault lists and the refresh; this view owns the editor buffer,
 * the autosaver in front of it and the notebook sidebar. What is under test is
 * that boundary: which edits reach `putNote` and when, which ones are not worth
 * a write at all, and that a delete moves a note to the trash with its subtree.
 *
 * `lib/client` is faked rather than driven through a session, as in the suites
 * that mount `App`: every write here would otherwise need an OPAQUE exchange
 * only the server can answer.
 */

import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import { DEFAULT_NOTEBOOK_ID, serializeNote } from "../lib/note";
import { useSidebar } from "./SidebarDrawer";
import type { Session } from "../lib/client";
import type { OutboxState } from "../lib/outbox";
import type { Note, NoteAttachment, NoteDraft, Notebook } from "../lib/types";

/** The faked vault, read back by `onRefresh` as the server's copy would be. */
let notes: Note[] = [];
let notebooks: Notebook[] = [];
let writes: { id: string | undefined; draft: NoteDraft }[] = [];
/** Each id `trashItems` moved to the trash, in order. */
let trashed: string[] = [];
let notebookHideWrites: (boolean | undefined)[] = [];
let notebookWrites: { name: string; id?: string; previousRaw?: string; color?: string }[] = [];
let ensured = 0;
let created = 0;
/** The vault rows the faked client reports, by id. */
let stored = new Map<string, { revision: number; payload: string }>();
/** The `base` each `saveNote` was given, in order. */
let bases: unknown[] = [];
/** When set, what the next `saveNote` reports as stored, as after a merge. */
let mergedPayload: string | null = null;
/** Ids whose trash write is refused, for the paths that have to survive one. */
let untrashable = new Set<string>();
/** How many batched calls the trash write and the child rewrite each made. */
let trashBatches = 0;
let moveBatches = 0;

/** A note and every note under it, by `parentId`, as the trash hides them. */
function subtreeOf(id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const note of notes) {
      if (note.parentId && ids.has(note.parentId) && !ids.has(note.id)) {
        ids.add(note.id);
        grew = true;
      }
    }
  }
  return ids;
}

vi.mock("../lib/trashApi", () => ({
  trashItems: async (_session: unknown, entries: { kind: string; item: { id: string } }[]) => {
    trashBatches += 1;
    if (entries.some((entry) => untrashable.has(entry.item.id))) {
      throw new Error("That would not move to the trash.");
    }
    for (const { kind, item } of entries) {
      trashed.push(item.id);
      if (kind === "notebook") {
        notebooks = notebooks.filter((book) => book.id !== item.id);
        notes = notes.filter((note) => note.notebookId !== item.id);
      } else {
        const gone = subtreeOf(item.id);
        notes = notes.filter((note) => !gone.has(note.id));
      }
    }
  },
}));

vi.mock("../lib/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/client")>("../lib/client");
  return {
    ...actual,
    // The real one goes into the wasm module, which a component suite does not
    // instantiate; only that each write for a new note carries the same id matters.
    newNoteId: () => `note-fresh-${(created += 1)}`,
    ensureDefaultNotebook: async () => {
      ensured += 1;
      notebooks = [{ id: DEFAULT_NOTEBOOK_ID, name: "Default Notebook", raw: "{}" }, ...notebooks];
      return notebooks;
    },
    vaultObject: (id: string) => stored.get(id),
    putNote: async (_session: unknown, draft: NoteDraft, id?: string) => {
      writes.push({ id, draft });
      const at = notes.findIndex((note) => note.id === id);
      const saved: Note = { ...draft, id: id ?? "note-new", raw: serializeNote(draft) };
      if (at === -1) notes = [...notes, saved];
      else notes = notes.map((note) => (note.id === id ? saved : note));
      return saved.id;
    },
    saveNote: async (_session: unknown, draft: NoteDraft, id?: string, base?: unknown) => {
      bases.push(base);
      writes.push({ id, draft });
      const at = notes.findIndex((note) => note.id === id);
      const written = serializeNote(draft);
      const saved: Note = { ...draft, id: id ?? "note-new", raw: written };
      if (at === -1) notes = [...notes, saved];
      else notes = notes.map((note) => (note.id === id ? saved : note));
      const settled = {
        id: saved.id,
        content_type: "",
        revision: (stored.get(saved.id)?.revision ?? 0) + 1,
        tombstone: false,
        payload: mergedPayload ?? written,
      };
      stored.set(saved.id, settled);
      return { id: saved.id, written, settled };
    },
    putNotes: async (_session: unknown, batch: { id: string; draft: NoteDraft }[]) => {
      moveBatches += 1;
      for (const { id, draft } of batch) {
        writes.push({ id, draft });
        notes = notes.map((note) => (note.id === id ? { ...draft, id, raw: serializeNote(draft) } : note));
      }
    },
    putNotebook: async (
      _session: unknown,
      name: string,
      id?: string,
      previousRaw?: string,
      color?: string,
      _archived?: boolean,
      hideFromAll?: boolean,
    ) => {
      notebookHideWrites.push(hideFromAll);
      notebookWrites.push(color ? { name, id, previousRaw, color } : { name, id, previousRaw });
      if (id) notebooks = notebooks.map((book) => (book.id === id ? { ...book, name, color } : book));
      else notebooks = [...notebooks, { id: `notebook-${name}`, name, raw: "{}" }];
      return id ?? `notebook-${name}`;
    },
  };
});

const { NotesView } = await import("./NotesView");

const SESSION = { state: { username: "ada" } } as unknown as Session;

function aNote(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: overrides.id,
    body: "",
    notebookId: DEFAULT_NOTEBOOK_ID,
    raw: "{}",
    ...overrides,
  };
}

function anAttachment(id: string): NoteAttachment {
  return { id, filename: `${id}.png`, mimeType: "image/png", byteSize: 1, adk: "k", contentHash: "h", chunkSize: 1, chunkCount: 1 };
}

const DEFAULT_BOOK: Notebook = {
  id: DEFAULT_NOTEBOOK_ID,
  name: "Default Notebook",
  raw: "{}",
};

/**
 * Stands in for the shell: it holds the vault lists in state, re-reads them on
 * `onRefresh` as `App` does, and applies one saved note on `onSaved`.
 */
function Harness() {
  const [vault, setVault] = useState({ notes, notebooks });
  const sidebar = useSidebar();
  const [outbox, setOutbox] = useState<OutboxState>(IDLE_OUTBOX);
  useEffect(() => {
    syncVault = (next) => setVault((current) => ({ ...current, notes: next }));
    setOutboxState = setOutbox;
  }, []);
  return (
    <NotesView
      session={SESSION}
      notes={vault.notes}
      notebooks={vault.notebooks}
      busy={false}
      outbox={outbox}
      sidebar={sidebar}
      onRefresh={async () => {
        refreshes += 1;
        setVault({ notes, notebooks });
      }}
      onSaved={(note) => {
        setVault((current) => ({
          notebooks: current.notebooks,
          notes: current.notes.some((item) => item.id === note.id)
            ? current.notes.map((item) => (item.id === note.id ? note : item))
            : [...current.notes, note],
        }));
      }}
    />
  );
}

const IDLE_OUTBOX: OutboxState = { pending: 0, queued: [], failed: [], signIn: false };
let setOutboxState: (state: OutboxState) => void = () => {};
let refreshes = 0;
let syncVault: (notes: Note[]) => void = () => {};

function mount(
  seed: { notes?: Note[]; notebooks?: Notebook[] } = {},
) {
  notes = seed.notes ?? [];
  notebooks = seed.notebooks ?? [DEFAULT_BOOK];
  return render(<Harness />);
}

/** The editor's own title field, which is also where an autosave starts. */
function titleField(): HTMLInputElement {
  return screen.getByLabelText("Note title") as HTMLInputElement;
}

/**
 * Opens a note and waits for the editor, which is loaded on first use rather
 * than bundled into the way to the unlock screen, so nothing in it is on the
 * page for a tick or two after the row is clicked.
 */
async function openNote(title: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: title }));
  await screen.findByLabelText("Note title");
}

async function startNote(): Promise<void> {
  fireEvent.click(screen.getAllByRole("button", { name: "New note" })[0]);
  await screen.findByLabelText("Note title");
}

/** The editor's header, where the tree row carries the same labels. */
function editorHeader(): HTMLElement {
  const header = screen.getByRole("navigation", { name: "Breadcrumb" }).closest("header");
  if (!header) throw new Error("the editor is not open");
  return header;
}

beforeEach(() => {
  notes = [];
  notebooks = [];
  writes = [];
  trashed = [];
  notebookWrites = [];
  notebookHideWrites = [];
  untrashable = new Set();
  trashBatches = 0;
  moveBatches = 0;
  ensured = 0;
  created = 0;
  refreshes = 0;
  stored = new Map();
  bases = [];
  mergedPayload = null;
});

afterEach(() => {
  // The autosaver's flush on unmount is a promise, and a write resolving after
  // the test would land in the next one's counters.
  vi.useRealTimers();
});

describe("NotesView, the notebook sidebar", () => {
  const side = () => within(document.querySelector("aside") as HTMLElement);

  it("creates the default notebook on first entry, once", async () => {
    mount({ notebooks: [] });

    await waitFor(() => expect(ensured).toBe(1));
    expect(refreshes).toBe(1);
    await waitFor(() => expect(screen.getAllByText("Default Notebook")[0]).not.toBeNull());
  });

  it("leaves the vault alone when one already exists", async () => {
    mount({ notebooks: [DEFAULT_BOOK] });

    await waitFor(() => expect(screen.getAllByText("Default Notebook")[0]).not.toBeNull());
    expect(ensured).toBe(0);
    expect(refreshes).toBe(0);
  });

  it("counts the notes in each notebook", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [
        aNote({ id: "a" }),
        aNote({ id: "b" }),
        aNote({ id: "c", notebookId: work.id }),
      ],
    });

    const row = screen.getAllByText("Work")[0].closest("div")?.parentElement;
    expect(within(row as HTMLElement).getByText("1")).not.toBeNull();
  });

  it("creates a notebook from the sidebar", async () => {
    mount({ notebooks: [DEFAULT_BOOK] });

    fireEvent.click(screen.getByRole("button", { name: "Add notebook" }));
    const field = screen.getByLabelText("New notebook name");
    fireEvent.change(field, { target: { value: "Work" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() => expect(notebookWrites).toEqual([{ name: "Work", id: undefined, previousRaw: undefined }]));
    await waitFor(() => expect(screen.getAllByText("Work")[0]).not.toBeNull());
  });

  it("renames a notebook with its stored payload, so nothing in it is dropped", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: '{"keep":1}' };
    mount({ notebooks: [DEFAULT_BOOK, work] });

    fireEvent.click(screen.getByRole("button", { name: "Rename Work" }));
    const field = screen.getByLabelText("Rename Work");
    fireEvent.change(field, { target: { value: "Day job" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(notebookWrites).toEqual([
        { name: "Day job", id: work.id, previousRaw: '{"keep":1}' },
      ]),
    );
  });

  it("recolours a notebook from its context menu and keeps the colour through a rename", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    mount({ notebooks: [DEFAULT_BOOK, work] });

    fireEvent.contextMenu(side().getByRole("button", { name: /^Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Notebook colour" })).getByRole("button", { name: "Deep teal" }));
    await waitFor(() =>
      expect(notebookWrites).toEqual([{ name: "Work", id: work.id, previousRaw: "{}", color: "#4fae9f" }]),
    );
    await waitFor(() =>
      expect(
        (side().getByRole("button", { name: /^Work/ }).querySelector("span") as HTMLElement).style.color,
      ).toBe("rgb(79, 174, 159)"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename Work" }));
    const field = screen.getByLabelText("Rename Work");
    fireEvent.change(field, { target: { value: "Day job" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() => expect(notebookWrites[1]).toMatchObject({ name: "Day job", color: "#4fae9f" }));
  });

  it("offers no subnotebooks, since notebooks do not nest", () => {
    mount({ notebooks: [DEFAULT_BOOK] });
    fireEvent.contextMenu(side().getByRole("button", { name: /^Default Notebook/ }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toEqual(["Rename notebook", "Change colour", "Hide from overview"]);
  });

  it("moves a notebook to the trash, its notes with it", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [aNote({ id: "a", notebookId: work.id }), aNote({ id: "b" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    const dialog = screen.getByRole("dialog", { name: "Move to trash" });
    expect(dialog.textContent).toContain("its 1 note");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));

    await waitFor(() => expect(trashed).toEqual([work.id]));
    expect(trashBatches).toBe(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete Work" })).toBeNull());
    expect(notes.map((note) => note.id)).toEqual(["b"]);
  });

  it("keeps a notebook whose trash write was refused", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    untrashable = new Set([work.id]);
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [aNote({ id: "a", notebookId: work.id })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Move to trash" })).getByRole("button", {
        name: "Move to trash",
      }),
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(trashed).toEqual([]);
    expect(screen.getByRole("button", { name: "Delete Work" })).not.toBeNull();
  });
});

describe("NotesView, finding a note", () => {
  it("shows notebooks and the most recently modified notes when no note is open", () => {
    mount({
      notebooks: [{ id: "work", name: "Work", raw: "{}" }],
      notes: [
        aNote({ id: "old", title: "Older", updatedAt: "2026-01-01T00:00:00Z" }),
        aNote({ id: "new", title: "Newer", updatedAt: "2026-06-01T00:00:00Z" }),
      ],
    });

    expect(screen.getByRole("button", { name: "Work, 0 notes" })).not.toBeNull();
    const recent = screen.getByRole("heading", { name: "Recently modified" }).parentElement as HTMLElement;
    const titles = within(recent)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("role") !== "checkbox")
      .map((button) => button.textContent);
    expect(titles[0]).toContain("Newer");
    expect(titles[1]).toContain("Older");
  });

  it("opens a notebook's pages in the main pane, and goes back to all notebooks", () => {
    mount({
      notebooks: [{ id: "work", name: "Work", raw: "{}" }],
      notes: [
        aNote({ id: "a", title: "Standup", notebookId: "work" }),
        aNote({ id: "b", title: "Elsewhere" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Work, 1 note" }));
    const back = screen.getByRole("button", { name: "All notebooks" });
    const pane = back.closest("section") as HTMLElement;
    expect(within(pane).getByText("Standup")).not.toBeNull();
    expect(within(pane).queryByText("Elsewhere")).toBeNull();

    fireEvent.click(back);
    expect(screen.getByRole("heading", { name: "Recently modified" })).not.toBeNull();
  });

  it("returns to the notes home when the sidebar title is clicked", async () => {
    mount({
      notebooks: [{ id: "work", name: "Work", raw: "{}" }],
      notes: [aNote({ id: "a", title: "Standup", notebookId: "work" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Work, 1 note" }));
    expect(screen.getByRole("button", { name: "All notebooks" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "All notebooks" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Recently modified" })).not.toBeNull();
  });

  it("lists the selected notebook's notes as a tree", () => {
    mount({
      notes: [aNote({ id: "parent", title: "Parent" }), aNote({ id: "child", title: "Child", parentId: "parent" })],
    });

    expect(screen.getByRole("button", { name: "Parent" })).not.toBeNull();
    // The child is behind its parent's collapsed row until that is expanded.
    expect(screen.queryByRole("button", { name: "Child" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Parent" }));
    expect(screen.getByRole("button", { name: "Child" })).not.toBeNull();
  });

  it("puts search in the pane header, not the sidebar", () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });
    const sidebar = document.querySelector("aside") as HTMLElement;
    expect(within(sidebar).queryByLabelText("Search notes")).toBeNull();
    const header = screen.getByRole("heading", { name: "All notes" }).closest("header") as HTMLElement;
    expect(within(header).getByLabelText("Search notes")).not.toBeNull();
  });

  it("searches every notebook from the overview, naming the one a hit is in", async () => {
    mount({
      notebooks: [DEFAULT_BOOK, { id: "work", name: "Work", raw: "{}" }],
      notes: [
        aNote({ id: "w", title: "Standup", notebookId: "work", body: "hinges" }),
        aNote({ id: "x", title: "Recipes" }),
      ],
    });

    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "hinges" } });

    const pane = (await screen.findByRole("heading", { name: "Results" })).closest("section") as HTMLElement;
    expect(within(pane).getByText("Standup")).not.toBeNull();
    expect(within(pane).getByText("Work")).not.toBeNull();
    expect(within(pane).queryByText("Recipes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("heading", { name: "Recently modified" })).not.toBeNull();
  });

  it("filters a notebook's pages from its own header", async () => {
    mount({
      notes: [
        aNote({ id: "a", title: "Alpha", body: "hinges" }),
        aNote({ id: "b", title: "Beta" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Default Notebook, \d+ notes?$/ }));
    const pane = within(document.querySelector("section") as HTMLElement);
    fireEvent.change(pane.getByLabelText("Search notes"), { target: { value: "hinges" } });
    await waitFor(() => expect(pane.queryByText("Beta")).toBeNull());
    expect(pane.getByText("Alpha")).not.toBeNull();
  });

  it("names the search that matched nothing", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });

    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "hinges" } });

    await waitFor(() =>
      expect(screen.getByText("No note matches “hinges”.")).not.toBeNull(),
    );
  });

  it("says a notebook is empty rather than showing a bare heading", () => {
    mount({ notes: [] });

    expect(screen.getByText("No notes here yet.")).not.toBeNull();
  });
});

describe("NotesView, the editor", () => {
  it("opens an ancestor from its breadcrumb", async () => {
    mount({
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand Shopping" }));
    fireEvent.click(screen.getByRole("button", { name: "Hardware" }));
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });

    fireEvent.click(within(crumbs).getByRole("button", { name: "Shopping" }));

    await waitFor(() =>
      expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).queryByRole("button")).toBeNull(),
    );
  });

  it("opens a note into the editor", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping", body: "Bread" })] });

    await openNote("Shopping");

    expect(titleField().value).toBe("Shopping");
    expect((await screen.findByLabelText("Note body")).textContent).toBe("Bread");
  });

  it("shows a nested note's ancestors above it", async () => {
    mount({
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand Shopping" }));
    await openNote("Hardware");

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toContain("Shopping");
    expect(crumbs.textContent).toContain("Hardware");
  });

  it("autosaves a title onto the stored payload", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping", body: "Bread", raw: '{"keep":1}' })] });
    await openNote("Shopping");

    fireEvent.change(titleField(), { target: { value: "Shopping list" } });
    expect(screen.getByText("Saving...")).not.toBeNull();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.id).toBe("a");
    expect(writes[0]!.draft.title).toBe("Shopping list");
    // The payload goes back in so a field this build does not know about, and
    // the note's attachments, survive the edit.
    expect(writes[0]!.draft.raw).toBe('{"keep":1}');
    await waitFor(() => expect(screen.getByText("Saved")).not.toBeNull());
  });

  /** Another device's edit to a note, as a sync delivers it. */
  function remoteEdit(note: Note, patch: Partial<NoteDraft>): Note {
    const next = { ...note, ...patch };
    const edited = { ...next, raw: serializeNote(next) };
    stored.set(note.id, { revision: 2, payload: edited.raw });
    return edited;
  }

  it("saves an edit against the version the editor opened on, not a newer synced one", async () => {
    const note = aNote({ id: "a", title: "Shopping", body: "Bread", raw: serializeNote(aNote({ id: "a", title: "Shopping", body: "Bread" })) });
    stored.set("a", { revision: 1, payload: note.raw });
    mount({ notes: [note] });
    await openNote("Shopping");

    fireEvent.change(titleField(), { target: { value: "Shopping list" } });
    act(() => syncVault([remoteEdit(note, { body: "Bread and milk" })]));
    await waitFor(() => expect(writes).toHaveLength(1));

    expect(bases[0]).toMatchObject({ revision: 1 });
    expect(titleField().value).toBe("Shopping list");
  });

  it("takes another device's edit into a draft with nothing unsaved", async () => {
    const note = aNote({ id: "a", title: "Shopping", body: "Bread", raw: serializeNote(aNote({ id: "a", title: "Shopping", body: "Bread" })) });
    stored.set("a", { revision: 1, payload: note.raw });
    mount({ notes: [note] });
    await openNote("Shopping");

    act(() => syncVault([remoteEdit(note, { title: "Groceries" })]));

    await waitFor(() => expect(titleField().value).toBe("Groceries"));
    fireEvent.change(titleField(), { target: { value: "Groceries 2" } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(bases[0]).toMatchObject({ revision: 2 });
  });

  it("shows the merged note once a save was merged with another device's edit", async () => {
    const note = aNote({ id: "a", title: "Shopping", body: "Bread", raw: serializeNote(aNote({ id: "a", title: "Shopping", body: "Bread" })) });
    stored.set("a", { revision: 1, payload: note.raw });
    mount({ notes: [note] });
    await openNote("Shopping");
    mergedPayload = serializeNote({ title: "Merged", body: "Bread", notebookId: DEFAULT_NOTEBOOK_ID });

    fireEvent.change(titleField(), { target: { value: "Shopping list" } });

    await waitFor(() => expect(titleField().value).toBe("Merged"));
  });

  it("writes once for a run of keystrokes", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });
    await openNote("Shopping");

    for (const value of ["S", "Sh", "Sho", "Shop"]) {
      fireEvent.change(titleField(), { target: { value } });
    }

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.title).toBe("Shop");
  });

  it("does not store a new note nothing was typed into", async () => {
    mount({ notes: [] });

    await startNote();
    expect(titleField().value).toBe("");
    fireEvent.change(titleField(), { target: { value: "x" } });
    fireEvent.change(titleField(), { target: { value: "" } });

    // Closed rather than waited out, so the queued write is forced to run and
    // its own guard is what skips it.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.getByText("Select a note to read or edit it.")).not.toBeNull(),
    );
    expect(writes).toEqual([]);
  });

  it("writes nothing for a note that was only read", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping", body: "Bread" })] });

    await openNote("Shopping");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.getByText("Select a note to read or edit it.")).not.toBeNull(),
    );
    expect(writes).toEqual([]);
    expect(screen.queryByText("Saving...")).toBeNull();
  });

  it("stores a new note as an update, so every write for it is the same object", async () => {
    mount({ notes: [] });

    await startNote();
    fireEvent.change(titleField(), { target: { value: "Fresh" } });
    await waitFor(() => expect(writes).toHaveLength(1));

    fireEvent.change(titleField(), { target: { value: "Fresher" } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.id).toBe(writes[0]!.id);
    expect(writes[0]!.id).not.toBeUndefined();
  });

  it("refuses a note too large for one vault object", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });
    await openNote("Shopping");

    fireEvent.change(titleField(), { target: { value: "x".repeat(9 * 1024 * 1024) } });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "This note is too large to store. One note can hold about 8 MB.",
      ),
    );
    expect(writes).toEqual([]);
    expect(screen.getByText("Not saved")).not.toBeNull();
  });

  it("refetches the vault once when the editor is closed, not once per keystroke", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });
    await openNote("Shopping");

    fireEvent.change(titleField(), { target: { value: "Shopping list" } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(refreshes).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(refreshes).toBe(1));
  });

  it("does not refetch on closing an editing session that wrote nothing", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });
    await openNote("Shopping");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.getByText("Select a note to read or edit it.")).not.toBeNull());
    expect(refreshes).toBe(0);
    expect(writes).toEqual([]);
  });

  it("writes an edit left behind when another note is opened", async () => {
    mount({
      notes: [aNote({ id: "a", title: "Shopping" }), aNote({ id: "b", title: "Recipes" })],
    });
    await openNote("Shopping");
    fireEvent.change(titleField(), { target: { value: "Shopping list" } });

    // Opened straight away, inside the debounce, so the queued write would be
    // lost if opening cancelled it rather than flushing it.
    await openNote("Recipes");

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.title).toBe("Shopping list");
    expect(titleField().value).toBe("Recipes");
  });

  it("says a note is only saved on this device while its write is queued", async () => {
    mount({ notes: [aNote({ id: "a", title: "Trip" })] });
    await openNote("Trip");
    fireEvent.change(titleField(), { target: { value: "Trips" } });
    await screen.findByText("Saved");

    act(() => setOutboxState({ ...IDLE_OUTBOX, pending: 1, queued: ["a"] }));
    expect(screen.getByText("Saved on this device")).toBeTruthy();

    act(() => setOutboxState(IDLE_OUTBOX));
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("ignores a queued write for another note", async () => {
    mount({ notes: [aNote({ id: "a", title: "Trip" })] });
    await openNote("Trip");
    act(() => setOutboxState({ ...IDLE_OUTBOX, pending: 1, queued: ["b"] }));
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("shows the refusal when the outbox moved this note's write to failed", async () => {
    mount({ notes: [aNote({ id: "a", title: "Trip" })] });
    await openNote("Trip");
    const write = { id: "a", content_type: "", tombstone: false, payload: "{}", queued_at: "" };
    act(() => setOutboxState({ ...IDLE_OUTBOX, failed: [{ write, reason: "the server refused it" }] }));
    expect(screen.getByText("Not saved: the server refused it")).toBeTruthy();
  });

  it("drops a photo entry the body no longer shows when the editor is closed", async () => {
    mount({
      notes: [
        aNote({
          id: "a",
          title: "Trip",
          body: "![kept](attachment:keep)",
          attachments: [anAttachment("keep"), anAttachment("gone")],
        }),
      ],
    });
    await openNote("Trip");
    fireEvent.click(screen.getAllByRole("button", { name: "Back to notes" })[0]!);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.attachments?.map((entry) => entry.id)).toEqual(["keep"]);
  });

  it("keeps every entry the body shows, writing nothing on close", async () => {
    mount({
      notes: [
        aNote({
          id: "a",
          title: "Trip",
          body: "![kept](attachment:keep)",
          attachments: [anAttachment("keep")],
        }),
      ],
    });
    await openNote("Trip");
    fireEvent.click(screen.getAllByRole("button", { name: "Back to notes" })[0]!);
    await waitFor(() => expect(screen.queryByLabelText("Note title")).toBeNull());
    expect(writes).toHaveLength(0);
  });

  it("drops the entry when the note is left for another", async () => {
    mount({
      notes: [
        aNote({ id: "a", title: "Trip", body: "", attachments: [anAttachment("gone")] }),
        aNote({ id: "b", title: "Recipes" }),
      ],
    });
    await openNote("Trip");
    await openNote("Recipes");

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.attachments).toEqual([]);
  });

  it("counts the words in the body", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping", body: "bread and butter" })] });

    await openNote("Shopping");

    await waitFor(() => expect(screen.getByText("3 words")).not.toBeNull());
  });
});

describe("NotesView, moving notes about", () => {
  it("carries a note's descendants into the notebook it is moved to", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent" }),
      ],
    });
    await openNote("Shopping");

    fireEvent.change(screen.getByLabelText("Notebook"), { target: { value: work.id } });

    // The child is written straight away; the note itself rides the autosaver.
    await waitFor(() => expect(writes.some((write) => write.id === "child")).toBe(true));
    expect(writes.find((write) => write.id === "child")!.draft.notebookId).toBe(work.id);
    expect(moveBatches).toBe(1);
    await waitFor(() => expect(writes.some((write) => write.id === "parent")).toBe(true));
    expect(writes.find((write) => write.id === "parent")!.draft.notebookId).toBe(work.id);
  });

  it("refuses to move a note inside its own subtree", async () => {
    mount({
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent" }),
      ],
    });

    // Driven through the handler's own rule rather than a drag, which
    // `NoteTreeDrag.test.tsx` covers: the rows never offer this drop.
    fireEvent.click(screen.getByRole("button", { name: "Expand Shopping" }));
    expect(screen.getByRole("button", { name: "Hardware" })).not.toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("NotesView, deleting notes", () => {
  it("moves a note to the trash with everything under it, in one write", async () => {
    mount({
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent" }),
        aNote({ id: "other", title: "Recipes" }),
      ],
    });

    await openNote("Shopping");
    fireEvent.click(within(editorHeader()).getByRole("button", { name: "Delete Shopping" }));
    const dialog = screen.getByRole("dialog", { name: "Move to trash" });
    expect(dialog.textContent).toContain("the 1 note inside it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));

    await waitFor(() => expect(trashed).toEqual(["parent"]));
    expect(trashBatches).toBe(1);
    expect(notes.map((note) => note.id)).toEqual(["other"]);
  });

  it("closes the editor when the note it was on is moved to the trash", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });

    await openNote("Shopping");
    fireEvent.click(within(editorHeader()).getByRole("button", { name: "Delete Shopping" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Move to trash" })).getByRole("button", {
        name: "Move to trash",
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("Select a note to read or edit it.")).not.toBeNull(),
    );
  });

  it("keeps the dialog's wording singular for a note with nothing under it", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });

    await openNote("Shopping");
    fireEvent.click(within(editorHeader()).getByRole("button", { name: "Delete Shopping" }));

    const dialog = screen.getByRole("dialog", { name: "Move to trash" });
    expect(dialog.textContent).toContain("It can be restored from the trash for 30 days.");
    expect(dialog.textContent).not.toContain("inside it");
  });
});

describe("NotesView, exporting one note", () => {
  it("downloads the body as markdown under a safe file name", async () => {
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const downloads: string[] = [];
    URL.createObjectURL = (() => "blob:note") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function mockClick(this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
    try {
      mount({ notes: [aNote({ id: "a", title: "Shopping / list?", body: "Bread" })] });

      await openNote("Shopping / list?");
      fireEvent.click(screen.getByRole("button", { name: "Export as Markdown" }));

      expect(downloads).toEqual(["Shopping  list.md"]);
    } finally {
      click.mockRestore();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });
});

describe("NotesView, bulk editing", () => {
  const pane = () => within(document.querySelector("section") as HTMLElement);
  const pick = (title: string) => fireEvent.click(pane().getByRole("checkbox", { name: `Select ${title}` }));
  const bar = () => pane().getByRole("toolbar", { name: "Bulk edit notes" });
  const three = () => [
    aNote({ id: "a", title: "Alpha" }),
    aNote({ id: "b", title: "Beta" }),
    aNote({ id: "c", title: "Gamma" }),
  ];

  it("never offers selection in the sidebar", () => {
    mount({ notes: three() });
    const aside = within(document.querySelector("aside") as HTMLElement);
    expect(aside.queryByRole("checkbox")).toBeNull();
    expect(aside.queryByRole("button", { name: /^Select / })).toBeNull();
  });

  it("selects notes in the overview, shows the bar and clears on Escape", () => {
    mount({ notes: three() });
    expect(pane().queryByRole("toolbar", { name: "Bulk edit notes" })).toBeNull();
    pick("Alpha");
    pick("Beta");
    expect(within(bar()).getByText("2 selected")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(pane().queryByRole("toolbar", { name: "Bulk edit notes" })).toBeNull();
  });

  it("extends with shift and selects all from the keyboard", () => {
    mount({ notes: three() });
    pick("Alpha");
    fireEvent.click(pane().getByRole("checkbox", { name: "Select Gamma" }), { shiftKey: true });
    expect(within(bar()).getByText("3 selected")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(within(bar()).getByText("3 selected")).not.toBeNull();
  });

  it("starts on ctrl-click without opening the note", () => {
    mount({ notes: three() });
    fireEvent.click(pane().getByRole("button", { name: /Alpha/ }), { ctrlKey: true });
    expect(within(bar()).getByText("1 selected")).not.toBeNull();
    expect(screen.queryByLabelText("Note title")).toBeNull();
  });

  it("selects pages in a notebook and moves them, with what is inside, to another", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [...three(), aNote({ id: "a1", title: "Inner", parentId: "a" })],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Default Notebook, \d+ notes?$/ }));
    pick("Alpha");
    pick("Beta");
    fireEvent.change(within(bar()).getByLabelText("Move selected notes to"), {
      target: { value: work.id },
    });
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes.map((write) => write.id).sort()).toEqual(["a", "a1", "b"]);
    expect(writes.every((write) => write.draft.notebookId === work.id)).toBe(true);
    expect(moveBatches).toBe(1);
    await waitFor(() => expect(pane().queryByRole("toolbar", { name: "Bulk edit notes" })).toBeNull());
  });

  it("asks before moving to the trash, writing only the picked notes", async () => {
    mount({ notes: [...three(), aNote({ id: "a1", title: "Inner", parentId: "a" })] });
    fireEvent.click(screen.getByRole("button", { name: /^Default Notebook, \d+ notes?$/ }));
    pick("Alpha");
    pick("Beta");
    fireEvent.click(within(bar()).getByRole("button", { name: "Delete" }));
    expect(trashed).toEqual([]);
    const dialog = screen.getByRole("dialog", { name: "Move to trash" });
    expect(dialog.textContent).toContain("Move 2 notes to the trash?");
    expect(dialog.textContent).toContain("the 1 note inside them");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect([...trashed].sort()).toEqual(["a", "b"]));
    expect(trashBatches).toBe(1);
    expect(notes.map((note) => note.id)).not.toContain("a1");
  });
});

describe("NotesView, leaving a note for its notebook", () => {
  it("shows the notebook's pages when its row is clicked with a note open", async () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha" }), aNote({ id: "b", title: "Beta" })] });
    await openNote("Alpha");
    const aside = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(aside.getByRole("button", { name: /^Default Notebook/ }));
    await waitFor(() => expect(screen.queryByLabelText("Note title")).toBeNull());
    expect(screen.getByRole("button", { name: "All notebooks" })).not.toBeNull();
    const pane = (screen.getByRole("button", { name: "All notebooks" }).closest("section")) as HTMLElement;
    expect(within(pane).getByText("Beta")).not.toBeNull();
  });
});

describe("NotesView, the notebook page views", () => {
  const openBook = () => fireEvent.click(screen.getByRole("button", { name: /^Default Notebook, \d+ notes?$/ }));
  const pane = () => within(document.querySelector("section") as HTMLElement);

  afterEach(() => localStorage.clear());

  it("shows pages as a grid, and as a table that opens and selects the same way", () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha", body: "first" }), aNote({ id: "b", title: "Beta" })] });
    openBook();
    expect(pane().queryByRole("table")).toBeNull();
    expect(pane().getByRole("radio", { name: "Grid" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(pane().getByRole("radio", { name: "Table" }));
    const table = pane().getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("first")).not.toBeNull();

    fireEvent.click(within(table).getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.click(within(table).getByRole("checkbox", { name: "Select Beta" }));
    expect(within(pane().getByRole("toolbar", { name: "Bulk edit notes" })).getByText("2 selected")).not.toBeNull();
  });

  it("opens a note from its table row, and remembers the view", async () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha" })] });
    openBook();
    fireEvent.click(pane().getByRole("radio", { name: "Table" }));
    expect(localStorage.getItem("sealbook.notes.pages-view")).toBe("table");
    fireEvent.click(within(pane().getByRole("table")).getByRole("button", { name: "Alpha" }));
    await screen.findByLabelText("Note title");
  });
});

describe("NotesView, right-clicking a note in the main pane", () => {
  const pane = () => within(document.querySelector("section") as HTMLElement);

  it("renames a note from the overview and keeps its body", async () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha", body: "keep me" })] });
    fireEvent.contextMenu(pane().getByRole("button", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename note" }));
    const dialog = screen.getByRole("dialog", { name: "Rename note" });
    fireEvent.change(within(dialog).getByLabelText("Note name"), { target: { value: "Omega" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: "a", draft: { title: "Omega", body: "keep me" } });
    await waitFor(() => expect(pane().getByText("Omega")).not.toBeNull());
  });

  it("moves a note to the trash from a notebook's table row, after confirming", async () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha" }), aNote({ id: "b", title: "Beta" })] });
    fireEvent.click(screen.getByRole("button", { name: /^Default Notebook, \d+ notes?$/ }));
    fireEvent.click(pane().getByRole("radio", { name: "Table" }));
    fireEvent.contextMenu(within(pane().getByRole("table")).getByRole("button", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete note" }));
    expect(trashed).toEqual([]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Move to trash" })).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(trashed).toEqual(["a"]));
    localStorage.clear();
  });

  it("offers the bulk menu on a note inside a selection", () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha" }), aNote({ id: "b", title: "Beta" })] });
    fireEvent.click(pane().getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.click(pane().getByRole("checkbox", { name: "Select Beta" }));
    fireEvent.contextMenu(pane().getByRole("button", { name: /Alpha/ }));
    expect(screen.getByRole("menuitem", { name: "Delete 2 notes" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Rename note" })).toBeNull();
  });
});

describe("NotesView, right-clicking a notebook cover", () => {
  it("offers open and rename, and no delete for the default notebook", () => {
    mount({ notes: [aNote({ id: "a", title: "Alpha" })] });
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Default Notebook, \d+ notes?$/ }));
    expect(screen.getByRole("menuitem", { name: "Open notebook" })).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename notebook" }));
    expect(screen.getByRole("dialog", { name: "Rename notebook" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete notebook" })).toBeNull();
  });
});

describe("NotesView, hiding a notebook", () => {
  const side = () => within(document.querySelector("aside") as HTMLElement);
  const secret: Notebook = { id: "secret", name: "Secret", hideFromAll: true, raw: "{}" };
  const seed = () => ({
    notebooks: [DEFAULT_BOOK, secret],
    notes: [
      aNote({ id: "open", title: "Open note" }),
      aNote({ id: "hush", title: "Hush note", notebookId: "secret" }),
    ],
  });

  it("leaves a hidden notebook's cover and notes out of the overview, but not out of the sidebar", () => {
    mount(seed());
    expect(screen.queryByRole("button", { name: /^Secret, / })).toBeNull();
    const recent = screen.getByRole("heading", { name: "Recently modified" }).parentElement as HTMLElement;
    expect(within(recent).queryByText("Hush note")).toBeNull();
    expect(within(recent).getByText("Open note")).not.toBeNull();
    expect(side().getByRole("button", { name: /^Secret/ })).not.toBeNull();
  });

  it("still finds a hidden notebook's notes by search", () => {
    mount(seed());
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "hush" } });
    expect(screen.getByText("Hush note")).not.toBeNull();
  });

  it("writes the flag from the notebook's menu", async () => {
    mount(seed());
    fireEvent.contextMenu(side().getByRole("button", { name: /^Secret/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in overview" }));
    await waitFor(() => expect(notebookHideWrites).toEqual([false]));
  });
});
