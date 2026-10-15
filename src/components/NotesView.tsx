import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteNote,
  deleteNotebook,
  ensureDefaultNotebook,
  newNoteId,
  putNote,
  putNotebook,
} from "../lib/client";
import type { Session } from "../lib/client";
import { createAutosaver } from "../lib/autosave";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import {
  DEFAULT_NOTEBOOK_ID,
  emptyNoteDraft,
  noteFitsObjectLimit,
  noteMatches,
  notePreview,
  noteWordCount,
  resolveNotebookId,
  serializeNote,
  sortNotes,
} from "../lib/note";
import { ancestorsOf, buildNoteTree, canReparent, noteSubtree } from "../lib/noteTree";
import { focusRing } from "../lib/styles";
import type { Note, NoteDraft, Notebook } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContainerList } from "./ContainerList";
import { NoteTreeList } from "./NoteTreeList";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";

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
  notes: Note[];
  notebooks: Notebook[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  /** Applies one saved note to the vault list, so autosave need not refetch. */
  onSaved: (note: Note) => void;
  readOnly?: boolean;
  /** Shared with the rest of the shell; the header owns the control. */
  sidebar: Sidebar;
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

type IconName = "plus" | "pin" | "trash" | "download" | "back" | "search" | "notes";

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const content = {
    plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
    pin: <path d="M8 2.5 9.6 6l3.9.4-2.9 2.6.8 3.8L8 11l-3.4 1.8.8-3.8L2.5 6.4 6.4 6 8 2.5Z" />,
    trash: <path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4.25 4.25 4.75 13a.75.75 0 0 0 .75.7h5a.75.75 0 0 0 .75-.7l.5-8.75" />,
    download: <path d="M8 2.75v7.5M5 7.5 8 10.5l3-3M3 13h10" />,
    back: <path d="M9.5 3.5 5 8l4.5 4.5" />,
    search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.5 10.5 3 3" /></>,
    notes: <><path d="M4 2.75h8a.75.75 0 0 1 .75.75v9.75a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75V3.5A.75.75 0 0 1 4 2.75Z" /><path d="M5.75 6h4.5M5.75 8.5h4.5M5.75 11h2.5" /></>,
  }[name];
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {content}
    </svg>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Fixed rather than locale-formatted: the rows are a dense column that has to
 * align, and `03/04` is a different day either side of the Atlantic. The locale
 * string is the row's `title`.
 */
function stamp(iso: string | undefined, withTime = false): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const at = new Date(parsed);
  const date = `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())}`;
  return withTime ? `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}` : date;
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

export function NotesView({ session, notes, notebooks, busy, onRefresh, onSaved, readOnly, sidebar }: Props) {
  const readOnlyMode = readOnly === true;
  const [scope, setScope] = useState<string>(DEFAULT_NOTEBOOK_ID);
  const [search, setSearch] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [deletingNotebook, setDeletingNotebook] = useState<Notebook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menu = useContextMenu();

  // The editor buffer. Held here rather than read from `notes` so an in-progress
  // edit is not overwritten by a refresh.
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  // The note the editor is on, including one not yet written to the vault.
  const editingId = useRef<string | null>(null);
  const savedThisSession = useRef(false);

  const selected = selectedId ? (notes.find((note) => note.id === selectedId) ?? null) : null;

  // The default notebook is created on first entry here, not on every vault
  // refresh: a failed write on the refresh path would stop the whole vault
  // loading, contacts included.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (readOnlyMode || ensuredRef.current) return;
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
  }, [notebooks, onRefresh, readOnlyMode, session]);

  // A notebook that went away leaves the sidebar pointing at nothing.
  useEffect(() => {
    if (notebooks.length === 0) return;
    if (!notebooks.some((notebook) => notebook.id === scope)) {
      setScope(notebooks[0].id);
    }
  }, [notebooks, scope]);

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

  /** Search and the pinned filter both flatten the tree, since a hit may be anywhere. */
  const flatMatches = useMemo(() => {
    const scoped = notes.filter((note) => resolveNotebookId(note.notebookId) === scope);
    const filtered = pinnedOnly ? scoped.filter((note) => note.pinned === true) : scoped;
    return sortNotes(filtered.filter((note) => noteMatches(note, deferredSearch)));
  }, [notes, scope, pinnedOnly, deferredSearch]);

  const countedBody = useDeferredValue(draft?.body ?? "");
  const words = useMemo(() => noteWordCount(countedBody), [countedBody]);

  const breadcrumb = useMemo(
    () =>
      selectedId
        ? ancestorsOf(notes, selectedId)
            .map((id) => notes.find((note) => note.id === id)?.title ?? "")
            .filter(Boolean)
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
    if (!noteFitsObjectLimit(payload)) {
      setError("This note is too large to store. One note can hold about 8 MB.");
      setSaveState("failed");
      return;
    }
    const live = () => editingId.current === id;
    if (live()) setSaveState("saving");
    const saved = await putNote(session, payload, id);
    const now = new Date().toISOString();
    const createdAt = payload.createdAt ?? now;
    savedThisSession.current = true;
    // Carries the payload just written, not an empty string: the next edit of
    // this note merges onto it, and a blank one would drop any field a newer
    // build had put there.
    onSaved({ ...payload, id: saved, raw: serializeNote(payload), createdAt, updatedAt: now });
    setError(null);
    // The editor may have moved on to another note while this was in flight.
    if (!live()) return;
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

  function openNote(note: Note) {
    // Flushed, not cancelled: the queue is keyed by note, so the edit being left
    // behind goes out while this one is opened.
    void autosaver.flush();
    editingId.current = note.id;
    setSelectedId(note.id);
    setScope(resolveNotebookId(note.notebookId));
    reveal(note.id);
    setDraft({
      title: note.title,
      body: note.body,
      notebookId: note.notebookId,
      parentId: note.parentId,
      pinned: note.pinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    setSaveState("clean");
    setError(null);
    sidebar.close();
  }

  function newNote(parentId?: string) {
    void autosaver.flush();
    // The id is issued here so every write for this note is an update.
    editingId.current = newNoteId();
    setSelectedId(null);
    setDraft({ ...emptyNoteDraft(scope), parentId, pinned: false });
    setSaveState("clean");
    setError(null);
    sidebar.close();
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
  }

  async function closeEditor() {
    editingId.current = null;
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

  function edit(patch: Partial<NoteDraft>) {
    const id = editingId.current;
    if (!draft || !id || readOnlyMode) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaveState("pending");
    autosaver.schedule({ id, draft: next });
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function togglePinned(note: Note) {
    // The open note is pinned through the draft, so the toggle cannot write a
    // stale body over what is being typed.
    if (editingId.current === note.id && draft) {
      edit({ pinned: draft.pinned !== true });
      return;
    }
    setError(null);
    try {
      await putNote(session, { ...note, pinned: note.pinned !== true }, note.id);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  /** Reparenting writes the note itself; its descendants follow it as they are. */
  async function moveNote(id: string, parentId: string | null) {
    const note = notes.find((candidate) => candidate.id === id);
    if (!note || readOnlyMode) return;
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
    if (!id || !draft || readOnlyMode) return;
    const descendants = noteSubtree(notes, id).filter((candidate) => candidate !== id);
    edit({ notebookId });
    setScope(notebookId);
    if (descendants.length === 0) return;
    setError(null);
    try {
      for (const childId of descendants) {
        const child = notes.find((candidate) => candidate.id === childId);
        if (child) await putNote(session, { ...child, notebookId }, childId);
      }
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function removeNote() {
    const target = confirmDelete;
    if (!target) return;
    setError(null);
    const ids = noteSubtree(notes, target.id);
    try {
      for (const id of ids) {
        autosaver.drop(id);
      }
      // Any write already in flight has to land before the tombstones do.
      await autosaver.flush();
      for (const id of ids) {
        await deleteNote(session, id);
      }
      setConfirmDelete(null);
      if (ids.includes(editingId.current ?? "")) {
        editingId.current = null;
        setSelectedId(null);
        setDraft(null);
        setSaveState("clean");
      }
      savedThisSession.current = false;
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
      await putNotebook(session, name, id, previous?.raw);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function removeNotebook() {
    if (!deletingNotebook) return;
    setError(null);
    try {
      // Notes in it go too: a note pointing at a notebook that no longer exists
      // would silently reappear in the default one.
      const contained = notes.filter(
        (candidate) => resolveNotebookId(candidate.notebookId) === deletingNotebook.id,
      );
      let failed = 0;
      for (const note of contained) {
        autosaver.drop(note.id);
        try {
          await deleteNote(session, note.id);
        } catch {
          failed += 1;
        }
      }
      // The notebook outlives a note that would not delete, so nothing is left
      // pointing at a notebook that is no longer there.
      if (failed > 0) {
        setDeletingNotebook(null);
        setError(
          `${failed} of ${contained.length} notes could not be deleted, so the notebook was kept.`,
        );
        await onRefresh();
        return;
      }
      await deleteNotebook(session, deletingNotebook.id);
      setDeletingNotebook(null);
      editingId.current = null;
      savedThisSession.current = false;
      setSelectedId(null);
      setDraft(null);
      setSaveState("clean");
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
    searching || pinnedOnly ? (
      flatMatches.length === 0 ? (
        <p className="px-1 py-2 text-xs leading-relaxed text-mute">
          {searching ? `No note matches \u201c${deferredSearch.trim()}\u201d.` : "Nothing pinned yet."}
        </p>
      ) : (
        <ul>
          {flatMatches.map((note) => (
            <li key={note.id} className="list-row group relative flex items-stretch">
              <button
                type="button"
                onClick={() => openNote(note)}
                onContextMenu={(event) =>
                  menu.open(
                    event,
                    // Offline the vault is read only, so the row offers nothing
                    // and the browser's own menu is left alone.
                    readOnlyMode
                      ? []
                      : [
                          {
                            label: note.pinned ? "Unpin note" : "Pin note",
                            onSelect: () => void togglePinned(note),
                          },
                          {
                            label: "Delete note",
                            danger: true,
                            onSelect: () => setConfirmDelete(note),
                          },
                        ],
                  )
                }
                aria-current={selectedId === note.id ? "true" : undefined}
                className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  selectedId === note.id ? "bg-surface" : "hover:bg-surface/40"
                } ${focusRing}`}
              >
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  {note.pinned ? <Icon name="pin" className="h-3 w-3 shrink-0 text-note" /> : null}
                  <span className="min-w-0 flex-1 truncate text-xs">{note.title}</span>
                </span>
                <span className="w-full truncate text-[11px] text-mute">
                  {notePreview(note.body, 60) || "Empty note"}
                </span>
              </button>
              {readOnlyMode ? null : (
                <span className="list-row-actions absolute right-1 top-1.5">
                  <button
                    type="button"
                    onClick={() => void togglePinned(note)}
                    title={note.pinned ? "Unpin note" : "Pin note"}
                    aria-label={note.pinned ? `Unpin ${note.title}` : `Pin ${note.title}`}
                    className={`flex h-6 w-6 items-center justify-center rounded-md bg-bg/80 transition-colors hover:bg-elevated ${
                      note.pinned ? "text-note" : "text-mute hover:text-text"
                    } ${focusRing}`}
                  >
                    <Icon name="pin" className="h-3 w-3" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )
    ) : tree.length === 0 ? (
      <p className="px-1 py-2 text-xs leading-relaxed text-mute">
        {readOnlyMode ? "No notes in this notebook." : "No notes here yet."}
      </p>
    ) : (
      <NoteTreeList
        tree={tree}
        selectedId={selectedId}
        expanded={expanded}
        readOnly={readOnlyMode}
        onToggle={toggleExpanded}
        onSelect={openNote}
        onAddChild={(parentId) => newNote(parentId)}
        onDelete={(note) => setConfirmDelete(note)}
        canDrop={(id, parentId) => canReparent(notes, id, parentId)}
        onMove={(id, parentId) => void moveNote(id, parentId)}
      />
    );

  /** Sits at the foot of the notebook's own contents, where what it adds goes. */
  const addNoteRow = readOnlyMode ? null : (
    <button
      type="button"
      onClick={() => newNote()}
      title="New note"
      className={`list-row -mx-2 flex w-[calc(100%+1rem)] items-center rounded-lg pr-2 text-left transition-colors hover:bg-surface/40 ${focusRing}`}
      style={{ paddingLeft: "0.5rem" }}
    >
      <span className="flex h-7 w-3.5 shrink-0 items-center justify-center text-note-new">
        <Icon name="plus" className="h-3.5 w-3.5" />
      </span>
      <span className="py-2 pl-2.5 text-xs text-mute transition-colors group-hover:text-text">
        New note
      </span>
    </button>
  );

  const editorOpen = draft !== null;
  const notesInDeletingNotebook = deletingNotebook
    ? notes.filter((note) => resolveNotebookId(note.notebookId) === deletingNotebook.id).length
    : 0;
  const deleteCount = confirmDelete ? noteSubtree(notes, confirmDelete.id).length : 0;

  const editorAction = `flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden bg-bg text-text">
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {error ? (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6">
          {error}
        </p>
      ) : null}

      <div className="sb-shell grid min-h-0 flex-1" style={sidebar.cols}>
        <SidebarDrawer title="Notes" sidebar={sidebar}>
          <SidebarHeader eyebrow="My notes" title="Notes" />

          <div className="mt-5 flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notes"
                aria-label="Search notes"
                className="h-8 w-full min-w-0 rounded-lg border border-line bg-bg pl-8 pr-2.5 text-xs text-text outline-none transition-colors placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
              />
            </div>
            <button
              type="button"
              onClick={() => setPinnedOnly((current) => !current)}
              aria-pressed={pinnedOnly}
              title="Pinned only"
              aria-label="Pinned only"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line transition-colors ${
                pinnedOnly ? "bg-surface text-note" : "text-mute hover:bg-surface/40 hover:text-text"
              } ${focusRing}`}
            >
              <Icon name="pin" className="h-3.5 w-3.5" />
            </button>
          </div>

          <SidebarSection
            label="Notebooks"
            action={
              !readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => setCreatingNotebook(true)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                  aria-label="Add notebook"
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                </button>
              ) : null
            }
          >
            <ContainerList
              items={notebooks}
              selectedId={scope}
              allId={DEFAULT_NOTEBOOK_ID}
              allLabel="All notes"
              protectedId={DEFAULT_NOTEBOOK_ID}
              kindLabel="notebook"
              creating={creatingNotebook}
              onCreateHandled={() => setCreatingNotebook(false)}
              onSelect={(id) => setScope(id)}
              onCreate={(name) => createNotebook(name)}
              onRename={(id, name) => renameNotebook(id, name)}
              onDelete={(notebook) => setDeletingNotebook(notebook)}
              renderMeta={(notebook) => countByNotebook.get(notebook.id) || ""}
              /* The notes are drawn inside their notebook, under its own row, so
                 the two read as one thing rather than as two stacked lists. */
              renderUnder={(notebook) =>
                notebook.id === scope ? (
                  <div className="mb-1 ml-3.5 border-l border-line pb-1 pl-2.5 pt-1">
                    {notebookContents}
                    {addNoteRow}
                  </div>
                ) : null
              }
              showAll={false}
              readOnly={readOnlyMode}
              busy={busy}
            />
          </SidebarSection>
        </SidebarDrawer>

        <section className={`min-w-0 flex-col overflow-hidden lg:flex ${editorOpen ? "flex" : "hidden"}`}>
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
                <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-mute">
                  {breadcrumb.map((title) => (
                    <span key={title} className="flex min-w-0 shrink items-center gap-1">
                      <span className="max-w-[8rem] truncate">{title}</span>
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
                  disabled={readOnlyMode || notebooks.length === 0}
                  className={`h-7 max-w-[9rem] shrink-0 cursor-pointer rounded-md border-0 bg-transparent py-0 pl-2 pr-6 text-[11px] text-mute transition-colors hover:bg-surface hover:text-text disabled:opacity-40 ${focusRing}`}
                >
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
                {!readOnlyMode ? (
                  <button
                    type="button"
                    onClick={() => edit({ pinned: draft.pinned !== true })}
                    aria-pressed={draft.pinned === true}
                    title={draft.pinned ? "Unpin note" : "Pin note"}
                    aria-label={draft.pinned ? "Unpin note" : "Pin note"}
                    className={`${editorAction} ${draft.pinned ? "text-note hover:text-note" : ""}`}
                  >
                    <Icon name="pin" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => triggerDownload(fileNameFor(draft.title), "text/markdown", draft.body)}
                  title="Export as Markdown"
                  aria-label="Export as Markdown"
                  className={editorAction}
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                </button>
                {selected && !readOnlyMode ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(selected)}
                    title="Delete note"
                    aria-label={`Delete ${selected.title}`}
                    className={`${editorAction} hover:text-danger`}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </header>

              <Suspense
                fallback={
                  <div className="min-h-0 flex-1 px-5 pt-7 text-sm text-mute lg:px-10">
                    <div className="note-column">Loading the editor...</div>
                  </div>
                }
              >
                <NoteEditor
                  noteId={editingId.current ?? "none"}
                  value={draft.body}
                  editable={!readOnlyMode}
                  onChange={(body) => edit({ body })}
                  header={
                    <input
                      value={draft.title}
                      onChange={(event) => edit({ title: event.target.value })}
                      placeholder="Untitled note"
                      aria-label="Note title"
                      readOnly={readOnlyMode}
                      className={`w-full border-0 bg-transparent p-0 text-[1.75rem] font-semibold leading-tight tracking-tight text-text outline-none placeholder:text-mute/35 ${focusRing} focus-visible:ring-offset-4`}
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
                {readOnlyMode ? (
                  <span className="shrink-0">Offline</span>
                ) : (
                  <>
                    <span
                      className={`flex shrink-0 items-center gap-1.5 ${saveState === "failed" ? "text-danger" : ""}`}
                      aria-live="polite"
                    >
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          saveState === "failed"
                            ? "bg-danger"
                            : saveState === "clean"
                              ? "bg-note-new"
                              : "bg-note"
                        }`}
                      />
                      {SAVE_LABEL[saveState]}
                    </span>
                    <button
                      type="button"
                      onClick={() => void closeEditor()}
                      className={`hidden h-6 shrink-0 rounded-md px-2 text-[11px] text-mute transition-colors hover:bg-surface hover:text-text lg:block ${focusRing}`}
                    >
                      Close
                    </button>
                  </>
                )}
              </footer>
            </>
          ) : (
            <div className="hidden h-full flex-col items-center justify-center gap-3 text-mute lg:flex">
              <Icon name="notes" className="h-7 w-7 text-mute/35" />
              <p className="text-sm">Select a note to read or edit it.</p>
            </div>
          )}
        </section>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete note"
          heading={`Delete “${confirmDelete.title}”?`}
          body={
            deleteCount > 1
              ? `This permanently removes the note and the ${deleteCount - 1} note${deleteCount === 2 ? "" : "s"} inside it from your encrypted vault across all paired devices. This cannot be undone.`
              : "This permanently removes the note from your encrypted vault across all paired devices. This cannot be undone."
          }
          confirmLabel="Delete note"
          onConfirm={() => void removeNote()}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}

      {deletingNotebook ? (
        <ConfirmDialog
          title="Delete notebook"
          heading={`Delete “${deletingNotebook.name}”?`}
          body={
            notesInDeletingNotebook === 0
              ? "This notebook will be permanently removed from your encrypted vault across all paired devices. This cannot be undone."
              : `This permanently deletes the notebook and its ${notesInDeletingNotebook} note${notesInDeletingNotebook === 1 ? "" : "s"} from your encrypted vault across all paired devices. This cannot be undone.`
          }
          confirmLabel="Delete notebook"
          onConfirm={() => void removeNotebook()}
          onClose={() => setDeletingNotebook(null)}
        />
      ) : null}
    </main>
  );
}
