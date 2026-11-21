import { Fragment, useMemo, useState } from "react";

import { useItemSelection } from "../lib/useItemSelection";

import { ancestorsOf } from "../lib/tree";
import { notePreview, resolveNotebookId, sortNotes } from "../lib/note";
import { btnPrimarySm, btnSecondary, focusRing, paneCount, paneHeader, paneTitle } from "../lib/styles";
import type { Note, Notebook } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { NoteBulkBar, NotePick, useNoteMenu } from "./NoteBulkBar";
import { NoteSearchField } from "./NoteSearchField";
import { Icon } from "./Icon";
import { SidebarToggle, type Sidebar } from "./SidebarDrawer";
import { SegmentedControl } from "./PaneControls";

type Props = {
  sidebar: Sidebar;
  notebook: Notebook;
  notes: Note[];
  notebooks: Notebook[];
  search: string;
  onSearch: (search: string) => void;
  /** The notes matching the search, across every notebook; null when not searching. */
  results: Note[] | null;
  /** The search as typed and settled, for saying what matched nothing. */
  query: string;
  /** A dialog is open, so Escape and Ctrl+A are left to it. */
  dialogOpen: boolean;
  onBack: () => void;
  /** Open a notebook this one sits under. */
  onOpenNotebook: (id: string) => void;
  onOpenNote: (note: Note) => void;
  onNewNote: () => void;
  onMoveNotes: (notes: Note[], notebookId: string) => void;
  onCreateNotebook: (name: string) => Promise<string | undefined>;
  onDeleteNotes: (notes: Note[]) => void;
  onRenameNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
};

type PagesView = "grid" | "table";

const VIEW_STORAGE_KEY = "sealbook.notes.pages-view";
const VIEWS: { id: PagesView; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "table", label: "Table" },
];

function loadView(): PagesView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
}

function storeView(view: PagesView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage unavailable; the choice then lasts for this session only.
  }
}

