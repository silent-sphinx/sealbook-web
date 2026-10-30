import { ancestorsOf, buildTree, canReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "./types";
import {
  coreBookmarkCollectionParse,
  coreBookmarkCollectionTone,
  coreBookmarkCollectionWrite,
  coreBookmarkParse,
  coreBookmarkWrite,
} from "./wasm";
import type { CoreBookmark, CoreBookmarkCollection } from "./wasm";
import { sortByRecency, sortContainers } from "./order";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`. There is no codegen between the
// two, so the pairing is covered by a test rather than by the compiler.
export const BOOKMARK_CONTENT_TYPE = "application/sealbook.bookmark+json";
export const BOOKMARK_COLLECTION_CONTENT_TYPE =
  "application/sealbook.bookmark-collection+json";
export const DEFAULT_BOOKMARK_COLLECTION_NAME = "Default Collection";
export const DEFAULT_BOOKMARK_COLLECTION_ID =
  "00000000-0000-0000-0000-000000000005";
export const ALL_COLLECTIONS = "all";

/**
 * Writes a bookmark's plaintext through core, which every client now does.
 *
 * A bookmark parsed with no stored title carries `derivedTitle`, and is drafted
 * with an empty one: its listed title is the address, and saving must not write
 * that onto the record.
 */
export function serializeBookmark(draft: BookmarkDraft): string {
  return coreBookmarkWrite(
    {
      url: draft.url,
      title: draft.title,
      notes: draft.notes ?? "",
      tags: draft.tags ?? [],
      collection_id: draft.collectionId,
      created_at: draft.createdAt,
      raw: draft.raw,
    },
    new Date().toISOString(),
  );
}

export function parseBookmark(id: string, raw: string): Bookmark {
  return bookmarkFrom(coreBookmarkParse(id, raw));
}

function bookmarkFrom(bookmark: CoreBookmark): Bookmark {
  return {
    id: bookmark.id,
    raw: bookmark.raw,
    url: bookmark.url,
    title: bookmark.title,
    derivedTitle: bookmark.derived_title,
    notes: bookmark.notes || undefined,
    tags: bookmark.tags,
    collectionId: bookmark.collection_id,
    createdAt: bookmark.created_at,
    updatedAt: bookmark.updated_at,
    readable: bookmark.readable,
  };
}

/** The draft an edit starts from: the stored title, never the listed fallback. */
export function bookmarkDraft(bookmark: Bookmark): BookmarkDraft {
  return {
    url: bookmark.url,
    title: bookmark.derivedTitle ? "" : bookmark.title,
    notes: bookmark.notes,
    tags: bookmark.tags,
    collectionId: bookmark.collectionId,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
    raw: bookmark.raw,
  };
}

export function serializeBookmarkCollection(
  name: string,
  parentId?: string,
  previousRaw?: string,
  color?: string,
): string {
  return coreBookmarkCollectionWrite({
    name,
    parent_id: parentId,
    color,
    raw: previousRaw,
  });
}

export function parseBookmarkCollection(
  id: string,
  raw: string,
): BookmarkCollection {
  return collectionFrom(coreBookmarkCollectionParse(id, raw));
}

function collectionFrom(
  collection: CoreBookmarkCollection,
): BookmarkCollection {
  return {
    id: collection.id,
    name: collection.name,
    parentId: collection.parent_id,
    color: collection.color,
    raw: collection.raw,
    readable: collection.readable,
  };
}

function collectionTo(collection: BookmarkCollection): CoreBookmarkCollection {
  return {
    id: collection.id,
    name: collection.name,
    parent_id: collection.parentId,
    color: collection.color,
    readable: collection.readable ?? true,
    raw: collection.raw,
  };
}

/**
 * Whether this build may write over a stored bookmark. False for one from a newer
 * schema major, which core refuses and an editor should show read-only.
 */
export function bookmarkWritable(draft: BookmarkDraft): boolean {
  return !draft.raw || coreBookmarkParse("", draft.raw).readable;
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
  return sortByRecency(bookmarks, {
    name: (bookmark) => bookmark.title,
    stamp: (bookmark) => bookmark.updatedAt ?? bookmark.createdAt,
  });
}

export function sortCollections(
  collections: BookmarkCollection[],
): BookmarkCollection[] {
  return sortContainers(DEFAULT_BOOKMARK_COLLECTION_ID, collections);
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
export function collectionSubtree(
  collections: BookmarkCollection[],
  id: string,
): string[] {
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
  if (bookmark.tags?.some((tag) => tag.toLowerCase().includes(needle)))
    return true;
  return bookmark.notes?.toLowerCase().includes(needle) === true;
}

/**
 * Mirrors `MAX_PADDED_OBJECT_SIZE` in `sealbook/crates/sealbook-protocol`. A write
 * past it is a `400` from the server, so it is worth catching before the upload.
 */
export const MAX_PADDED_OBJECT_SIZE = 8 * 1024 * 1024;

/** The envelope's other keys: version, contentType, tombstone, revision. */
export const ENVELOPE_OVERHEAD = 256;

export function bookmarkByteSize(draft: BookmarkDraft): number {
  const payload = JSON.stringify(serializeBookmark(draft));
  return new TextEncoder().encode(payload).length + ENVELOPE_OVERHEAD;
}

export function bookmarkFitsObjectLimit(draft: BookmarkDraft): boolean {
  return bookmarkByteSize(draft) + 4 <= MAX_PADDED_OBJECT_SIZE;
}

export function emptyBookmarkDraft(collectionId: string): BookmarkDraft {
  return {
    url: "",
    title: "",
    collectionId: resolveCollectionId(collectionId),
    tags: [],
  };
}

/** The top-level collection `id` sits under: itself, if it is already one. */
export function collectionRootId(
  collections: BookmarkCollection[],
  id: string,
): string {
  const ancestors = ancestorsOf(collections, id);
  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : id;
}

/**
 * A collection's colour: its root's explicit colour, or one hashed from the
 * root's id when none is set. Core decides, so every client lands an uncoloured
 * collection on the same tone; only a top-level collection carries an explicit
 * colour, and everything nested under it adopts its root's.
 */
export function collectionTone(
  collections: Pick<
    BookmarkCollection,
    "id" | "name" | "parentId" | "color" | "raw"
  >[],
  id: string,
): string {
  return coreBookmarkCollectionTone(collections.map(collectionTo), id);
}
