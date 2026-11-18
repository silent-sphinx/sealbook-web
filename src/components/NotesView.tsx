import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  ensureDefaultNotebook,
  newNoteId,
  putNote,
  putNotes,
  putNotebook,
  saveNote,
  vaultObject,
} from "../lib/client";
import type { Session } from "../lib/client";
import { archivedIds, hiddenIds } from "../lib/archive";
import { createAutosaver } from "../lib/autosave";
import type { LocalObject } from "../lib/wasm";
import { friendlyError } from "../lib/errors";
import { useNotePhotos } from "./useNotePhotos";
import { triggerDownload } from "../lib/importExport";
import {
  DEFAULT_NOTEBOOK_ID,
  emptyNoteDraft,
  noteDraftWritable,
  payloadFitsObjectLimit,
  buildSearchIndex,
  indexMatches,
  noteWordCount,
  notebookTone,
  parseNote,
  resolveNotebookId,
  serializeNote,
  sortNotes,
} from "../lib/note";
import { ancestorsOf, buildNoteTree, canReparent, noteSubtree } from "../lib/noteTree";
import {
  focusRing,
  sidebarHeaderAction,
  sidebarSectionAction,
} from "../lib/styles";
import type { Note, NoteDraft, Notebook } from "../lib/types";
import type { OutboxState } from "../lib/outbox";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashPanel, TrashRow, trashRootsFor } from "./Trash";
import { NO_TRASH, type TrashListing } from "../lib/trash";
import { trashItems } from "../lib/trashApi";
import { CollectionSidebar, SidebarAddRow } from "./CollectionSidebar";
import { RenameNoteDialog } from "./RenameNoteDialog";
import { NoteTreeList } from "./NoteTreeList";
import { NotebookPages } from "./NotebookPages";
import { NotesOverview } from "./NotesOverview";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import { Icon } from "./Icon";

/**
 * The editor carries the whole ProseMirror stack and the highlighting grammars,
 * which is the largest thing this app bundles. It is loaded when a note is first
 * opened rather than on the way to the unlock screen.
 */
const NoteEditor = lazy(() =>
  import("./NoteEditor").then((module) => ({ default: module.NoteEditor })),
);

