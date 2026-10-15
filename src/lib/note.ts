import { stripMarkdown } from "./markdown";
import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import type { Note, NoteAttachment, NoteDraft, Notebook } from "./types";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`. There is no codegen between the
// two, so the pairing is covered by a test rather than by the compiler.
export const NOTE_CONTENT_TYPE = "application/sealbook.note+json";
export const NOTEBOOK_CONTENT_TYPE = "application/sealbook.notebook+json";
export const DEFAULT_NOTEBOOK_NAME = "Default Notebook";
export const DEFAULT_NOTEBOOK_ID = "00000000-0000-0000-0000-000000000002";
export const ALL_NOTEBOOKS = "all";

/** Every key this build writes for a note. See `mergePayload`. */
const NOTE_KEYS = [
  "@type",
  "version",
  "title",
  "body",
  "notebookId",
  "parentId",
  "createdAt",
  "updatedAt",
  "attachments",
] as const;

export function serializeNote(draft: NoteDraft): string {
  const now = new Date().toISOString();
  return mergePayload(
    draft.raw,
    {
      "@type": "Note",
      version: PAYLOAD_SCHEMA_VERSION,
      title: draft.title.trim(),
      body: draft.body,
      notebookId: resolveNotebookId(draft.notebookId),
      // Omitted rather than written null, so a note at the top level looks the
      // same to a reader that predates the field.
      ...(draft.parentId ? { parentId: draft.parentId } : {}),
      // Same rule for attachments: a note with none carries no key at all.
      ...(draft.attachments?.length ? { attachments: draft.attachments } : {}),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    },
    NOTE_KEYS,
  );
}

/**
 * Validates one entry of a note's `attachments` array, dropping a malformed or
 * partially-future-shaped one rather than letting it break the whole note. Only
 * the fields this build needs to fetch and verify a photo are required.
 */
function parseAttachment(value: unknown): NoteAttachment | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  const str = (key: string) => (typeof entry[key] === "string" ? (entry[key] as string) : undefined);
  const num = (key: string) => (typeof entry[key] === "number" ? (entry[key] as number) : undefined);
  const id = str("id");
  const adk = str("adk");
  const contentHash = str("contentHash");
  const chunkSize = num("chunkSize");
  const chunkCount = num("chunkCount");
  if (!id || !adk || !contentHash || chunkSize === undefined || chunkCount === undefined) {
    return undefined;
  }
  return {
    id,
    filename: str("filename") ?? "attachment",
    mimeType: str("mimeType") ?? "application/octet-stream",
    byteSize: num("byteSize") ?? 0,
    width: num("width"),
    height: num("height"),
    adk,
    contentHash,
    chunkSize,
    chunkCount,
    displayWidth: num("displayWidth"),
    thumbnail: str("thumbnail"),
  };
}

function parseAttachments(value: unknown): NoteAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map(parseAttachment)
    .filter((entry): entry is NoteAttachment => entry !== undefined);
  return parsed.length ? parsed : undefined;
}

export function parseNote(id: string, raw: string): Note {
  try {
    const body = JSON.parse(raw) as {
      title?: string;
      body?: string;
      notebookId?: string;
      parentId?: string;
      createdAt?: string;
      updatedAt?: string;
      attachments?: unknown;
    };
    return {
      id,
      raw,
      title: body.title?.trim() || "Untitled note",
      body: typeof body.body === "string" ? body.body : "",
      notebookId: resolveNotebookId(body.notebookId),
      parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : undefined,
      attachments: parseAttachments(body.attachments),
      createdAt: typeof body.createdAt === "string" ? body.createdAt : undefined,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : undefined,
    };
  } catch {
    // A payload that will not parse still has to render as something the user can
    // find and delete, rather than taking the whole list down.
    return {
      id,
      raw,
      title: "Unreadable note",
      body: raw,
      notebookId: DEFAULT_NOTEBOOK_ID,
    };
  }
}

const NOTEBOOK_KEYS = ["@type", "version", "name"] as const;

export function serializeNotebook(name: string, previousRaw?: string): string {
  return mergePayload(
    previousRaw,
    {
      "@type": "Notebook",
      version: PAYLOAD_SCHEMA_VERSION,
      name: name.trim(),
    },
    NOTEBOOK_KEYS,
  );
}

export function parseNotebook(id: string, raw: string): Notebook {
  try {
    const body = JSON.parse(raw) as { name?: string };
    return { id, name: body.name?.trim() || "Untitled", raw };
  } catch {
    return { id, name: raw, raw };
  }
}

export function resolveNotebookId(notebookId?: string): string {
  return notebookId?.trim() || DEFAULT_NOTEBOOK_ID;
}

export function sortNotebooks(notebooks: Notebook[]): Notebook[] {
  return [...notebooks].sort((a, b) => {
    if (a.id === DEFAULT_NOTEBOOK_ID) return -1;
    if (b.id === DEFAULT_NOTEBOOK_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function notebookNameById(notebooks: Notebook[], notebookId?: string): string {
  const id = resolveNotebookId(notebookId);
  return notebooks.find((notebook) => notebook.id === id)?.name ?? DEFAULT_NOTEBOOK_NAME;
}

/** Most recently edited first, then by title so the order is total. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const edited = editedAt(b) - editedAt(a);
    if (edited !== 0) return edited;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

function editedAt(note: Note): number {
  const stamp = note.updatedAt ?? note.createdAt;
  if (!stamp) return 0;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? 0 : parsed;
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
  const payload = JSON.stringify(serializeNote(draft));
  return new TextEncoder().encode(payload).length + ENVELOPE_OVERHEAD;
}

export function noteFitsObjectLimit(draft: NoteDraft): boolean {
  return noteByteSize(draft) + 4 <= MAX_PADDED_OBJECT_SIZE;
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

/**
 * A notebook stores no colour, so its dot derives one from the id: stable across
 * devices without adding a field the other clients would have to write.
 */
const NOTEBOOK_TONES = [
  "#7aa2f7",
  "#9ece6a",
  "#bb9af7",
  "#e0af68",
  "#7dcfff",
  "#f7768e",
  "#ff9e64",
  "#73daca",
];

export function notebookTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  }
  return NOTEBOOK_TONES[hash % NOTEBOOK_TONES.length];
}
