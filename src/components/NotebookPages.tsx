import { useMemo } from "react";

import { notePreview, resolveNotebookId, sortNotes } from "../lib/note";
import { focusRing } from "../lib/styles";
import type { Note, Notebook } from "../lib/types";

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
    <div className="hidden h-full flex-col lg:flex">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <button
          type="button"
          onClick={onBack}
          className={`rounded px-1 text-xs text-mute transition-colors hover:text-text ${focusRing}`}
        >
          All notebooks
        </button>
        <span aria-hidden="true" className="text-xs text-mute">/</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{notebook.name}</h2>
        <button
          type="button"
          onClick={onNewNote}
          className={`h-7 shrink-0 rounded-md px-2.5 text-xs text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
        >
          New note
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {pages.length === 0 ? (
          <p className="text-sm text-mute">This notebook has no pages yet.</p>
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