type Props = {
  session: Session;
  /** What is in the trash; the Notes tab lists its notes and notebooks. */
  trash?: TrashListing;
  notes: Note[];
  notebooks: Notebook[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  /** Applies one saved note to the vault list, so autosave need not refetch. */
  onSaved: (note: Note) => void;
  /** Photos need the server, so none are added offline. */
  offline?: boolean;
  /** The write queue, so a note's footer can say whether its write has left this device. */
  outbox?: OutboxState;
  /** Shared with the rest of the shell; the header owns the control. */
  sidebar: Sidebar;
  /** Bumped by the shell when the Notes tab is clicked while already open. */
  homeSignal?: number;
  /** A note to open, as `TasksView`'s `focusTaskId`. */
  focusNoteId?: string;
  onFocusHandled?: () => void;
};

/** Idle time before an edit is written, and the cap for a continuous typist. */
const AUTOSAVE_DELAY = 600;
const AUTOSAVE_MAX_DELAY = 3000;

type SaveState = "clean" | "pending" | "saving" | "failed";

type QueuedEdit = { id: string; draft: NoteDraft };

const SAVE_LABEL: Record<SaveState, string> = {
  clean: "Saved",
  pending: "Saving...",
  saving: "Saving...",
  failed: "Not saved",
};


function stamp(iso: string | undefined, withTime = false): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleString(undefined, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" });
}

function longStamp(iso: string | undefined): string {
  if (!iso) return "Never edited";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "Never edited";
  return new Date(parsed).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
}

function fileNameFor(title: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "note";
  return `${base.slice(0, 60)}.md`;
}

/** The note as a file: its title as the heading, then the body. */
function exportMarkdown(draft: NoteDraft): string {
  const title = draft.title.trim();
  return title ? `# ${title}\n\n${draft.body}` : draft.body;
}

export function NotesView({ session, trash = NO_TRASH, notes, notebooks, busy, onRefresh, onSaved, offline = false, outbox, sidebar, homeSignal = 0, focusNoteId, onFocusHandled }: Props) {
  const [scope, setScope] = useState<string>(DEFAULT_NOTEBOOK_ID);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [deletingNotebook, setDeletingNotebook] = useState<Notebook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState<Note[] | null>(null);
  const [renaming, setRenaming] = useState<Note | null>(null);
  const [renamingNotebook, setRenamingNotebook] = useState<Notebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingTrash, setViewingTrash] = useState(false);
  const trashCount = useMemo(() => trashRootsFor(trash, "notes").length, [trash]);
  const menu = useContextMenu();

  // The editor buffer. Held here rather than read from `notes` so an in-progress
  // edit is not overwritten by a refresh.
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  // The note the editor is on, including one not yet written to the vault.
  const editingId = useRef<string | null>(null);
  const savedThisSession = useRef(false);
  // The stored object the open note was last read or written as. Every save is
  // merged against it, so a change a sync brought in meanwhile is not reverted.
  const baseRef = useRef<{ id: string; object?: LocalObject }>({ id: "" });
  // Bumped to make the editor reload its document from the draft.
  const [reloadKey, setReloadKey] = useState(0);

  const selected = selectedId ? (notes.find((note) => note.id === selectedId) ?? null) : null;

  // The default notebook is created on first entry here, not on every vault
  // refresh: a failed write on the refresh path would stop the whole vault
  // loading, contacts included.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (ensuredRef.current) return;
    if (notebooks.some((notebook) => notebook.id === DEFAULT_NOTEBOOK_ID)) {
      ensuredRef.current = true;
      return;
    }
    ensuredRef.current = true;
    void (async () => {
      try {
        await ensureDefaultNotebook(session, notebooks);
        await onRefresh();
      } catch (err) {
        setError(friendlyError(err));
      }
    })();
  }, [notebooks, onRefresh, session]);

  // An archived notebook, and any note in one, stays out of the overview.
  const awayNotebooks = useMemo(() => archivedIds(notebooks), [notebooks]);
  const liveNotebooks = useMemo(
    () => notebooks.filter((notebook) => !awayNotebooks.has(notebook.id)),
    [notebooks, awayNotebooks],
  );
  const liveNotes = useMemo(
    () => notes.filter((note) => !awayNotebooks.has(resolveNotebookId(note.notebookId))),
    [notes, awayNotebooks],
  );

  // A hidden notebook is left out of the overview's covers and recent notes,
  // but stays in the sidebar and in search.
  const hiddenNotebooks = useMemo(() => hiddenIds(notebooks), [notebooks]);
  const overviewNotebooks = useMemo(
    () => liveNotebooks.filter((notebook) => !hiddenNotebooks.has(notebook.id)),
    [liveNotebooks, hiddenNotebooks],
  );
  const overviewNotes = useMemo(
    () => liveNotes.filter((note) => !hiddenNotebooks.has(resolveNotebookId(note.notebookId))),
    [liveNotes, hiddenNotebooks],
  );

  // A notebook that went away leaves the sidebar pointing at nothing.
  useEffect(() => {
    if (notebooks.length === 0) return;
    if (!notebooks.some((notebook) => notebook.id === scope)) {
      setScope((liveNotebooks[0] ?? notebooks[0]).id);
    }
  }, [notebooks, liveNotebooks, scope]);

  const refusal = outbox?.failed.find((entry) => entry.write.id === selectedId)?.reason;
  const saveLabel =
    saveState !== "clean"
      ? SAVE_LABEL[saveState]
      : refusal
        ? `Not saved: ${refusal}`
        : selectedId && outbox?.queued.includes(selectedId)
          ? "Saved on this device"
          : SAVE_LABEL.clean;

  // An edit that has not reached the vault must survive a reload attempt, and a
  // write cannot be awaited from `beforeunload`.
  useEffect(() => {
    if (saveState === "clean") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // A full pass over every body, so the typed value is deferred: the field stays
  // responsive on a vault the filter takes time over.
  const deferredSearch = useDeferredValue(search);
  const searching = deferredSearch.trim() !== "";

  const tree = useMemo(() => buildNoteTree(notes, scope), [notes, scope]);

  const searchIndex = useMemo(() => buildSearchIndex(notes), [notes]);

  /**
   * Search spans every notebook and flattens the tree, since a hit may be
   * anywhere, but never reaches into an archived notebook.
   */
  const flatMatches = useMemo(
    () => sortNotes(liveNotes.filter((note) => indexMatches(searchIndex.get(note.id), deferredSearch))),
    [liveNotes, searchIndex, deferredSearch],
  );

  const countedBody = useDeferredValue(draft?.body ?? "");
  const words = useMemo(() => noteWordCount(countedBody), [countedBody]);

  const breadcrumb = useMemo(
    () =>
      selectedId
        ? ancestorsOf(notes, selectedId)
            .map((id) => notes.find((note) => note.id === id))
            .filter((note): note is Note => !!note && !!note.title)
            .reverse()
        : [],
    [notes, selectedId],
  );

  // Reassigned every render so the queued write uses the current session and
  // props, while the autosaver below is created once.
  const writeRef = useRef<(edit: QueuedEdit) => Promise<void>>(async () => {});
  writeRef.current = async ({ id, draft: payload }) => {
    const created = !notes.some((note) => note.id === id);
    // An untouched new note is not worth an object in the vault.
    if (created && !payload.title.trim() && !payload.body.trim()) return;
    let serialised: string;
    try {
      serialised = serializeNote(payload);
    } catch (cause) {
      if (noteDraftWritable(payload)) throw cause;
      setError(
        "This note was written by a newer version of Sealbook. Update this client before editing it.",
      );
      setSaveState("failed");
      return;
    }
    if (!payloadFitsObjectLimit(serialised)) {
      setError("This note is too large to store. One note can hold about 8 MB.");
      setSaveState("failed");
      return;
    }
    const live = () => editingId.current === id;
    if (live()) setSaveState("saving");
    const base = baseRef.current.id === id ? baseRef.current.object : undefined;
    const { id: saved, written, settled } = await saveNote(session, payload, id, base, serialised);
    if (settled && baseRef.current.id === id) baseRef.current = { id, object: settled };
    const now = new Date().toISOString();
    const createdAt = payload.createdAt ?? now;
    savedThisSession.current = true;
    // Carries the payload just written, not an empty string: the next edit of
    // this note merges onto it, and a blank one would drop any field a newer
    // build had put there.
    onSaved({ ...payload, id: saved, raw: serialised, createdAt, updatedAt: now });
    setError(null);
    // The editor may have moved on to another note while this was in flight.
    if (!live()) return;
    if (settled && settled.payload !== written && !autosaver.queued()) {
      reloadFrom(parseNote(id, settled.payload));
      setSaveState("clean");
      return;
    }
    setSelectedId(id);
    setSaveState(autosaver.queued() ? "pending" : "clean");
    setDraft((current) => (current ? { ...current, createdAt, updatedAt: now } : current));
  };

  const autosaverRef = useRef<ReturnType<typeof createAutosaver<QueuedEdit>> | null>(null);
  if (autosaverRef.current === null) {
    autosaverRef.current = createAutosaver<QueuedEdit>({
      delay: AUTOSAVE_DELAY,
      maxDelay: AUTOSAVE_MAX_DELAY,
      key: (edit) => edit.id,
      save: (edit) => writeRef.current(edit),
      onError: (err) => {
        setError(friendlyError(err));
        setSaveState("failed");
      },
    });
  }
  const autosaver = autosaverRef.current;

  // Leaving the tab, or the view, must not strand an edit in the debounce.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void autosaver.flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void autosaver.flush();
    };
  }, [autosaver]);

  function reveal(id: string) {
    const chain = ancestorsOf(notes, id);
    if (chain.length === 0) return;
    setExpanded((current) => new Set([...current, ...chain]));
  }

  function reloadFrom(note: Note) {
    setDraft({
      title: note.title,
      body: note.body,
      notebookId: note.notebookId,
      parentId: note.parentId,
      attachments: note.attachments,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      raw: note.raw,
    });
    setReloadKey((key) => key + 1);
  }

  // A sync can bring in another device's edit to the open note. A draft with
  // nothing unsaved takes it; one with edits keeps them, and its save merges.
  useEffect(() => {
    const id = editingId.current;
    if (!id || baseRef.current.id !== id) return;
    const stored = vaultObject(id);
    const held = baseRef.current.object;
    if (!stored || !held || stored.revision === held.revision) return;
    if (saveStateRef.current !== "clean" || autosaverRef.current?.queued()) return;
    baseRef.current = { id, object: stored };
    reloadFrom(parseNote(id, stored.payload));
  }, [notes]);

  function openNote(note: Note) {
    // Flushed, not cancelled: the queue is keyed by note, so the edit being left
    // behind goes out while this one is opened.
    pruneUnshown();
    void autosaver.flush();
    editingId.current = note.id;
    baseRef.current = { id: note.id, object: vaultObject(note.id) };
    setSelectedId(note.id);
    setScope(resolveNotebookId(note.notebookId));
    reveal(note.id);
    setDraft({
      title: note.title,
      body: note.body,
      notebookId: note.notebookId,
      parentId: note.parentId,
      attachments: note.attachments,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      // The stored payload, so a save merges onto it: attachments (and any field
      // a newer build added) survive an edit here rather than being rebuilt away.
      raw: note.raw,
    });
    setSaveState("clean");
    setError(null);
    sidebar.close();
  }

  function newNote(parentId?: string) {
    pruneUnshown();
    void autosaver.flush();
    // The id is issued here so every write for this note is an update.
    editingId.current = newNoteId();
    baseRef.current = { id: editingId.current };
    setSelectedId(null);
    setDraft({ ...emptyNoteDraft(scope), parentId });
    setSaveState("clean");
    setError(null);
    sidebar.close();
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
  }

  async function goHome() {
    setBrowsing(null);
    setSearch("");
    setViewingTrash(false);
    sidebar.close();
    await closeEditor();
  }

  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;
  const seenSignal = useRef(homeSignal);
  useEffect(() => {
    if (seenSignal.current === homeSignal) return;
    seenSignal.current = homeSignal;
    void goHomeRef.current();
  }, [homeSignal]);

  const openNoteRef = useRef(openNote);
  openNoteRef.current = openNote;
  useEffect(() => {
    if (!focusNoteId) return;
    const target = notes.find((note) => note.id === focusNoteId);
    if (target) {
      setBrowsing(null);
      setSearch("");
      openNoteRef.current(target);
    }
    onFocusHandled?.();
  }, [focusNoteId, notes, onFocusHandled]);

  async function closeEditor() {
    pruneUnshown();
    editingId.current = null;
    baseRef.current = { id: "" };
    setSelectedId(null);
    setDraft(null);
    setSaveState("clean");
    await autosaver.flush();
    // One refetch per editing session, rather than one per keystroke, keeps the
    // list and the offline snapshot authoritative without paying for it twice.
    if (savedThisSession.current) {
      savedThisSession.current = false;
      await onRefresh();
    }
  }

  // A functional update so two patches raised in the same tick both survive: the
  // photo flow sets `attachments` and the editor's node insertion sets `body`
  // back to back, and a `{...draft}` merge from one stale closure would drop one.
  function edit(patch: Partial<NoteDraft>) {
    const id = editingId.current;
    if (!id) return;
    setSaveState("pending");
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      autosaver.schedule({ id, draft: next });
      return next;
    });
  }

  // The editor builds its extensions once per note, so its resolver and uploader
  // read the live draft through a ref rather than closing over this render's.
  const draftRef = useRef<NoteDraft | null>(draft);
  draftRef.current = draft;

  const { getAttachmentWidth, onResizeAttachment, resolveAttachment, uploadImage, pruneUnshown } =
    useNotePhotos({
      session,
      draftRef,
      editingId,
      edit,
      schedule: (write) => autosaver.schedule(write),
      setError,
    });

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Reparenting writes the note itself; its descendants follow it as they are. */
  async function moveNote(id: string, parentId: string | null) {
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) return;
    if (!canReparent(notes, id, parentId)) {
      setError("A note cannot be moved inside itself.");
      return;
    }
    if (editingId.current === id && draft) {
      edit({ parentId: parentId ?? undefined });
      if (parentId) setExpanded((current) => new Set([...current, parentId]));
      return;
    }
    setError(null);
    try {
      await putNote(session, { ...note, parentId: parentId ?? undefined }, id);
      if (parentId) setExpanded((current) => new Set([...current, parentId]));
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /** A note's subtree moves notebook with it, or its children would be stranded. */
  async function moveToNotebook(notebookId: string) {
    const id = editingId.current;
    if (!id || !draft) return;
    const descendants = noteSubtree(notes, id).filter((candidate) => candidate !== id);
    edit({ notebookId });
    setScope(notebookId);
    if (descendants.length === 0) return;
    setError(null);
    try {
      const children = descendants.flatMap((childId) => {
        const child = notes.find((candidate) => candidate.id === childId);
        return child ? [{ id: childId, draft: { ...child, notebookId } }] : [];
      });
      await putNotes(session, children);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /**
   * Moves notes to the trash. Each takes the notes inside it along, so only
   * the outermost of the picked notes is written.
   */
  async function removeNotes(picked: Note[]): Promise<boolean> {
    setError(null);
    const ids = withSubtrees(picked);
    const outermost = picked.filter(
      (note) => !picked.some((other) => other.id !== note.id && noteSubtree(notes, other.id).includes(note.id)),
    );
    try {
      for (const id of ids) {
        autosaver.drop(id);
      }
      // Any write already in flight has to land before the trash stamp does.
      await autosaver.flush();
      await trashItems(session, outermost.map((item) => ({ kind: "note" as const, item })));
      if (ids.includes(editingId.current ?? "")) {
        editingId.current = null;
        setSelectedId(null);
        setDraft(null);
        setSaveState("clean");
      }
      savedThisSession.current = false;
      await onRefresh();
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    }
  }

  async function removeNote() {
    const target = confirmDelete;
    if (!target) return;
    if (await removeNotes([target])) setConfirmDelete(null);
  }

  async function renameNote(note: Note, title: string) {
    setRenaming(null);
    if (!noteDraftWritable(note)) {
      setError("This note was written by a newer version of Sealbook. Update this client before editing it.");
      return;
    }
    if (editingId.current === note.id && draft) {
      edit({ title });
      return;
    }
    setError(null);
    try {
      await autosaver.flush();
      await putNote(session, { ...note, title }, note.id);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /** Each note with everything inside it, since deleting or moving a note takes its subtree. */
  function withSubtrees(picked: Note[]): string[] {
    return [...new Set(picked.flatMap((note) => noteSubtree(notes, note.id)))];
  }

  async function removeBulk() {
    const picked = bulkDeleting;
    if (!picked) return;
    setBulkDeleting(null);
    await removeNotes(picked);
  }

  /** As `moveToNotebook`, for several notes: each note's subtree moves with it. */
  async function moveNotesToNotebook(picked: Note[], notebookId: string) {
    const ids = new Set(withSubtrees(picked));
    setError(null);
    const editing = editingId.current;
    const moving = notes.filter(
      (note) =>
        ids.has(note.id) &&
        resolveNotebookId(note.notebookId) !== notebookId &&
        noteDraftWritable(note),
    );
    try {
      await autosaver.flush();
      const stored = moving.filter((note) => note.id !== editing);
      if (stored.length > 0) {
        await putNotes(
          session,
          stored.map((note) => ({ id: note.id, draft: { ...note, notebookId } })),
        );
      }
      // The open note is written by the editor, so its buffer is not left behind.
      if (editing && draft && moving.some((note) => note.id === editing)) edit({ notebookId });
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function createNotebook(name: string) {
    setError(null);
    try {
      await putNotebook(session, name);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function renameNotebook(id: string, name: string) {
    setError(null);
    try {
      const previous = notebooks.find((notebook) => notebook.id === id);
      await putNotebook(session, name, id, previous?.raw, previous?.color);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function setNotebookArchived(notebook: Notebook, archived: boolean) {
    setError(null);
    try {
      await putNotebook(session, notebook.name, notebook.id, notebook.raw, notebook.color, archived);
      if (archived && scope === notebook.id) {
        setScope(DEFAULT_NOTEBOOK_ID);
        setBrowsing(null);
      }
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function toggleNotebookHidden(notebook: Notebook) {
    setError(null);
    try {
      await putNotebook(
        session,
        notebook.name,
        notebook.id,
        notebook.raw,
        notebook.color,
        undefined,
        notebook.hideFromAll !== true,
      );
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function recolorNotebook(notebook: Notebook, color: string) {
    setError(null);
    try {
      await putNotebook(session, notebook.name, notebook.id, notebook.raw, color);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function removeNotebook() {
    if (!deletingNotebook) return;
    setError(null);
    try {
      const contained = notes.filter(
        (candidate) => resolveNotebookId(candidate.notebookId) === deletingNotebook.id,
      );
      for (const note of contained) autosaver.drop(note.id);
      await autosaver.flush();
      // Its notes go to the trash with it, and come back with it.
      await trashItems(session, [{ kind: "notebook", item: deletingNotebook }]);
      setDeletingNotebook(null);
      if (contained.some((note) => note.id === editingId.current)) {
        editingId.current = null;
        setSelectedId(null);
        setDraft(null);
        setSaveState("clean");
      }
      savedThisSession.current = false;
      if (scope === deletingNotebook.id) setScope(DEFAULT_NOTEBOOK_ID);
      if (browsing === deletingNotebook.id) setBrowsing(null);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /** Shown on each notebook row at rest, so an unselected one still reads as full. */
  const countByNotebook = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      const id = resolveNotebookId(note.notebookId);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [notes]);

  const notebookContents =
    tree.length === 0 ? (
      <p className="px-1 py-2 text-xs leading-relaxed text-mute">
        No notes here yet.
      </p>
    ) : (
      <NoteTreeList
        tree={tree}
        selectedId={selectedId}
        expanded={expanded}
        onToggle={toggleExpanded}
        onSelect={openNote}
        onAddChild={(parentId) => newNote(parentId)}
        onDelete={(note) => setConfirmDelete(note)}
        blockedDropIds={(id) => new Set(noteSubtree(notes, id))}
        onMove={(id, parentId) => void moveNote(id, parentId)}
      />
    );

  const addNoteRow = <SidebarAddRow label="New note" onClick={() => newNote()} />;

  const browsingNotebook = notebooks.find((notebook) => notebook.id === browsing) ?? null;
  const notesInDeletingNotebook = deletingNotebook
    ? notes.filter((note) => resolveNotebookId(note.notebookId) === deletingNotebook.id).length
    : 0;
  const deleteCount = confirmDelete ? noteSubtree(notes, confirmDelete.id).length : 0;

  const editorAction = `flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden text-text">
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {error ? (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6">
          {error}
        </p>
      ) : null}

      <div className="sb-shell grid min-h-0 flex-1" style={sidebar.cols}>
        <SidebarDrawer title="Notes" sidebar={sidebar}>
          <SidebarHeader
            title="Notes"
            onTitleClick={() => void goHome()}
            action={
              <button
                type="button"
                onClick={() => newNote()}
                aria-label="Create note"
                title="Create note"
                className={sidebarHeaderAction}
              >
                <Icon name="plus" className="h-4 w-4" />
              </button>
            }
          />

          <SidebarSection
            label="Notebooks"
            action={
              <button
                type="button"
                onClick={() => setCreatingNotebook(true)}
                className={sidebarSectionAction}
                aria-label="Add notebook"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
              </button>
            }
          >
            <CollectionSidebar
              collections={notebooks}
              selectedId={scope}
              icon="book"
              kindLabel="notebook"
              tone={(notebook) => notebookTone(notebook.id, notebook.color)}
              protectedId={DEFAULT_NOTEBOOK_ID}
              counts={countByNotebook}
              creating={creatingNotebook}
              onCreateHandled={() => setCreatingNotebook(false)}
              onSelect={(id) => {
                setScope(id);
                setBrowsing(id);
                // An open note would otherwise keep the main pane.
                void closeEditor();
                setSearch("");
              }}
              onCreate={(name) => createNotebook(name)}
              onRename={(notebook, name) => renameNotebook(notebook.id, name)}
              onRecolor={(notebook, color) => recolorNotebook(notebook, color)}
              onDelete={(notebook) => setDeletingNotebook(notebook)}
              onArchive={(notebook) => void setNotebookArchived(notebook, true)}
              onRestore={(notebook) => void setNotebookArchived(notebook, false)}
              onToggleHidden={(notebook) => void toggleNotebookHidden(notebook)}
              renderContents={() => (
                <>
                  {notebookContents}
                  {addNoteRow}
                </>
              )}
              busy={busy}
            />
            <TrashRow
              count={trashCount}
              active={viewingTrash}
              onToggle={() => {
                if (!viewingTrash) void closeEditor();
                setViewingTrash(!viewingTrash);
              }}
            />
          </SidebarSection>
        </SidebarDrawer>

        {viewingTrash ? (
          <TrashPanel session={session} trash={trash} tab="notes" onChanged={onRefresh} />
        ) : (
        <section className="flex min-w-0 flex-col overflow-hidden">
          {draft ? (
            <>
              <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-2.5">
                <button
                  type="button"
                  onClick={() => void closeEditor()}
                  className={`${editorAction} lg:hidden`}
                  aria-label="Back to notes"
                >
                  <Icon name="back" className="h-3.5 w-3.5" />
                </button>
                <nav aria-label="Breadcrumb" className="ml-1 flex min-w-0 flex-1 lg:ml-4 items-center gap-1 overflow-hidden text-xs text-mute">
                  {breadcrumb.map((crumb) => (
                    <span key={crumb.id} className="flex min-w-0 shrink items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openNote(crumb)}
                        className={`max-w-[8rem] truncate rounded hover:text-text ${focusRing}`}
                      >
                        {crumb.title}
                      </button>
                      <span aria-hidden="true" className="text-mute/50">/</span>
                    </span>
                  ))}
                  <span className="min-w-0 flex-1 truncate font-medium text-text">
                    {draft.title.trim() || "Untitled note"}
                  </span>
                </nav>
                <select
                  value={resolveNotebookId(draft.notebookId)}
                  onChange={(event) => void moveToNotebook(event.target.value)}
                  aria-label="Notebook"
                  disabled={notebooks.length === 0}
                  className={`h-7 max-w-[9rem] shrink-0 cursor-pointer rounded-md border-0 bg-transparent py-0 pl-2 pr-6 text-[11px] text-mute transition-colors hover:bg-surface hover:text-text disabled:opacity-40 ${focusRing}`}
                >
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => triggerDownload(fileNameFor(draft.title), "text/markdown", exportMarkdown(draft))}
                  title="Export as Markdown"
                  aria-label="Export as Markdown"
                  className={editorAction}
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                </button>
                {selectedId ? (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmDelete(
                        selected ?? { ...draft, id: selectedId, raw: draft.raw ?? "" },
                      )
                    }
                    title="Delete note"
                    aria-label={`Delete ${draft.title}`}
                    className={`${editorAction} hover:text-danger`}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </header>

              <Suspense
                fallback={
                  <div className="min-h-0 flex-1 px-5 pt-7 lg:px-10" role="status">
                    <div className="note-column space-y-3" aria-hidden="true">
                      {[92, 84, 96, 61].map((width) => (
                        <span
                          key={width}
                          className="block h-3 animate-pulse rounded bg-surface"
                          style={{ width: `${width}%` }}
                        />
                      ))}
                    </div>
                    <span className="sr-only">Loading the editor…</span>
                  </div>
                }
              >
                <NoteEditor
                  noteId={`${editingId.current ?? "none"}:${reloadKey}`}
                  value={draft.body}
                  onChange={(body) => edit({ body })}
                  resolveAttachment={resolveAttachment}
                  onUploadImage={offline ? undefined : uploadImage}
                  getAttachmentWidth={getAttachmentWidth}
                  onResizeAttachment={onResizeAttachment}
                  header={
                    <input
                      value={draft.title}
                      onChange={(event) => edit({ title: event.target.value })}
                      placeholder="Untitled note"
                      aria-label="Note title"
                      className={`w-full border-0 bg-transparent p-0 text-[1.75rem] font-semibold leading-tight tracking-tight text-text outline-none placeholder:text-mute/50 ${focusRing} focus-visible:ring-offset-4`}
                    />
                  }
                />
              </Suspense>

              <footer className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-[11px] text-mute">
                <span className="tabular-nums" title={longStamp(draft.updatedAt ?? draft.createdAt)}>
                  {stamp(draft.updatedAt ?? draft.createdAt, true) ?? "Not saved yet"}
                </span>
                <span className="ml-auto shrink-0 tabular-nums">
                  {words} {words === 1 ? "word" : "words"}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1.5 ${saveLabel.startsWith("Not saved") ? "text-danger" : ""}`}
                  aria-live="polite"
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      saveLabel.startsWith("Not saved")
                        ? "bg-danger"
                        : saveState === "clean"
                          ? "bg-note-new"
                          : "bg-note"
                    }`}
                  />
                  {saveLabel}
                </span>
                <button
                  type="button"
                  onClick={() => void closeEditor()}
                  className={`hidden h-6 shrink-0 rounded-md px-2 text-[11px] text-mute transition-colors hover:bg-surface hover:text-text lg:block ${focusRing}`}
                >
                  Close
                </button>
              </footer>
            </>
          ) : (
            browsingNotebook ? (
              <NotebookPages
                notebook={browsingNotebook}
                notes={notes}
                notebooks={liveNotebooks}
                search={search}
                onSearch={setSearch}
                results={searching ? flatMatches : null}
                query={deferredSearch.trim()}
                dialogOpen={confirmDelete !== null || deletingNotebook !== null || bulkDeleting !== null || renaming !== null || renamingNotebook !== null}
                onBack={() => {
                  setBrowsing(null);
                  setSearch("");
                }}
                onOpenNote={openNote}
                onNewNote={() => newNote()}
                onMoveNotes={(picked, notebookId) => void moveNotesToNotebook(picked, notebookId)}
                onDeleteNotes={setBulkDeleting}
                onRenameNote={setRenaming}
                onDeleteNote={setConfirmDelete}
              />
            ) : (
              <NotesOverview
                notebooks={overviewNotebooks}
                notes={overviewNotes}
                onOpenNotebook={(id) => {
                  setSearch("");
                  setScope(id);
                  setBrowsing(id);
                }}
                search={search}
                onSearch={setSearch}
                results={searching ? flatMatches : null}
                query={deferredSearch.trim()}
                dialogOpen={confirmDelete !== null || deletingNotebook !== null || bulkDeleting !== null || renaming !== null || renamingNotebook !== null}
                onOpenNote={openNote}
                onNewNote={() => newNote()}
                onMoveNotes={(picked, notebookId) => void moveNotesToNotebook(picked, notebookId)}
                onDeleteNotes={setBulkDeleting}
                onRenameNote={setRenaming}
                onDeleteNote={setConfirmDelete}
                onRenameNotebook={setRenamingNotebook}
                onDeleteNotebook={setDeletingNotebook}
              />
            )
          )}
        </section>
        )}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move “${confirmDelete.title}” to the trash?`}
          body={
            deleteCount > 1
              ? `The note and the ${deleteCount - 1} note${deleteCount === 2 ? "" : "s"} inside it can be restored from the trash for 30 days.`
              : "It can be restored from the trash for 30 days."
          }
          confirmLabel="Move to trash"
          onConfirm={() => void removeNote()}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}

      {renamingNotebook ? (
        <RenameNoteDialog
          key={renamingNotebook.id}
          kind="notebook"
          title={renamingNotebook.name}
          onSave={(name) => {
            const target = renamingNotebook;
            setRenamingNotebook(null);
            if (name && name !== target.name) void renameNotebook(target.id, name);
          }}
          onClose={() => setRenamingNotebook(null)}
        />
      ) : null}
      {renaming ? (
        <RenameNoteDialog
          key={renaming.id}
          title={renaming.title}
          onSave={(title) => void renameNote(renaming, title)}
          onClose={() => setRenaming(null)}
        />
      ) : null}

      {bulkDeleting ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move ${bulkDeleting.length} note${bulkDeleting.length === 1 ? "" : "s"} to the trash?`}
          body={(() => {
            const inside = withSubtrees(bulkDeleting).length - bulkDeleting.length;
            return `The selected notes${
              inside > 0 ? ` and the ${inside} note${inside === 1 ? "" : "s"} inside them` : ""
            } can be restored from the trash for 30 days.`;
          })()}
          confirmLabel="Move to trash"
          onConfirm={() => void removeBulk()}
          onClose={() => setBulkDeleting(null)}
        />
      ) : null}

      {deletingNotebook ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move “${deletingNotebook.name}” to the trash?`}
          body={
            notesInDeletingNotebook === 0
              ? "It can be restored from the trash for 30 days."
              : `The notebook and its ${notesInDeletingNotebook} note${notesInDeletingNotebook === 1 ? "" : "s"} can be restored from the trash for 30 days.`
          }
          confirmLabel="Move to trash"
          onConfirm={() => void removeNotebook()}
          onClose={() => setDeletingNotebook(null)}
        />
      ) : null}
    </main>
  );
}
