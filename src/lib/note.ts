import { stripMarkdown } from "./markdown";
import type { Note, NoteAttachment, NoteDraft, Notebook } from "./types";
import {
  coreNoteParse,
  coreNoteWrite,
  coreNotebookNameById,
  coreNotebookTone,
  coreNotebookParse,
  coreNotebookWrite,
  coreResolveNotebookId,
} from "./wasm";
import type { CoreNote, CoreNoteAttachment, CoreNotebook } from "./wasm";
import { sortByRecency, sortContainers } from "./order";

// Mirrors of the Rust constants in `sealbook-core`'s `notes` module. They stay
// literals here because module scope runs before `initWasm`, and
// `noteParity.test.ts` asserts every one of them against core so they cannot
// drift. Same arrangement as `ATTACHMENT_CHUNK_SIZE` in `attachments.ts`.
export const NOTE_CONTENT_TYPE = "application/sealbook.note+json";
export const NOTEBOOK_CONTENT_TYPE = "application/sealbook.notebook+json";
export const DEFAULT_NOTEBOOK_NAME = "Default Notebook";
export const DEFAULT_NOTEBOOK_ID = "00000000-0000-0000-0000-000000000002";
export const ALL_NOTEBOOKS = "all";
export const UNTITLED_NOTE_TITLE = "Untitled note";
export const UNREADABLE_NOTE_TITLE = "Unreadable note";
export const UNTITLED_NOTEBOOK_NAME = "Untitled";

/**
 * This client's view of an attachment entry, from core's.
 *
 * `extra` is whatever the stored entry carried that core does not name, and it
 * rides along unread so a write puts it back: `displayWidth` was added after
 * `thumbnail`, and a build that rebuilt each entry from its own fields dropped
 * it from every photo it touched.
 */
export function attachmentFrom(entry: CoreNoteAttachment): NoteAttachment {
  return {
    id: entry.id,
    filename: entry.filename,
    mimeType: entry.mime_type,
    byteSize: entry.byte_size,
    width: entry.width,
    height: entry.height,
    adk: entry.adk,
    contentHash: entry.content_hash,
    chunkSize: entry.chunk_size,
    chunkCount: entry.chunk_count,
    displayWidth: entry.display_width,
    thumbnail: entry.thumbnail,
    extra: entry.extra,
  };
}

export function attachmentTo(entry: NoteAttachment): CoreNoteAttachment {
  return {
    id: entry.id,
    filename: entry.filename,
    mime_type: entry.mimeType,
    byte_size: entry.byteSize,
    width: entry.width,
    height: entry.height,
    adk: entry.adk,
    content_hash: entry.contentHash,
    chunk_size: entry.chunkSize,
    chunk_count: entry.chunkCount,
    display_width: entry.displayWidth,
    thumbnail: entry.thumbnail,
    extra: entry.extra ?? "{}",
  };
}

/**
 * Writes a note's plaintext through core, which every client now does.
 *
 * `pinned` is passed through as `undefined` rather than left off: this client
 * removed favouriting, so an edit must neither write the key nor strip the
 * values Android wrote, and `undefined` is what tells core to leave it as
 * stored. Only an import carrying a pin sets it.
 */
export function serializeNote(draft: NoteDraft): string {
  return coreNoteWrite(
    {
      title: draft.title,
      body: draft.body,
      notebook_id: draft.notebookId,
      parent_id: draft.parentId,
      attachments: (draft.attachments ?? []).map(attachmentTo),
      created_at: draft.createdAt,
      pinned: draft.pinned,
      raw: draft.raw,
    },
    new Date().toISOString(),
  );
}

export function parseNote(id: string, raw: string): Note {
  return noteFrom(coreNoteParse(id, raw));
}

function noteFrom(note: CoreNote): Note {
  return {
    id: note.id,
    raw: note.raw,
    title: note.title,
    body: note.body,
    notebookId: note.notebook_id,
    parentId: note.parent_id,
    attachments: note.attachments.length
      ? note.attachments.map(attachmentFrom)
      : undefined,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    readable: note.readable,
  };
}

