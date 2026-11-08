import { useMemo } from "react";

import { notePreview, resolveNotebookId, sortNotes } from "../lib/note";
import { btnHeader, btnSecondary, focusRing, paneCount, paneHeader, paneTitle } from "../lib/styles";
import type { Note, Notebook } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

type Props = {
  notebook: Notebook;
  notes: Note[];
  onBack: () => void;
  onOpenNote: (note: Note) => void;
  onNewNote: () => void;
};

function day(iso: string | undefined): string {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function NotebookPages({ notebook, notes, onBack, onOpenNote, onNewNote }: Props) {
  const pages = useMemo(
    () => sortNotes(notes.filter((note) => resolveNotebookId(note.notebookId) === notebook.id)),
    [notes, notebook.id],
  );

  return (
    <div className="flex h-full flex-col">
      <header className={paneHeader}>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="All notebooks"
            className={`flex shrink-0 items-center rounded text-base font-semibold tracking-tight text-mute transition-colors hover:text-text ${focusRing}`}
          >
            <Icon name="chevron" className="h-3.5 w-3.5 rotate-180 sm:hidden" />
            <span className="hidden sm:inline">All notebooks</span>
          </button>
          <span aria-hidden="true" className="hidden text-mute/50 sm:inline">/</span>
          <h1 className={`min-w-0 ${paneTitle}`}>{notebook.name}</h1>
          <span className={paneCount}>{pages.length}</span>
        </div>
        <button type="button" onClick={onNewNote} className={btnHeader}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          New note
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {pages.length === 0 ? (
          <EmptyState
            title="No pages yet"
            body="Pages you add to this notebook appear here."
            action={
              <button type="button" onClick={onNewNote} className={btnSecondary}>
                New note
              </button>
            }
          />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
            {pages.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onOpenNote(note)}
                  className={`flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-md border border-line bg-surface p-3 text-left shadow-sm shadow-black/20 transition-transform hover:-translate-y-0.5 ${focusRing}`}
                >
                  <span className="truncate text-sm font-medium">{note.title}</span>
                  <span className="line-clamp-4 flex-1 text-xs leading-relaxed text-mute">
                    {notePreview(note.body, 200) || "Empty note"}
                  </span>
                  <span className="text-[11px] text-mute">{day(note.updatedAt ?? note.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
