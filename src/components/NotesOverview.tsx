import { useMemo } from "react";

import { useItemSelection } from "../lib/useItemSelection";

import { DEFAULT_NOTEBOOK_ID, notebookTone, notePreview, resolveNotebookId, sortNotes } from "../lib/note";
import { btnHeader, eyebrow, focusRing, paneCount, paneHeader, paneTitle } from "../lib/styles";
import type { Note, Notebook } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { NoteBulkBar, NotePick, useNoteMenu } from "./NoteBulkBar";
import { NoteSearchField } from "./NoteSearchField";
import { Icon } from "./Icon";

const RECENT_LIMIT = 12;

type Props = {
  notebooks: Notebook[];
  notes: Note[];
  search: string;
  onSearch: (search: string) => void;
  /** The notes matching the search, in every notebook; null when not searching. */
  results: Note[] | null;
  /** The search as typed and settled, for saying what matched nothing. */
  query: string;
  onOpenNotebook: (id: string) => void;
  /** A dialog is open, so Escape and Ctrl+A are left to it. */
  dialogOpen: boolean;
  onOpenNote: (note: Note) => void;
  onNewNote: () => void;
  onMoveNotes: (notes: Note[], notebookId: string) => void;
  onDeleteNotes: (notes: Note[]) => void;
  onRenameNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onRenameNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
};

function day(iso: string | undefined): string {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function NotebookCover({ notebook, count, onOpen, onContextMenu }: { notebook: Notebook; count: number; onOpen: () => void; onContextMenu: (event: React.MouseEvent) => void }) {
  const tone = notebookTone(notebook.id, notebook.color);
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      aria-label={`${notebook.name}, ${count} ${count === 1 ? "note" : "notes"}`}
      className={`group relative flex aspect-[3/4] w-full overflow-hidden rounded-r-xl rounded-l-sm border border-line bg-surface text-left shadow-md shadow-black/30 transition-transform hover:-translate-y-0.5 ${focusRing}`}
    >
      <span aria-hidden="true" className="w-3 shrink-0 opacity-80" style={{ backgroundColor: tone }} />
      <span aria-hidden="true" className="absolute inset-y-0 left-3 w-px bg-black/30" />
      <span
        aria-hidden="true"
        className="absolute inset-y-4 right-3 w-1.5 rounded-sm opacity-50"
        style={{ backgroundColor: tone }}
      />
      <span className="flex min-w-0 flex-1 flex-col justify-between p-3 pr-6">
        <span className="rounded-sm border border-line bg-bg/60 px-2 py-2 text-sm font-medium leading-snug text-text [overflow-wrap:anywhere]">
          {notebook.name}
        </span>
        <span className="text-[11px] text-mute">
          {count} {count === 1 ? "note" : "notes"}
        </span>
      </span>
    </button>
  );
}

export function NotesOverview({ notebooks, notes, search, onSearch, results, query, dialogOpen, onOpenNotebook, onOpenNote, onNewNote, onMoveNotes, onDeleteNotes, onRenameNote, onDeleteNote, onRenameNotebook, onDeleteNotebook }: Props) {
  const notebookMenu = useContextMenu();
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const note of notes) {
      const id = resolveNotebookId(note.notebookId);
      result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
  }, [notes]);
  const recent = useMemo(() => sortNotes(notes).slice(0, RECENT_LIMIT), [notes]);
  const names = useMemo(() => new Map(notebooks.map((notebook) => [notebook.id, notebook.name])), [notebooks]);

  const listed = results ?? recent;
  const selection = useItemSelection(listed, { paused: dialogOpen });
  const noteMenu = useNoteMenu({
    notebooks,
    selection,
    onOpen: onOpenNote,
    onRename: onRenameNote,
    onDelete: onDeleteNote,
    onMoveNotes,
    onDeleteNotes,
  });

  return (
    <div className="flex h-full flex-col">
      {noteMenu.element}
      <ContextMenu state={notebookMenu.menu} onClose={notebookMenu.close} />
      <header className={paneHeader}>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className={paneTitle}>All notes</h1>
          <span className={paneCount}>{notes.length}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={onNewNote} className={btnHeader}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New note
          </button>
          <NoteSearchField value={search} onChange={onSearch} />
        </div>
      </header>
      {selection.selecting ? (
        <NoteBulkBar
          selected={selection.selected.size}
          total={listed.length}
          notebooks={notebooks}
          onToggleAll={selection.toggleAll}
          onMove={(notebookId) => {
            onMoveNotes(selection.selectedItems, notebookId);
            selection.clear();
          }}
          onDelete={() => onDeleteNotes(selection.selectedItems)}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
        {results ? null : (
        <section aria-labelledby="overview-notebooks">
          <h2 id="overview-notebooks" className={`mb-3 ${eyebrow}`}>
            Notebooks
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-5">
            {notebooks.map((notebook) => (
              <li key={notebook.id}>
                <NotebookCover
                  notebook={notebook}
                  count={counts.get(notebook.id) ?? 0}
                  onOpen={() => onOpenNotebook(notebook.id)}
                  onContextMenu={(event) =>
                    notebookMenu.open(event, [
                      { label: "Open notebook", onSelect: () => onOpenNotebook(notebook.id) },
                      { label: "Rename notebook", onSelect: () => onRenameNotebook(notebook) },
                      ...(notebook.id === DEFAULT_NOTEBOOK_ID
                        ? []
                        : [{ label: "Delete notebook", danger: true, onSelect: () => onDeleteNotebook(notebook) }]),
                    ])
                  }
                />
              </li>
            ))}
          </ul>
        </section>
        )}

        <section aria-labelledby="overview-recent">
          <h2 id="overview-recent" className={`mb-3 ${eyebrow}`}>
            {results ? "Results" : "Recently modified"}
          </h2>
          {results && results.length === 0 ? (
            <EmptyState title={`No note matches “${query}”.`} className="rounded-lg border border-dashed border-line" />
          ) : listed.length === 0 ? (
            <EmptyState title="No notes yet" body="Notes are encrypted on this device before they leave it." className="rounded-lg border border-dashed border-line" />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {listed.map((note) => (
                // The context menu is a pointer shortcut; from the keyboard it
                // opens with the menu key on the focused button inside.
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <li
                  key={note.id}
                  onContextMenu={(event) => noteMenu.onContextMenu(event, note)}
                  className={`group flex items-center gap-4 pl-3 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                    selection.isSelected(note.id) ? "bg-accent/10" : "hover:bg-surface/40"
                  }`}
                >
                  <NotePick
                    title={note.title || "Untitled note"}
                    selecting={selection.selecting}
                    picked={selection.isSelected(note.id)}
                    onClick={(event) =>
                      selection.selecting ? selection.toggle(note, event.shiftKey) : selection.begin(note)
                    }
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      if (selection.selecting) selection.toggle(note, event.shiftKey);
                      else if (event.ctrlKey || event.metaKey) selection.begin(note);
                      else onOpenNote(note);
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-4 py-2 pr-3 text-left ${focusRing}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{note.title}</span>
                      <span className="block truncate text-xs text-mute">
                        {notePreview(note.body, 100) || "Empty note"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-mute sm:block">
                      {names.get(resolveNotebookId(note.notebookId)) ?? ""}
                    </span>
                    <span className="shrink-0 text-[11px] text-mute">{day(note.updatedAt ?? note.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="sr-only">Select a note to read or edit it.</p>
      </div>
    </div>
  );
}