export function serializeNotebook(name: string, previousRaw?: string): string {
  return coreNotebookWrite(name, previousRaw);
}

export function parseNotebook(id: string, raw: string): Notebook {
  return notebookFrom(coreNotebookParse(id, raw));
}

function notebookFrom(notebook: CoreNotebook): Notebook {
  return {
    id: notebook.id,
    name: notebook.name,
    raw: notebook.raw,
    readable: notebook.readable,
  };
}

export function resolveNotebookId(notebookId?: string): string {
  return coreResolveNotebookId(notebookId);
}

/**
 * Whether a save may write over what this draft was read from.
 *
 * `serializeNote` refuses a payload declaring a schema major this build does not
 * read, because carrying unknown keys through covers a field that was added and
 * not one whose meaning changed. Asking first turns that into a message rather
 * than an exception out of the autosaver. A draft with nothing behind it is
 * always writable.
 */
export function noteDraftWritable(draft: NoteDraft): boolean {
  return !draft.raw || coreNoteParse("", draft.raw).readable;
}

export function sortNotebooks(notebooks: Notebook[]): Notebook[] {
  return sortContainers(DEFAULT_NOTEBOOK_ID, notebooks);
}

export function notebookNameById(
  notebooks: Notebook[],
  notebookId?: string,
): string {
  return coreNotebookNameById(
    notebooks.map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      readable: notebook.readable ?? true,
      raw: notebook.raw,
    })),
    notebookId,
  );
}

/** Most recently edited first, then by title so the order is total. */
export function sortNotes(notes: Note[]): Note[] {
  return sortByRecency(notes, {
    name: (note) => note.title,
    stamp: (note) => note.updatedAt ?? note.createdAt,
  });
}

/**
 * One line of plain text for a list row. The body is sliced before the markers
 * are stripped, so a megabyte-long note costs the same as a short one.
 */
export function notePreview(body: string, max = 140): string {
  const plain = stripMarkdown(body.slice(0, max * 4));
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * Mirrors `MAX_PADDED_OBJECT_SIZE` in `sealbook/crates/sealbook-protocol`. A write
 * past it is a `400` from the server, so it is worth catching before the upload
 * rather than halfway through an import.
 */
const MAX_PADDED_OBJECT_SIZE = 8 * 1024 * 1024;

/** The envelope's other keys: version, contentType, tombstone, revision. */
const ENVELOPE_OVERHEAD = 256;

/**
 * Bytes this note will occupy once sealed.
 *
 * The body is JSON-escaped twice, once into the note payload and again into the
 * sealed envelope that carries it, so a newline costs four bytes rather than
 * one. Measuring the encoded payload is the only way to get this right.
 */
export function noteByteSize(draft: NoteDraft): number {
  return payloadByteSize(serializeNote(draft));
}

/** `noteByteSize` for a payload already serialised. */
export function payloadByteSize(written: string): number {
  return new TextEncoder().encode(JSON.stringify(written)).length + ENVELOPE_OVERHEAD;
}

export function noteFitsObjectLimit(draft: NoteDraft): boolean {
  return payloadFitsObjectLimit(serializeNote(draft));
}

export function payloadFitsObjectLimit(written: string): boolean {
  return payloadByteSize(written) + 4 <= MAX_PADDED_OBJECT_SIZE;
}

export function emptyNoteDraft(notebookId: string): NoteDraft {
  return { title: "", body: "", notebookId: resolveNotebookId(notebookId) };
}

export function noteMatches(note: Note, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  // Title first: it is short, and it is what a search is usually reaching for.
  if (note.title.toLowerCase().includes(needle)) return true;
  return note.body.toLowerCase().includes(needle);
}

/**
 * Runs beginning with a letter or digit, so markdown punctuation does not count,
 * and scanned rather than split: at the 8 MB ceiling the array is the cost.
 */
export function noteWordCount(body: string): number {
  const word = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
  let count = 0;
  while (word.exec(body) !== null) count += 1;
  return count;
}

export const notebookTone = coreNotebookTone;
