import { useMemo } from "react";

import { notePreview, resolveNotebookId, sortNotes } from "../lib/note";
import { focusRing } from "../lib/styles";
import type { Note, Notebook } from "../lib/types";

const RECENT_LIMIT = 12;

type Props = {
  notebooks: Notebook[];
  notes: Note[];
  onOpenNotebook: (id: string) => void;
  onOpenNote: (note: Note) => void;
};

function day(iso: string | undefined): string {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function NotebookCover({ notebook, count, onOpen }: { notebook: Notebook; count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${notebook.name}, ${count} ${count === 1 ? "note" : "notes"}`}
      className={`group relative flex aspect-[3/4] w-full overflow-hidden rounded-r-xl rounded-l-sm border border-line bg-surface text-left shadow-md shadow-black/30 transition-transform hover:-translate-y-0.5 ${focusRing}`}
    >
      <span aria-hidden="true" className="w-3 shrink-0 bg-accent-dim/70" />
      <span aria-hidden="true" className="absolute inset-y-0 left-3 w-px bg-black/30" />
      <span aria-hidden="true" className="absolute inset-y-4 right-3 w-1.5 rounded-sm bg-accent-dim/40" />
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

export function NotesOverview({ notebooks, notes, onOpenNotebook, onOpenNote }: Props) {
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

  return (
    <div className="hidden h-full flex-col gap-8 overflow-y-auto p-6 lg:flex">
      <section aria-labelledby="overview-notebooks">
        <h2 id="overview-notebooks" className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-mute">
          Notebooks
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-5">
          {notebooks.map((notebook) => (
            <li key={notebook.id}>
              <NotebookCover
                notebook={notebook}
                count={counts.get(notebook.id) ?? 0}
                onOpen={() => onOpenNotebook(notebook.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="overview-recent">
        <h2 id="overview-recent" className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-mute">
          Recently modified
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-mute">Select a note to read or edit it.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {recent.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onOpenNote(note)}
                  className={`flex w-full items-baseline gap-4 px-3 py-2 text-left transition-colors hover:bg-surface/40 ${focusRing}`}
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
      {recent.length > 0 ? <p className="sr-only">Select a note to read or edit it.</p> : null}
    </div>
  );
}
