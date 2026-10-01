import { useEffect, useMemo, useRef, useState } from "react";

import { deleteNote, deleteNotebook, ensureDefaultNotebook, putNote, putNotebook } from "../lib/client";
import type { Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import { parseMarkdown } from "../lib/markdown";
import {
  ALL_NOTEBOOKS,
  DEFAULT_NOTEBOOK_ID,
  emptyNoteDraft,
  noteFitsObjectLimit,
  noteMatches,
  notePreview,
  notebookNameById,
  resolveNotebookId,
  sortNotes,
} from "../lib/note";
import { btnPrimary, btnSecondary, fieldBase, focusRing, selectField } from "../lib/styles";
import type { Note, NoteDraft, Notebook } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContainerList } from "./ContainerList";
import { Markdown } from "./Markdown";
import { SidebarDrawer, SidebarTrigger } from "./SidebarDrawer";

type Props = {
  session: Session;
  notes: Note[];
  notebooks: Notebook[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  readOnly?: boolean;
};

type Pane = "edit" | "preview";

function Icon({ name, className = "h-4 w-4" }: { name: "plus" | "pin" | "trash" | "download" | "back" | "search"; className?: string }) {
  const content = {
    plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
    pin: <path d="M8 2.5 9.6 6l3.9.4-2.9 2.6.8 3.8L8 11l-3.4 1.8.8-3.8L2.5 6.4 6.4 6 8 2.5Z" />,
    trash: <path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4.25 4.25 4.75 13a.75.75 0 0 0 .75.7h5a.75.75 0 0 0 .75-.7l.5-8.75" />,
    download: <path d="M8 2.75v7.5M5 7.5 8 10.5l3-3M3 13h10" />,
    back: <path d="M9.5 3.5 5 8l4.5 4.5" />,
    search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.5 10.5 3 3" /></>,
  }[name];
  const resolved =
    name === "search"
      ? `${className} pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute`
      : className;
  return (
    <svg className={resolved} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {content}
    </svg>
  );
}

function editedLabel(note: Note): string {
  const stamp = note.updatedAt ?? note.createdAt;
  if (!stamp) return "Never edited";
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return "Never edited";
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fileNameFor(note: Note): string {
  const base = note.title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "note";
  return `${base.slice(0, 60)}.md`;
}

export function NotesView({ session, notes, notebooks, busy, onRefresh, readOnly }: Props) {
  const readOnlyMode = readOnly === true;
  const [notebookFilter, setNotebookFilter] = useState<string>(ALL_NOTEBOOKS);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [deletingNotebook, setDeletingNotebook] = useState<Notebook | null>(null);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pane, setPane] = useState<Pane>("edit");

  // The editor buffer. Held here rather than read from `notes` so a save is
  // explicit and an in-progress edit is not overwritten by a refresh.
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  // A dirty buffer must survive a reload attempt, since nothing autosaves.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const visible = useMemo(() => {
    const inNotebook =
      notebookFilter === ALL_NOTEBOOKS
        ? notes
        : notes.filter((note) => resolveNotebookId(note.notebookId) === notebookFilter);
    return sortNotes(inNotebook.filter((note) => noteMatches(note, search)));
  }, [notebookFilter, notes, search]);

  // Parsed only in preview, and memoised, so typing in a long note never pays for
  // a parse of the whole body.
  const preview = useMemo(
    () => (pane === "preview" && draft ? parseMarkdown(draft.body) : []),
    [draft, pane],
  );

  function openNote(note: Note) {
    setSelectedId(note.id);
    setDraft({
      title: note.title,
      body: note.body,
      notebookId: note.notebookId,
      pinned: note.pinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    setDirty(false);
    setPane("edit");
    setError(null);
  }

  function newNote() {
    const notebookId =
      notebookFilter === ALL_NOTEBOOKS
        ? (notebooks[0]?.id ?? DEFAULT_NOTEBOOK_ID)
        : notebookFilter;
    setSelectedId(null);
    setDraft(emptyNoteDraft(notebookId));
    setDirty(false);
    setPane("edit");
    setError(null);
    requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function closeEditor() {
    setSelectedId(null);
    setDraft(null);
    setDirty(false);
  }

  function edit(patch: Partial<NoteDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    if (!draft) return false;
    if (!draft.title.trim() && !draft.body.trim()) {
      closeEditor();
      return true;
    }
    if (!noteFitsObjectLimit(draft)) {
      // Otherwise this is a bare 400 from the server, after the upload.
      setError("This note is too large to store. One note can hold about 8 MB.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await putNote(session, draft, selectedId ?? undefined);
      setSelectedId(id);
      setDirty(false);
      await onRefresh();
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    if (!dirty) {
      closeEditor();
      return;
    }
    if (await save()) closeEditor();
  }

  async function togglePinned(note: Note) {
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
    try {
      await deleteNote(session, selected.id);
      setConfirmDeleteNote(false);
      closeEditor();
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
        await deleteNote(session, note.id);
      }
      await deleteNotebook(session, deletingNotebook.id);
      if (notebookFilter === deletingNotebook.id) setNotebookFilter(ALL_NOTEBOOKS);
      setDeletingNotebook(null);
      closeEditor();
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  const editorOpen = draft !== null;
  const notesInDeletingNotebook = deletingNotebook
    ? notes.filter((note) => resolveNotebookId(note.notebookId) === deletingNotebook.id).length
    : 0;

  return (
    <main className="flex flex-col bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:h-[calc(100dvh-var(--sb-header-h,74px))] lg:overflow-hidden lg:pb-0">
      <div className="grid min-h-0 flex-1 lg:h-full lg:grid-cols-[244px_minmax(0,1fr)]">
        <SidebarDrawer title="Notebooks" open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">My notes</p>
              <h2 className="mt-1 text-lg font-semibold">Notes</h2>
            </div>
            {!readOnlyMode ? (
              <button
                type="button"
                onClick={() => { newNote(); setSidebarOpen(false); }}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-text transition-colors hover:border-line-light hover:bg-elevated ${focusRing}`}
                aria-label="Create note"
              >
                <Icon name="plus" />
              </button>
            ) : null}
          </div>
          <div className="mt-8 border-t border-line pt-5">
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
              selectedId={notebookFilter}
              allId={ALL_NOTEBOOKS}
              allLabel="All notes"
              protectedId={DEFAULT_NOTEBOOK_ID}
              kindLabel="notebook"
              creating={creatingNotebook}
              onCreateHandled={() => setCreatingNotebook(false)}
              onSelect={(id) => { setNotebookFilter(id); setSidebarOpen(false); }}
              onCreate={(name) => createNotebook(name)}
              onRename={(id, name) => renameNotebook(id, name)}
              onDelete={(notebook) => setDeletingNotebook(notebook)}
              readOnly={readOnlyMode}
              busy={busy}
            />
          </div>
        </SidebarDrawer>

        <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
          <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6 lg:py-3.5">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger label="Notebooks" onClick={() => setSidebarOpen(true)} />
              <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
                {notebookFilter === ALL_NOTEBOOKS ? "All notes" : notebookNameById(notebooks, notebookFilter)}
              </h1>
              <span
                className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute"
                title={`${visible.length} note${visible.length === 1 ? "" : "s"}`}
              >
                {visible.length}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {!readOnlyMode ? (
                <button
                  type="button"
                  onClick={newNote}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] sm:px-3.5 ${focusRing}`}
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New note</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                <Icon name="search" className="h-3.5 w-3.5" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search notes"
                  aria-label="Search notes"
                  className={`${fieldBase} h-8 pl-9 text-xs`}
                />
              </div>
            </div>
          </header>

          {error ? (
            <p role="alert" className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6">
              {error}
            </p>
          ) : null}

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
            <div className={`min-w-0 overflow-y-auto px-4 py-4 lg:border-r lg:border-line lg:px-6 ${editorOpen ? "hidden lg:block" : ""}`}>
              {visible.length === 0 ? (
                <p className="rounded-xl border border-line bg-panel/25 p-6 text-sm text-mute">
                  {search.trim()
                    ? `No note matches “${search.trim()}”.`
                    : notes.length === 0
                      ? readOnlyMode
                        ? "No notes in this vault yet."
                        : "No notes yet. Use New note to write your first one."
                      : "This notebook is empty."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {visible.map((note) => (
                    <li key={note.id}>
                      <div className={`list-row group flex items-center rounded-xl pr-2 transition-colors ${selectedId === note.id ? "bg-surface" : "hover:bg-surface/40"}`}>
                        <button
                          type="button"
                          onClick={() => openNote(note)}
                          aria-current={selectedId === note.id ? "true" : undefined}
                          className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left ${focusRing}`}
                        >
                          <span className="flex w-full min-w-0 items-center gap-1.5">
                            {note.pinned ? (
                              <Icon name="pin" className="h-3 w-3 shrink-0 text-accent" />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title}</span>
                          </span>
                          <span className="min-w-0 max-w-full truncate text-xs text-mute">
                            {notePreview(note.body) || "Empty note"}
                          </span>
                          <span className="text-[11px] text-mute/80">
                            {editedLabel(note)}
                            {notebookFilter === ALL_NOTEBOOKS
                              ? ` · ${notebookNameById(notebooks, note.notebookId)}`
                              : ""}
                          </span>
                        </button>
                        {readOnlyMode ? null : (
                          <span className="list-row-actions flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => void togglePinned(note)}
                              title={note.pinned ? "Unpin note" : "Pin note"}
                              aria-label={note.pinned ? `Unpin ${note.title}` : `Pin ${note.title}`}
                              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-elevated ${note.pinned ? "text-accent" : "text-mute hover:text-text"} ${focusRing}`}
                            >
                              <Icon name="pin" className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerDownload(fileNameFor(note), "text/markdown", note.body)}
                              title="Export as Markdown"
                              aria-label={`Export ${note.title} as Markdown`}
                              className={`flex h-7 w-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}
                            >
                              <Icon name="download" className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`min-w-0 flex-col overflow-hidden px-4 py-4 lg:flex lg:px-6 ${editorOpen ? "flex" : "hidden"}`}>
              {draft ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveAndClose()}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-mute transition-colors hover:border-line-light hover:bg-surface hover:text-text lg:hidden ${focusRing}`}
                      aria-label="Back to notes"
                    >
                      <Icon name="back" className="h-3.5 w-3.5" />
                    </button>
                    <input
                      value={draft.title}
                      onChange={(event) => edit({ title: event.target.value })}
                      placeholder="Title"
                      aria-label="Note title"
                      readOnly={readOnlyMode}
                      className={`${fieldBase} text-base font-semibold`}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={resolveNotebookId(draft.notebookId)}
                      onChange={(event) => edit({ notebookId: event.target.value })}
                      aria-label="Notebook"
                      disabled={readOnlyMode || notebooks.length === 0}
                      className={`${selectField} h-8 w-auto text-xs`}
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
                        className={`flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs transition-colors hover:border-line-light hover:bg-surface ${draft.pinned ? "text-accent" : "text-mute hover:text-text"} ${focusRing}`}
                      >
                        <Icon name="pin" className="h-3.5 w-3.5" />
                        {draft.pinned ? "Pinned" : "Pin"}
                      </button>
                    ) : null}
                    <div className="ml-auto flex shrink-0 rounded-xl border border-line bg-surface/40 p-1">
                      {(["edit", "preview"] as Pane[]).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setPane(item)}
                          className={`h-6 rounded-lg px-2.5 text-[11px] capitalize transition-colors ${pane === item ? "bg-surface font-medium text-text" : "text-mute hover:text-text"} ${focusRing}`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  {pane === "edit" ? (
                    <textarea
                      ref={bodyRef}
                      value={draft.body}
                      onChange={(event) => edit({ body: event.target.value })}
                      placeholder="Write in Markdown. Headings, lists, task items, code and links."
                      aria-label="Note body"
                      readOnly={readOnlyMode}
                      spellCheck
                      className="min-h-[18rem] flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed text-text outline-none transition-colors placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                    />
                  ) : (
                    <div className="min-h-[18rem] flex-1 overflow-y-auto rounded-lg border border-line bg-panel/25 px-4 py-3">
                      {draft.body.trim() ? (
                        <Markdown blocks={preview} />
                      ) : (
                        <p className="text-sm text-mute">Nothing to preview yet.</p>
                      )}
                    </div>
                  )}

                  {readOnlyMode ? (
                    <p className="text-xs text-mute">Editing is unavailable while offline.</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void save()} disabled={saving || !dirty} className={btnPrimary}>
                        {saving ? "Saving..." : dirty ? "Save" : "Saved"}
                      </button>
                      <button type="button" onClick={() => void saveAndClose()} className={btnSecondary}>
                        Close
                      </button>
                      {selected ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteNote(true)}
                          title="Delete note"
                          aria-label={`Delete ${selected.title}`}
                          className={`ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-danger ${focusRing}`}
                        >
                          <Icon name="trash" />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : (
                <div className="hidden h-full items-center justify-center rounded-xl border border-dashed border-line text-sm text-mute lg:flex">
                  Select a note to read or edit it.
                </div>
              )}
            </div>
          </div>
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
