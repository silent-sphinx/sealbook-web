import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { deleteNote, deleteNotebook, ensureDefaultNotebook, newNoteId, putNote, putNotebook } from "../lib/client";
import type { Session } from "../lib/client";
import { createAutosaver } from "../lib/autosave";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import { parseMarkdown } from "../lib/markdown";
import { applyMarkdown, headingLevelAt, type MarkdownAction } from "../lib/markdownEdit";
import {
  replaceTableLines,
  tableToMarkdown,
  type CellRef,
  type TableModel,
} from "../lib/tableEdit";
import {
  ALL_NOTEBOOKS,
  DEFAULT_NOTEBOOK_ID,
  emptyNoteDraft,
  noteFitsObjectLimit,
  noteMatches,
  notePreview,
  noteWordCount,
  notebookNameById,
  notebookTone,
  resolveNotebookId,
  sortNotes,
} from "../lib/note";
import { focusRing } from "../lib/styles";
import type { Note, NoteDraft, Notebook } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContainerList } from "./ContainerList";
import { Markdown, type MdTableBlock } from "./Markdown";
import { TableEditor } from "./TableEditor";
import { NoteToolbar } from "./NoteToolbar";
import { SidebarDrawer, SidebarTrigger } from "./SidebarDrawer";

type Props = {
  session: Session;
  notes: Note[];
  notebooks: Notebook[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  /** Applies one saved note to the vault list, so autosave need not refetch. */
  onSaved: (note: Note) => void;
  readOnly?: boolean;
};

type Pane = "markdown" | "wysiwyg";

const PANES: { id: Pane; label: string }[] = [
  { id: "markdown", label: "Markdown" },
  { id: "wysiwyg", label: "WYSIWYG" },
];

/** The sidebar carries one selection, a view or a notebook, never both. */
const PINNED_SCOPE = "pinned";

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

function Dot({ id, className = "h-2 w-2" }: { id: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${className} shrink-0 rounded-full`}
      style={{ backgroundColor: notebookTone(id) }}
    />
  );
}

function RailRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing} ${active ? "bg-surface text-text" : "text-mute hover:bg-surface/40 hover:text-text"}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className="shrink-0 text-[10px] tabular-nums text-mute/70">{count || ""}</span>
    </button>
  );
}

export function NotesView({ session, notes, notebooks, busy, onRefresh, onSaved, readOnly }: Props) {
  const readOnlyMode = readOnly === true;
  const [scope, setScope] = useState<string>(ALL_NOTEBOOKS);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [deletingNotebook, setDeletingNotebook] = useState<Notebook | null>(null);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("markdown");

  // The editor buffer. Held here rather than read from `notes` so an in-progress
  // edit is not overwritten by a refresh.
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [caret, setCaret] = useState(0);
  // Which table in the preview is being worked on, and the cell inside it.
  const [tableCell, setTableCell] = useState<(CellRef & { table: number }) | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // The note the editor is on, including one not yet written to the vault.
  const editingId = useRef<string | null>(null);
  const savedThisSession = useRef(false);
  // Set by a toolbar action, applied once React has rendered the new body.
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

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

  // An edit that has not reached the vault must survive a reload attempt, and a
  // write cannot be awaited from `beforeunload`.
  useEffect(() => {
    if (saveState === "clean") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const pinnedCount = useMemo(() => notes.filter((note) => note.pinned === true).length, [notes]);

  const visible = useMemo(() => {
    const inScope =
      scope === ALL_NOTEBOOKS
        ? notes
        : scope === PINNED_SCOPE
          ? notes.filter((note) => note.pinned === true)
          : notes.filter((note) => resolveNotebookId(note.notebookId) === scope);
    return sortNotes(inScope.filter((note) => noteMatches(note, search)));
  }, [notes, scope, search]);

  // Parsed only in preview, and memoised, so typing in a long note never pays for
  // a parse of the whole body.
  const preview = useMemo(
    () => (pane === "wysiwyg" && draft ? parseMarkdown(draft.body) : []),
    [draft, pane],
  );

  // A full pass over the body, so it must not be what a keystroke waits on.
  const countedBody = useDeferredValue(draft?.body ?? "");
  const words = useMemo(() => noteWordCount(countedBody), [countedBody]);

  const headingLevel = draft ? headingLevelAt(draft.body, caret) : 0;

  const scopeLabel =
    scope === ALL_NOTEBOOKS
      ? "All notes"
      : scope === PINNED_SCOPE
        ? "Pinned"
        : notebookNameById(notebooks, scope);

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
    await putNote(session, payload, id);
    const now = new Date().toISOString();
    const createdAt = payload.createdAt ?? now;
    savedThisSession.current = true;
    onSaved({ ...payload, id, raw: "", createdAt, updatedAt: now });
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

  // The caret a toolbar action computed can only be set once its body renders.
  useLayoutEffect(() => {
    const target = pendingSelection.current;
    const node = bodyRef.current;
    if (!target || !node) return;
    pendingSelection.current = null;
    node.focus();
    node.setSelectionRange(target.start, target.end);
    setCaret(target.start);
  }, [draft?.body]);

  function openNote(note: Note) {
    // Flushed, not cancelled: the queue is keyed by note, so the edit being left
    // behind goes out while this one is opened.
    void autosaver.flush();
    editingId.current = note.id;
    setSelectedId(note.id);
    setDraft({
      title: note.title,
      body: note.body,
      notebookId: note.notebookId,
      pinned: note.pinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    setSaveState("clean");
    setPane("markdown");
    setCaret(0);
    setTableCell(null);
    setError(null);
  }

  function newNote() {
    const notebookId =
      scope === ALL_NOTEBOOKS || scope === PINNED_SCOPE
        ? (notebooks[0]?.id ?? DEFAULT_NOTEBOOK_ID)
        : scope;
    void autosaver.flush();
    // The id is issued here so every write for this note is an update.
    editingId.current = newNoteId();
    setSelectedId(null);
    setDraft({ ...emptyNoteDraft(notebookId), pinned: scope === PINNED_SCOPE });
    setSaveState("clean");
    setPane("markdown");
    setCaret(0);
    setTableCell(null);
    setError(null);
    requestAnimationFrame(() => bodyRef.current?.focus());
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

  function applyTableEdit(block: MdTableBlock, next: TableModel) {
    if (!draft || readOnlyMode || !block.line) return;
    edit({ body: replaceTableLines(draft.body, block.line, tableToMarkdown(next)) });
  }

  function runAction(action: MarkdownAction) {
    const node = bodyRef.current;
    if (!node || !draft || readOnlyMode) return;
    const next = applyMarkdown(action, {
      text: draft.body,
      start: node.selectionStart,
      end: node.selectionEnd,
    });
    pendingSelection.current = { start: next.start, end: next.end };
    edit({ body: next.text });
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

  async function removeNote() {
    if (!selected) return;
    setError(null);
    const id = selected.id;
    try {
      autosaver.drop(id);
      // Any write already in flight has to land before the tombstone does.
      await autosaver.flush();
      await deleteNote(session, id);
      setConfirmDeleteNote(false);
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
      await putNotebook(session, name, id);
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
      for (const note of notes.filter(
        (candidate) => resolveNotebookId(candidate.notebookId) === deletingNotebook.id,
      )) {
        autosaver.drop(note.id);
        await deleteNote(session, note.id);
      }
      await deleteNotebook(session, deletingNotebook.id);
      if (scope === deletingNotebook.id) setScope(ALL_NOTEBOOKS);
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

  const editorOpen = draft !== null;
  const notesInDeletingNotebook = deletingNotebook
    ? notes.filter((note) => resolveNotebookId(note.notebookId) === deletingNotebook.id).length
    : 0;

  const editorAction = `flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden bg-bg text-text">
      {error ? (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[14.5rem_20.5rem_minmax(0,1fr)]">
        <SidebarDrawer title="Notebooks" open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">My notes</p>
            <h2 className="mt-1 text-lg font-semibold">Notes</h2>
          </div>

          <div className="mt-7 space-y-0.5">
            <RailRow
              icon={<Icon name="notes" className="h-3.5 w-3.5" />}
              label="All notes"
              count={notes.length}
              active={scope === ALL_NOTEBOOKS}
              onClick={() => { setScope(ALL_NOTEBOOKS); setSidebarOpen(false); }}
            />
            <RailRow
              icon={<Icon name="pin" className="h-3.5 w-3.5" />}
              label="Pinned"
              count={pinnedCount}
              active={scope === PINNED_SCOPE}
              onClick={() => { setScope(PINNED_SCOPE); setSidebarOpen(false); }}
            />
          </div>

          <div className="mt-7 border-t border-line pt-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">Notebooks</p>
              {!readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => setCreatingNotebook(true)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                  aria-label="Add notebook"
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <ContainerList
              items={notebooks}
              selectedId={scope}
              allId={ALL_NOTEBOOKS}
              allLabel="All notes"
              protectedId={DEFAULT_NOTEBOOK_ID}
              kindLabel="notebook"
              creating={creatingNotebook}
              onCreateHandled={() => setCreatingNotebook(false)}
              onSelect={(id) => { setScope(id); setSidebarOpen(false); }}
              onCreate={(name) => createNotebook(name)}
              onRename={(id, name) => renameNotebook(id, name)}
              onDelete={(notebook) => setDeletingNotebook(notebook)}
              renderIcon={(notebook) => <Dot id={notebook.id} className="ml-0.5 mr-0.5 h-2 w-2" />}
              showAll={false}
              readOnly={readOnlyMode}
              busy={busy}
            />
          </div>
        </SidebarDrawer>

        <section
          className={`min-w-0 flex-col overflow-hidden border-line bg-panel/20 lg:flex lg:border-r ${editorOpen ? "hidden" : "flex"}`}
        >
          <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
            <SidebarTrigger label="Notebooks" onClick={() => setSidebarOpen(true)} />
            <div className="relative min-w-0 flex-1">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search in notes"
                aria-label="Search notes"
                className={`h-8 w-full min-w-0 rounded-lg border border-line bg-bg pl-8 pr-2.5 text-xs text-text outline-none transition-colors placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring`}
              />
            </div>
            {!readOnlyMode ? (
              <button
                type="button"
                onClick={newNote}
                title="New note"
                aria-label="New note"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-note-new text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${focusRing}`}
              >
                <Icon name="plus" className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="flex shrink-0 items-baseline gap-2 border-b border-line px-4 pb-2">
            <h1 className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
              {scopeLabel}
            </h1>
            <span className="shrink-0 text-[11px] tabular-nums text-mute/60">{visible.length}</span>
          </div>

          <div className="note-scroll min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="m-4 rounded-xl border border-line bg-panel/25 p-5 text-xs leading-relaxed text-mute">
                {search.trim()
                  ? `No note matches “${search.trim()}”.`
                  : notes.length === 0
                    ? readOnlyMode
                      ? "No notes in this vault yet."
                      : "No notes yet. Use the green button to write your first one."
                    : scope === PINNED_SCOPE
                      ? "Nothing pinned yet."
                      : "This notebook is empty."}
              </p>
            ) : (
              <ul>
                {visible.map((note) => {
                  const active = selectedId === note.id;
                  const edited = note.updatedAt ?? note.createdAt;
                  return (
                    <li key={note.id} className="note-row">
                      <div className={`list-row group relative flex items-stretch transition-colors ${active ? "bg-surface" : "hover:bg-surface/40"}`}>
                        {active ? (
                          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-note" />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openNote(note)}
                          aria-current={active ? "true" : undefined}
                          title={longStamp(edited)}
                          className={`flex min-w-0 flex-1 flex-col items-start gap-1 px-4 py-3 text-left ${focusRing}`}
                        >
                          <span className="text-[10px] tabular-nums tracking-wide text-mute/60">
                            {stamp(edited) ?? "Never edited"}
                          </span>
                          <span className="flex w-full min-w-0 items-center gap-1.5">
                            {note.pinned ? <Icon name="pin" className="h-3 w-3 shrink-0 text-note" /> : null}
                            <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${active ? "text-note" : "text-text"}`}>
                              {note.title}
                            </span>
                          </span>
                          <span className="note-row-preview w-full text-xs leading-relaxed text-mute">
                            {notePreview(note.body) || "Empty note"}
                          </span>
                          {scope === ALL_NOTEBOOKS || scope === PINNED_SCOPE ? (
                            <span className="mt-0.5 flex min-w-0 max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                color: notebookTone(resolveNotebookId(note.notebookId)),
                                backgroundColor: `${notebookTone(resolveNotebookId(note.notebookId))}1f`,
                              }}
                            >
                              <span className="truncate">{notebookNameById(notebooks, note.notebookId)}</span>
                            </span>
                          ) : null}
                        </button>
                        {readOnlyMode ? null : (
                          <span className="list-row-actions absolute right-2 top-2 flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => void togglePinned(note)}
                              title={note.pinned ? "Unpin note" : "Pin note"}
                              aria-label={note.pinned ? `Unpin ${note.title}` : `Pin ${note.title}`}
                              className={`flex h-7 w-7 items-center justify-center rounded-md bg-bg/80 transition-colors hover:bg-elevated ${note.pinned ? "text-note" : "text-mute hover:text-text"} ${focusRing}`}
                            >
                              <Icon name="pin" className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerDownload(fileNameFor(note.title), "text/markdown", note.body)}
                              title="Export as Markdown"
                              aria-label={`Export ${note.title} as Markdown`}
                              className={`flex h-7 w-7 items-center justify-center rounded-md bg-bg/80 text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}
                            >
                              <Icon name="download" className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

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
                <Dot id={resolveNotebookId(draft.notebookId)} className="ml-1 h-2 w-2" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-mute">
                  {draft.title.trim() || "Untitled note"}
                </span>
                <select
                  value={resolveNotebookId(draft.notebookId)}
                  onChange={(event) => edit({ notebookId: event.target.value })}
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
                    onClick={() => setConfirmDeleteNote(true)}
                    title="Delete note"
                    aria-label={`Delete ${selected.title}`}
                    className={`${editorAction} hover:text-danger`}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </header>

              <div className="flex h-11 shrink-0 items-center border-b border-line pr-2">
                <div className="min-w-0 flex-1 self-stretch">
                  {pane === "markdown" ? (
                    <NoteToolbar headingLevel={headingLevel} onAction={runAction} disabled={readOnlyMode} />
                  ) : null}
                </div>
                <div className="ml-1 flex shrink-0 rounded-lg border border-line bg-surface/40 p-0.5">
                  {PANES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPane(item.id)}
                      aria-pressed={pane === item.id}
                      className={`h-6 rounded-md px-2 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${pane === item.id ? "bg-surface text-text" : "text-mute hover:text-text"} ${focusRing}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex shrink-0 justify-center px-5 pt-6 lg:px-10">
                <input
                  value={draft.title}
                  onChange={(event) => edit({ title: event.target.value })}
                  placeholder="Untitled note"
                  aria-label="Note title"
                  readOnly={readOnlyMode}
                  className={`w-full max-w-3xl border-0 bg-transparent p-0 text-[1.75rem] font-semibold leading-tight tracking-tight text-text outline-none placeholder:text-mute/40 ${focusRing} focus-visible:ring-offset-4`}
                />
              </div>

              {pane === "markdown" ? (
                <div className="note-scroll flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pb-4 pt-4 lg:px-10">
                  <textarea
                    ref={bodyRef}
                    value={draft.body}
                    onChange={(event) => { edit({ body: event.target.value }); setCaret(event.target.selectionStart); }}
                    onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                        event.preventDefault();
                        if (!readOnlyMode) void autosaver.flush();
                      }
                    }}
                    placeholder="Write in Markdown. Headings, lists, task items, code and links."
                    aria-label="Note body"
                    readOnly={readOnlyMode}
                    spellCheck
                    className="h-full w-full max-w-3xl resize-none border-0 bg-transparent p-0 text-[0.9375rem] leading-[1.75] text-text outline-none placeholder:text-mute/60"
                  />
                </div>
              ) : (
                <div className="note-scroll md-doc flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pb-10 pt-4 lg:px-10">
                  <div className="w-full max-w-3xl">
                    {draft.body.trim() ? (
                      <Markdown
                        blocks={preview}
                        renderTable={(block, index) => (
                          <TableEditor
                            key={index}
                            block={block}
                            selected={tableCell?.table === index ? tableCell : null}
                            onSelect={(ref) =>
                              setTableCell(ref ? { ...ref, table: index } : null)
                            }
                            onChange={(next) => applyTableEdit(block, next)}
                            readOnly={readOnlyMode}
                          />
                        )}
                      />
                    ) : (
                      <p className="text-sm text-mute">Nothing to preview yet.</p>
                    )}
                  </div>
                </div>
              )}

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

      {confirmDeleteNote && selected ? (
        <ConfirmDialog
          title="Delete note"
          heading={`Delete “${selected.title}”?`}
          body="This permanently removes the note from your encrypted vault across all paired devices. This cannot be undone."
          confirmLabel="Delete note"
          onConfirm={() => void removeNote()}
          onClose={() => setConfirmDeleteNote(false)}
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
