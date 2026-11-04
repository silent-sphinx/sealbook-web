// @vitest-environment jsdom
/**
 * The notes view, mounted on its own.
 *
 * `App` owns the vault lists and the refresh; this view owns the editor buffer,
 * the autosaver in front of it and the notebook sidebar. What is under test is
 * that boundary: which edits reach `putNote` and when, which ones are not worth
 * a write at all, and that a delete takes a note's subtree with it.
 *
 * `lib/client` is faked rather than driven through a session, as in the suites
 * that mount `App`: every write here would otherwise need an OPAQUE exchange
 * only the server can answer.
 */

import { useState } from "react";
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
let deletes: string[] = [];
let notebookWrites: { name: string; id?: string; previousRaw?: string }[] = [];
let notebookDeletes: string[] = [];
let ensured = 0;
let created = 0;
/** The vault rows the faked client reports, by id. */
let stored = new Map<string, { revision: number; payload: string }>();
/** The `base` each `saveNote` was given, in order. */
let bases: unknown[] = [];
/** When set, what the next `saveNote` reports as stored, as after a merge. */
let mergedPayload: string | null = null;
/** Note ids `deleteNote` refuses, for the paths that have to survive one. */
let undeletable = new Set<string>();
/** How many batched calls the delete and the child rewrite each made. */
let deleteBatches = 0;
let moveBatches = 0;

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
    deleteNotes: async (_session: unknown, ids: string[]) => {
      deleteBatches += 1;
      const refused = new Map(ids.filter((id) => undeletable.has(id)).map((id) => [id, "that note would not delete"]));
      const gone = ids.filter((id) => !refused.has(id));
      deletes.push(...gone);
      notes = notes.filter((note) => !gone.includes(note.id));
      if (refused.size > 0) throw new actual.RefusedWrites(refused);
    },
    putNotes: async (_session: unknown, batch: { id: string; draft: NoteDraft }[]) => {
      moveBatches += 1;
      for (const { id, draft } of batch) {
        writes.push({ id, draft });
        notes = notes.map((note) => (note.id === id ? { ...draft, id, raw: serializeNote(draft) } : note));
      }
    },
    putNotebook: async (_session: unknown, name: string, id?: string, previousRaw?: string) => {
      notebookWrites.push({ name, id, previousRaw });
      if (id) notebooks = notebooks.map((book) => (book.id === id ? { ...book, name } : book));
      else notebooks = [...notebooks, { id: `notebook-${name}`, name, raw: "{}" }];
      return id ?? `notebook-${name}`;
    },
    deleteNotebook: async (_session: unknown, id: string) => {
      notebookDeletes.push(id);
      notebooks = notebooks.filter((book) => book.id !== id);
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
  syncVault = (next) => setVault((current) => ({ ...current, notes: next }));
  setOutboxState = setOutbox;
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
  fireEvent.click(screen.getByRole("button", { name: "New note" }));
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
  deletes = [];
  notebookWrites = [];
  notebookDeletes = [];
  undeletable = new Set();
  deleteBatches = 0;
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
  it("creates the default notebook on first entry, once", async () => {
    mount({ notebooks: [] });

    await waitFor(() => expect(ensured).toBe(1));
    expect(refreshes).toBe(1);
    await waitFor(() => expect(screen.getByText("Default Notebook")).not.toBeNull());
  });

  it("leaves the vault alone when one already exists", async () => {
    mount({ notebooks: [DEFAULT_BOOK] });

    await waitFor(() => expect(screen.getByText("Default Notebook")).not.toBeNull());
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

    const row = screen.getByText("Work").closest("div")?.parentElement;
    expect(within(row as HTMLElement).getByText("1")).not.toBeNull();
  });

  it("creates a notebook from the sidebar", async () => {
    mount({ notebooks: [DEFAULT_BOOK] });

    fireEvent.click(screen.getByRole("button", { name: "Add notebook" }));
    const field = screen.getByLabelText("New notebook name");
    fireEvent.change(field, { target: { value: "Work" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    await waitFor(() => expect(notebookWrites).toEqual([{ name: "Work", id: undefined, previousRaw: undefined }]));
    await waitFor(() => expect(screen.getByText("Work")).not.toBeNull());
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

  it("deletes a notebook and the notes it held", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [aNote({ id: "a", notebookId: work.id }), aNote({ id: "b" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    const dialog = screen.getByRole("dialog", { name: "Delete notebook" });
    expect(dialog.textContent).toContain("its 1 note");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete notebook" }));

    await waitFor(() => expect(notebookDeletes).toEqual([work.id]));
    expect(deletes).toEqual(["a"]);
    expect(deleteBatches).toBe(1);
  });

  it("keeps a notebook whose notes would not all delete", async () => {
    const work: Notebook = { id: "notebook-work", name: "Work", raw: "{}" };
    undeletable = new Set(["b"]);
    mount({
      notebooks: [DEFAULT_BOOK, work],
      notes: [
        aNote({ id: "a", notebookId: work.id }),
        aNote({ id: "b", notebookId: work.id }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete notebook" })).getByRole("button", {
        name: "Delete notebook",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "1 of 2 notes could not be deleted, so the notebook was kept.",
      ),
    );
    expect(notebookDeletes).toEqual([]);
  });
});

describe("NotesView, finding a note", () => {
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

  it("flattens the tree while searching, so a nested hit is reachable", async () => {
    mount({
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent", body: "hinges" }),
      ],
    });

    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "hinges" } });

    await waitFor(() => expect(screen.getByText("Hardware")).not.toBeNull());
    expect(screen.queryByText("Shopping")).toBeNull();
  });

  it("searches every notebook and names the one a hit is in", async () => {
    mount({
      notebooks: [{ id: "work", name: "Work", raw: "{}" }],
      notes: [aNote({ id: "w", title: "Standup", notebookId: "work", body: "hinges" })],
    });

    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "hinges" } });

    await waitFor(() => expect(screen.getByText("Standup")).not.toBeNull());
    expect(screen.getAllByText("Work").length).toBeGreaterThan(0);
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
  it("deletes a note and everything under it", async () => {
    mount({
      notes: [
        aNote({ id: "parent", title: "Shopping" }),
        aNote({ id: "child", title: "Hardware", parentId: "parent" }),
        aNote({ id: "other", title: "Recipes" }),
      ],
    });

    await openNote("Shopping");
    fireEvent.click(within(editorHeader()).getByRole("button", { name: "Delete Shopping" }));
    const dialog = screen.getByRole("dialog", { name: "Delete note" });
    expect(dialog.textContent).toContain("the 1 note inside it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(deletes.sort()).toEqual(["child", "parent"]));
    expect(deletes).not.toContain("other");
    expect(deleteBatches).toBe(1);
  });

  it("closes the editor when the note it was on is deleted", async () => {
    mount({ notes: [aNote({ id: "a", title: "Shopping" })] });

    await openNote("Shopping");
    fireEvent.click(within(editorHeader()).getByRole("button", { name: "Delete Shopping" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete note" })).getByRole("button", {
        name: "Delete note",
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

    expect(screen.getByRole("dialog", { name: "Delete note" }).textContent).toContain(
      "This permanently removes the note from your encrypted vault",
    );
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