function day(iso: string | undefined): string {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function NotebookPages({ sidebar, notebook, notes, notebooks, search, onSearch, results, query, dialogOpen, onBack, onOpenNotebook, onOpenNote, onNewNote, onMoveNotes, onCreateNotebook, onDeleteNotes, onRenameNote, onDeleteNote }: Props) {
  // Root first. Past two ancestors the middle ones fold into an ellipsis.
  const trail = useMemo(() => {
    const byId = new Map(notebooks.map((candidate) => [candidate.id, candidate]));
    return ancestorsOf(notebooks, notebook.id)
      .reverse()
      .flatMap((id) => byId.get(id) ?? []);
  }, [notebooks, notebook.id]);
  const folded = trail.length > 2 ? trail.slice(1, -1) : [];
  const shown = trail.length > 2 ? [trail[0], trail[trail.length - 1]] : trail;

  const pages = useMemo(() => {
    const hits = results ? new Set(results.map((note) => note.id)) : null;
    return sortNotes(
      notes.filter(
        (note) => resolveNotebookId(note.notebookId) === notebook.id && (!hits || hits.has(note.id)),
      ),
    );
  }, [notes, notebook.id, results]);

  const selection = useItemSelection(pages, { paused: dialogOpen });
  const [view, setView] = useState<PagesView>(loadView);
  const noteMenu = useNoteMenu({
    notebooks,
    selection,
    onOpen: onOpenNote,
    onRename: onRenameNote,
    onDelete: onDeleteNote,
    onMoveNotes,
    onDeleteNotes,
  });

  function open(note: Note, event: React.MouseEvent) {
    if (selection.selecting) selection.toggle(note, event.shiftKey);
    else if (event.ctrlKey || event.metaKey) selection.begin(note);
    else onOpenNote(note);
  }

  function pick(note: Note, event: React.MouseEvent) {
    if (selection.selecting) selection.toggle(note, event.shiftKey);
    else selection.begin(note);
  }

  return (
    <div className="flex h-full flex-col">
      {noteMenu.element}
      <header className={paneHeader}>
        <div className="flex min-w-0 items-center gap-2">
          <SidebarToggle sidebar={sidebar} />
          <button
            type="button"
            onClick={onBack}
            aria-label="All notebooks"
            className={`flex shrink-0 items-center rounded-md text-base font-semibold tracking-tight text-mute transition-colors hover:text-text ${focusRing}`}
          >
            <Icon name="chevron" className="h-3.5 w-3.5 rotate-180 sm:hidden" />
            <span className="hidden sm:inline">All notebooks</span>
          </button>
          {shown.map((ancestor, index) => (
            <Fragment key={ancestor.id}>
              <span aria-hidden="true" className="hidden text-mute/50 sm:inline">/</span>
              {index === 1 && folded.length > 0 ? (
                <>
                  <span title={folded.map((book) => book.name).join(" / ")} className="hidden shrink-0 text-base font-semibold text-mute sm:inline">
                    …
                  </span>
                  <span aria-hidden="true" className="hidden text-mute/50 sm:inline">/</span>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => onOpenNotebook(ancestor.id)}
                className={`hidden min-w-0 max-w-40 truncate rounded-md text-base font-semibold tracking-tight text-mute transition-colors hover:text-text sm:block ${focusRing}`}
              >
                {ancestor.name}
              </button>
            </Fragment>
          ))}
          <span aria-hidden="true" className="hidden text-mute/50 sm:inline">/</span>
          <h1 className={`min-w-0 ${paneTitle}`}>{notebook.name}</h1>
          <span className={paneCount}>{pages.length}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={onNewNote} className={btnPrimarySm}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New note
          </button>
          <SegmentedControl
            label="View"
            options={VIEWS.map(({ id, label }) => ({ value: id, label }))}
            value={view}
            onChange={(id) => {
              setView(id);
              storeView(id);
            }}
          />
          <NoteSearchField value={search} onChange={onSearch} />
        </div>
      </header>
      {selection.selecting ? (
        <NoteBulkBar
          selected={selection.selected.size}
          total={pages.length}
          notebooks={notebooks}
          onToggleAll={selection.toggleAll}
          onClear={selection.clear}
          onMove={(notebookId) => {
            onMoveNotes(selection.selectedItems, notebookId);
            selection.clear();
          }}
          onCreateNotebook={onCreateNotebook}
          onDelete={() => onDeleteNotes(selection.selectedItems)}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {pages.length === 0 && results ? (
          <EmptyState title={`No note here matches “${query}”.`} />
        ) : pages.length === 0 ? (
          <EmptyState
            title="No pages yet"
            body="Pages you add to this notebook appear here."
            action={
              <button type="button" onClick={onNewNote} className={btnSecondary}>
                New note
              </button>
            }
          />
        ) : view === "table" ? (
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="text-2xs uppercase tracking-[0.14em] text-mute">
              <tr className="border-b border-line">
                <th scope="col" className="w-10 py-2 font-semibold">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">Title</th>
                <th scope="col" className="hidden py-2 pr-3 font-semibold md:table-cell">Preview</th>
                <th scope="col" className="hidden w-28 py-2 pr-3 font-semibold sm:table-cell">Modified</th>
                <th scope="col" className="hidden w-28 py-2 font-semibold lg:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((note) => (
                <tr
                  key={note.id}
                  onContextMenu={(event) => noteMenu.onContextMenu(event, note)}
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest("button")) open(note, event);
                  }}
                  className={`group cursor-pointer border-b border-line/60 transition-colors ${
                    selection.isSelected(note.id) ? "bg-accent/10" : "hover:bg-surface/40"
                  }`}
                >
                  <td className="py-2 pl-1">
                    <NotePick
                      title={note.title || "Untitled note"}
                      selecting={selection.selecting}
                      picked={selection.isSelected(note.id)}
                      onClick={(event) => pick(note, event)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={(event) => open(note, event)}
                      className={`block w-full truncate rounded-md text-left font-medium ${focusRing}`}
                    >
                      {note.title || "Untitled note"}
                    </button>
                  </td>
                  <td className="hidden truncate py-2 pr-3 text-xs text-mute md:table-cell">
                    {notePreview(note.body, 120) || "Empty note"}
                  </td>
                  <td className="hidden py-2 pr-3 text-xs text-mute sm:table-cell">
                    {day(note.updatedAt ?? note.createdAt)}
                  </td>
                  <td className="hidden py-2 text-xs text-mute lg:table-cell">{day(note.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
            {pages.map((note) => (
              // The context menu is a pointer shortcut; from the keyboard it
              // opens with the menu key on the focused button inside.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li key={note.id} className="group relative" onContextMenu={(event) => noteMenu.onContextMenu(event, note)}>
                <button
                  type="button"
                  onClick={(event) => open(note, event)}
                  className={`flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-md border bg-surface p-3 text-left shadow-sm shadow-black/20 transition-transform hover:-translate-y-0.5 ${
                    selection.isSelected(note.id) ? "border-accent ring-1 ring-accent" : "border-line"
                  } ${focusRing}`}
                >
                  <span className="truncate text-sm font-medium">{note.title}</span>
                  <span className="line-clamp-4 flex-1 text-xs leading-relaxed text-mute">
                    {notePreview(note.body, 200) || "Empty note"}
                  </span>
                  <span className="text-2xs text-mute">{day(note.updatedAt ?? note.createdAt)}</span>
                </button>
                <NotePick
                  title={note.title || "Untitled note"}
                  selecting={selection.selecting}
                  picked={selection.isSelected(note.id)}
                  onClick={(event) => pick(note, event)}
                  className="absolute right-2 top-2"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
