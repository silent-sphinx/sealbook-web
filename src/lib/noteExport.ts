import { DEFAULT_NOTEBOOK_ID } from "./note";
import type { Note, NoteDraft, Notebook } from "./types";
import {
  coreErrorOf,
  coreNoteParse,
  coreNotesImport,
  coreNotesWriteJson,
  coreNotesWriteMarkdown,
} from "./wasm";
import type { CoreNoteFileEntry } from "../pkg/sealbook_wasm.js";

export type NoteExportFormat = "md" | "json";

export type NoteImportResult = {
  format: "Markdown" | "JSON";
  notes: NoteDraft[];
  /** Notes dropped for being unusable, so the UI can say so rather than lose them quietly. */
  skipped: { title: string; reason: string }[];
};

function entryOf(note: Note): CoreNoteFileEntry {
  return {
    title: note.title,
    body: note.body,
    notebook_id: note.notebookId,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    pinned: note.raw ? coreNoteParse(note.id, note.raw).pinned : undefined,
  };
}

function notebooksOf(notebooks: Notebook[]) {
  return notebooks.map((notebook) => ({
    id: notebook.id,
    name: notebook.name,
    readable: notebook.readable ?? true,
    raw: notebook.raw,
  }));
}

export function serializeNoteBundle(notes: Note[], notebooks: Notebook[]): string {
  return coreNotesWriteMarkdown(notes.map(entryOf), notebooksOf(notebooks));
}

export function serializeNoteJson(notes: Note[], notebooks: Notebook[]): string {
  return coreNotesWriteJson(
    notes.map(entryOf),
    notebooksOf(notebooks),
    new Date().toISOString(),
  );
}

export function generateNoteExportData(
  format: NoteExportFormat,
  notes: Note[],
  notebooks: Notebook[],
): { filename: string; mime: string; data: string } {
  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return {
      filename: `sealbook-notes-backup-${date}.json`,
      mime: "application/json;charset=utf-8",
      data: serializeNoteJson(notes, notebooks),
    };
  }
  return {
    filename: `sealbook-notes-${date}.md`,
    mime: "text/markdown;charset=utf-8",
    data: serializeNoteBundle(notes, notebooks),
  };
}

export function parseNoteImport(
  filename: string,
  content: string,
  targetNotebookId: string = DEFAULT_NOTEBOOK_ID,
): NoteImportResult {
  try {
    const file = coreNotesImport(filename, content, targetNotebookId);
    return {
      format: file.format as NoteImportResult["format"],
      notes: file.notes.map((entry) => ({
        title: entry.title,
        body: entry.body,
        notebookId: entry.notebook_id,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        pinned: entry.pinned,
      })),
      skipped: file.skipped,
    };
  } catch (error) {
    const core = coreErrorOf(error);
    throw core?.kind === "Malformed" ? new Error(core.detail) : error;
  }
}
