import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import { ancestorsOf, buildTree, canReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "./types";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`. There is no codegen between the
// two, so the pairing is covered by a test rather than by the compiler.
export const BOOKMARK_CONTENT_TYPE = "application/sealbook.bookmark+json";
export const BOOKMARK_COLLECTION_CONTENT_TYPE = "application/sealbook.bookmark-collection+json";
export const DEFAULT_BOOKMARK_COLLECTION_NAME = "Default Collection";
export const DEFAULT_BOOKMARK_COLLECTION_ID = "00000000-0000-0000-0000-000000000005";
export const ALL_COLLECTIONS = "all";

/** Every key this build writes for a bookmark. See `mergePayload`. */
const BOOKMARK_KEYS = [
  "@type",
  "version",
  "url",
  "title",
  "notes",
  "tags",
  "collectionId",
  "createdAt",
  "updatedAt",
] as const;

export function serializeBookmark(draft: BookmarkDraft): string {
  const now = new Date().toISOString();
  const notes = draft.notes?.trim();
  const tags = normalizeTags(draft.tags);
  return mergePayload(
    draft.raw,
    {
      "@type": "Bookmark",
      version: PAYLOAD_SCHEMA_VERSION,
      url: normalizeUrl(draft.url),
      title: draft.title.trim(),
      // Omitted rather than written empty, so a bookmark with neither looks the
      // same to a reader that predates the fields.
      ...(notes ? { notes } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      collectionId: resolveCollectionId(draft.collectionId),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    },
    BOOKMARK_KEYS,
  );
}

export function parseBookmark(id: string, raw: string): Bookmark {
  try {
    const body = JSON.parse(raw) as {
      url?: string;
      title?: string;
      notes?: string;
      tags?: unknown;
      collectionId?: string;
      createdAt?: string;
      updatedAt?: string;
    };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    return {
      id,
      raw,
      url,
      // A bookmark saved without a title is listed by its URL: it is what the
      // user would recognise, and an empty row is not findable.
      title: body.title?.trim() || url || "Untitled bookmark",
      notes: typeof body.notes === "string" && body.notes ? body.notes : undefined,
      tags: normalizeTags(body.tags),
      collectionId: resolveCollectionId(body.collectionId),
      createdAt: typeof body.createdAt === "string" ? body.createdAt : undefined,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : undefined,
    };
  } catch {
    // A payload that will not parse still has to render as something the user can
    // find and delete, rather than taking the whole list down.
    return {
      id,
      raw,
      url: "",
      title: "Unreadable bookmark",
      tags: [],
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    };
  }
}

const BOOKMARK_COLLECTION_KEYS = ["@type", "version", "name", "parentId", "color"] as const;

export function serializeBookmarkCollection(
  name: string,
  parentId?: string,
  previousRaw?: string,
  color?: string,
): string {
  return mergePayload(
    previousRaw,
    {
      "@type": "BookmarkCollection",
      version: PAYLOAD_SCHEMA_VERSION,
      name: name.trim(),
      ...(parentId ? { parentId } : {}),
      ...(color ? { color } : {}),
    },
    BOOKMARK_COLLECTION_KEYS,
  );
}

export function parseBookmarkCollection(id: string, raw: string): BookmarkCollection {
  try {
    const body = JSON.parse(raw) as { name?: string; parentId?: string; color?: string };
    return {
      id,
      name: body.name?.trim() || "Untitled",
      parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : undefined,
      color: typeof body.color === "string" && body.color ? body.color : undefined,
      raw,
    };
  } catch {
    return { id, name: raw, raw };
  }
}

export function resolveCollectionId(collectionId?: string): string {
  return collectionId?.trim() || DEFAULT_BOOKMARK_COLLECTION_ID;
}

/**
 * Trimmed, de-duplicated case-insensitively, and capped.
 *
 * Anything that is not an array of strings reads as no tags: the field is the
 * one place a payload carries a container, so a malformed one must not reach the
 * renderer as an object.
 */
const MAX_TAGS = 32;

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * The URL as it should be stored: trimmed, and given an `https://` scheme when
 * the user typed a bare host.
 *
 * Deliberately not a fetch or a DNS lookup. Nothing in Sealbook resolves a saved
 * URL, because doing so would tell the site in it that this account holds it.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Whether a URL is one a browser could open, which is all that can be checked here. */
export function isValidUrl(url: string): boolean {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** The host, for the second line of a list row. Falls back to the whole URL. */
export function bookmarkHost(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Most recently saved first, then by title so the order is total. */
export function sortBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return [...bookmarks].sort((a, b) => {
    const saved = savedAt(b) - savedAt(a);
    if (saved !== 0) return saved;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

function savedAt(bookmark: Bookmark): number {
  const stamp = bookmark.updatedAt ?? bookmark.createdAt;
  if (!stamp) return 0;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortCollections(collections: BookmarkCollection[]): BookmarkCollection[] {
  return [...collections].sort((a, b) => {
    if (a.id === DEFAULT_BOOKMARK_COLLECTION_ID) return -1;
    if (b.id === DEFAULT_BOOKMARK_COLLECTION_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function collectionNameById(
  collections: BookmarkCollection[],
  collectionId?: string,
): string {
  const id = resolveCollectionId(collectionId);
  return (
    collections.find((collection) => collection.id === id)?.name ??
    DEFAULT_BOOKMARK_COLLECTION_NAME
  );
}

/** The collection tree, default first then alphabetical among siblings. */
export function buildCollectionTree(
  collections: BookmarkCollection[],
): TreeNode<BookmarkCollection>[] {
  return buildTree(collections, sortCollections);
}

/** The collection and every one nested under it, itself first. */
export function collectionSubtree(collections: BookmarkCollection[], id: string): string[] {
  return subtree(collections, id);
}

/**
 * Whether a collection may be moved under another.
 *
 * The default collection is kept at the top level: it is the fallback every
 * bookmark without a collection resolves to, and burying it would hide that.
 */
export function canMoveCollection(
  collections: BookmarkCollection[],
  id: string,
  parentId: string | null,
): boolean {
  if (id === DEFAULT_BOOKMARK_COLLECTION_ID) return parentId === null;
  return canReparent(collections, id, parentId);
}

export function bookmarkMatches(bookmark: Bookmark, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  // Title first: it is short, and it is what a search is usually reaching for.
  if (bookmark.title.toLowerCase().includes(needle)) return true;
  if (bookmark.url.toLowerCase().includes(needle)) return true;
  if (bookmark.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
  return bookmark.notes?.toLowerCase().includes(needle) === true;
}

/**
 * Mirrors `MAX_PADDED_OBJECT_SIZE` in `sealbook/crates/sealbook-protocol`. A write
 * past it is a `400` from the server, so it is worth catching before the upload.
 */
const MAX_PADDED_OBJECT_SIZE = 8 * 1024 * 1024;

/** The envelope's other keys: version, contentType, tombstone, revision. */
const ENVELOPE_OVERHEAD = 256;

export function bookmarkByteSize(draft: BookmarkDraft): number {
  const payload = JSON.stringify(serializeBookmark(draft));
  return new TextEncoder().encode(payload).length + ENVELOPE_OVERHEAD;
}

export function bookmarkFitsObjectLimit(draft: BookmarkDraft): boolean {
  return bookmarkByteSize(draft) + 4 <= MAX_PADDED_OBJECT_SIZE;
}

export function emptyBookmarkDraft(collectionId: string): BookmarkDraft {
  return { url: "", title: "", collectionId: resolveCollectionId(collectionId), tags: [] };
}

/** The top-level collection `id` sits under: itself, if it is already one. */
export function collectionRootId(collections: BookmarkCollection[], id: string): string {
  const ancestors = ancestorsOf(collections, id);
  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : id;
}

/**
 * Stable, distinct colours for a collection that has never been given one.
 * Hashed from the id rather than assigned in storage order, so the same
 * uncoloured collection lands on the same tone on every device.
 */
const COLLECTION_TONES = [
  "#7aa2f7",
  "#9ece6a",
  "#bb9af7",
  "#e0af68",
  "#7dcfff",
  "#f7768e",
  "#ff9e64",
  "#73daca",
];

function hashedTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  }
  return COLLECTION_TONES[hash % COLLECTION_TONES.length];
}

/**
 * A collection's colour: its root's explicit colour, or one hashed from the
 * root's id when none is set. Only a top-level collection carries an explicit
 * colour, so every collection nested under it resolves to the same value —
 * that is what "adopts the parent's colour" means here.
 */
export function collectionTone(collections: BookmarkCollection[], id: string): string {
  const rootId = collectionRootId(collections, id);
  const explicit = collections.find((item) => item.id === rootId)?.color?.trim();
  return explicit || hashedTone(rootId);
}
