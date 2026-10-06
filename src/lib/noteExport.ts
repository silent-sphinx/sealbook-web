import { repairPipeTables } from "./markdown";
import {
  DEFAULT_NOTEBOOK_ID,
  noteFitsObjectLimit,
  notebookNameById,
  resolveNotebookId,
  sortNotes,
} from "./note";
import type { Note, NoteDraft, Notebook } from "./types";

export type NoteExportFormat = "md" | "json";

export type NoteImportResult = {
  format: "Markdown" | "JSON";
  notes: NoteDraft[];
  /** Notes dropped for being unusable, so the UI can say so rather than lose them quietly. */
  skipped: { title: string; reason: string }[];
};

/**
 * A bundle holds many notes in one file, so each needs a boundary a note body
 * cannot produce by accident. A bare `---` will not do: that is a thematic break
 * in markdown. The marker is the `sealbook: note` line immediately after it,
 * which is what the parser looks for.
 */
const MARKER = "sealbook: note";

// Matches the per-account byte quota, because the largest file anyone can
// reasonably import is a full export of their own vault. A tighter limit here
// would let you export a backup you could not restore.
const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
const MAX_IMPORTED_NOTES = 500;

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Accepts the quoted form this writes, and a bare value a person typed. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to the raw value.
    }
  }
  return trimmed;
}

export function serializeNoteBundle(notes: Note[], notebooks: Notebook[]): string {
  return sortNotes(notes)
    .map((note) => {
      const front = [
        "---",
        MARKER,
        `title: ${quote(note.title)}`,
        `notebook: ${quote(notebookNameById(notebooks, note.notebookId))}`,
        `pinned: ${note.pinned === true}`,
      ];
      if (note.createdAt) front.push(`created: ${quote(note.createdAt)}`);
      if (note.updatedAt) front.push(`updated: ${quote(note.updatedAt)}`);
      front.push("---");
      return `${front.join("\n")}\n\n${note.body.replace(/\s+$/u, "")}\n`;
    })
    .join("\n");
}

export function serializeNoteJson(notes: Note[], notebooks: Notebook[]): string {
  return JSON.stringify(
    {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      notebooks: notebooks.map((notebook) => ({ id: notebook.id, name: notebook.name })),
      notes: sortNotes(notes).map((note) => ({
        title: note.title,
        body: note.body,
        notebookId: note.notebookId,
        notebook: notebookNameById(notebooks, note.notebookId),
        pinned: note.pinned === true,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
    },
    null,
    2,
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

function titleFromBody(body: string, fallback: string): { title: string; body: string } {
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first !== -1) {
    const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/u.exec(lines[first]);
    if (heading && heading[1].trim()) {
      // The heading becomes the title rather than being repeated in the body.
      return { title: heading[1].trim(), body: lines.slice(first + 1).join("\n").trim() };
    }
  }
  return { title: fallback, body: body.trim() };
}

function draftFrom(
  title: string,
  body: string,
  notebookId: string,
  extra: { pinned?: boolean; createdAt?: string; updatedAt?: string } = {},
): NoteDraft {
  return {
    title: title.trim() || "Untitled note",
    // Imported text comes from exporters that spell a table loosely, and the
    // editor would otherwise flatten what it cannot read into one paragraph.
    body: repairPipeTables(body),
    notebookId: resolveNotebookId(notebookId),
    pinned: extra.pinned === true,
    createdAt: extra.createdAt,
    updatedAt: extra.updatedAt,
  };
}

function parseMarkdownBundle(
  content: string,
  filename: string,
  targetNotebookId: string,
): NoteDraft[] {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].trim() === "---" && lines[i + 1].trim() === MARKER) starts.push(i);
  }

  // No marker: a markdown file from somewhere else, which is one note.
  if (starts.length === 0) {
    const fallback = filename.replace(/\.[^.]*$/u, "") || "Imported note";
    const { title, body } = titleFromBody(content, fallback);
    return body || title ? [draftFrom(title, body, targetNotebookId)] : [];
  }

  const drafts: NoteDraft[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    let cursor = start + 2;
    const fields: Record<string, string> = {};
    while (cursor < end && lines[cursor].trim() !== "---") {
      const split = lines[cursor].indexOf(":");
      if (split > 0) {
        fields[lines[cursor].slice(0, split).trim().toLowerCase()] = lines[cursor].slice(split + 1);
      }
      cursor += 1;
    }
    const body = lines
      .slice(cursor + 1, end)
      .join("\n")
      .trim();
    const title = fields.title ? unquote(fields.title) : "";
    const resolved = title ? { title, body } : titleFromBody(body, "Untitled note");
    drafts.push(
      draftFrom(resolved.title, resolved.body, targetNotebookId, {
        pinned: fields.pinned?.trim() === "true",
        createdAt: fields.created ? unquote(fields.created) : undefined,
        updatedAt: fields.updated ? unquote(fields.updated) : undefined,
      }),
    );
  }
  return drafts;
}

function parseJsonNotes(parsed: unknown, targetNotebookId: string): NoteDraft[] | null {
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { notes?: unknown }).notes)
      ? (parsed as { notes: unknown[] }).notes
      : null;
  if (!list) return null;

  const drafts: NoteDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const title = typeof entry.title === "string" ? entry.title : "";
    const body = typeof entry.body === "string" ? entry.body : "";
    if (!title.trim() && !body.trim()) continue;
    drafts.push(
      draftFrom(title, body, targetNotebookId, {
        pinned: entry.pinned === true,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : undefined,
      }),
    );
  }
  return drafts;
}

export function parseNoteImport(
  filename: string,
  content: string,
  targetNotebookId: string = DEFAULT_NOTEBOOK_ID,
): NoteImportResult {
  if (content.length > MAX_IMPORT_BYTES) {
    throw new Error("Import file is too large (maximum 128 MB).");
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return { format: "Markdown", notes: [], skipped: [] };
  }

  let format: NoteImportResult["format"] = "Markdown";
  let drafts: NoteDraft[] | null = null;

  if (filename.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      drafts = parseJsonNotes(JSON.parse(trimmed), targetNotebookId);
      if (drafts) format = "JSON";
    } catch {
      // Not JSON after all; read it as markdown.
    }
  }
  if (!drafts) {
    drafts = parseMarkdownBundle(content, filename, targetNotebookId);
  }

  if (drafts.length > MAX_IMPORTED_NOTES) {
    throw new Error(`Import contains too many notes (maximum ${MAX_IMPORTED_NOTES}).`);
  }

  // A note over the object ceiling would be refused by the server partway
  // through the upload, so it is reported here instead.
  const notes: NoteDraft[] = [];
  const skipped: NoteImportResult["skipped"] = [];
  for (const draft of drafts) {
    if (noteFitsObjectLimit(draft)) {
      notes.push(draft);
    } else {
      skipped.push({ title: draft.title, reason: "larger than the 8 MB limit for one note" });
    }
  }
  return { format, notes, skipped };
}
