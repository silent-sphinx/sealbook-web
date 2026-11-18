import { normalizeTags } from "./tags";
import { ancestorsOf, buildTree, canReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "./types";
import {
  coreBookmarkCollectionParse,
  coreBookmarkCollectionTone,
  coreBookmarkCollectionWrite,
  coreBookmarkParse,
  coreBookmarkWrite,
  coreOrderBookmarks,
} from "./wasm";
import type { BookmarkSortKey, CoreBookmark, CoreBookmarkCollection } from "./wasm";
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
    trashedAt: bookmark.trashed_at,
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
  hideFromAll?: boolean,
  archived?: boolean,
): string {
  return coreBookmarkCollectionWrite({
    name,
    parent_id: parentId,
    color,
    hide_from_all:
      hideFromAll ??
      (previousRaw
        ? coreBookmarkCollectionParse("", previousRaw).hide_from_all
        : false),
    archived:
      archived ??
      (previousRaw
        ? coreBookmarkCollectionParse("", previousRaw).archived
        : false),
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
    hideFromAll: collection.hide_from_all || undefined,
    archived: collection.archived || undefined,
    raw: collection.raw,
    trashedAt: collection.trashed_at,
    readable: collection.readable,
  };
}

export function collectionTo(collection: BookmarkCollection): CoreBookmarkCollection {
  return {
    id: collection.id,
    name: collection.name,
    parent_id: collection.parentId,
    color: collection.color,
    hide_from_all: collection.hideFromAll ?? false,
    archived: collection.archived ?? false,
    trashed_at: collection.trashedAt,
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

/**
 * The draft a bulk "add tag" writes, or null when it would change nothing (the
 * tag is blank, already there in any case, or the bookmark is at the tag cap),
 * so a bulk action rewrites only the bookmarks it changes.
 */
export function bookmarkWithTagAdded(bookmark: Bookmark, tag: string): BookmarkDraft | null {
  const current = normalizeTags(bookmark.tags ?? []);
  const next = normalizeTags([...current, tag]);
  if (next.length === current.length) return null;
  return { ...bookmarkDraft(bookmark), tags: next };
}

/** As `bookmarkWithTagAdded`, for taking a tag off; matched regardless of case. */
export function bookmarkWithTagRemoved(bookmark: Bookmark, tag: string): BookmarkDraft | null {
  const key = tag.trim().toLowerCase();
  const current = bookmark.tags ?? [];
  const next = current.filter((entry) => entry.toLowerCase() !== key);
  if (!key || next.length === current.length) return null;
  return { ...bookmarkDraft(bookmark), tags: next };
}

export { normalizeTags };

export function resolveCollectionId(collectionId?: string): string {
  return collectionId?.trim() || DEFAULT_BOOKMARK_COLLECTION_ID;
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

/**
 * The URL to put in an `href`, or undefined to show the text alone.
 *
 * A stored URL is only as trustworthy as whichever client or build wrote it,
 * and `javascript:`, `data:` or an external protocol handler would otherwise
 * be one click from running. A scheme-less value gets the same `https://` the
 * form would have given it.
 */
export function bookmarkHref(url: string): string | undefined {
  return isValidUrl(url) ? normalizeUrl(url) : undefined;
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

/** The keys are core's `CoreBookmarkSort`; only the labels are the web's. */
export const BOOKMARK_SORTS: readonly { key: BookmarkSort; label: string }[] = [
  { key: "updated", label: "Recently updated" },
  { key: "added-newest", label: "Newest added" },
  { key: "added-oldest", label: "Oldest added" },
  { key: "title-asc", label: "Title A to Z" },
  { key: "title-desc", label: "Title Z to A" },
  { key: "site", label: "Site A to Z" },
];

export type BookmarkSort = BookmarkSortKey;

export const DEFAULT_BOOKMARK_SORT: BookmarkSort = "updated";

const BOOKMARK_SORT_STORAGE_KEY = "sealbook.bookmarks.sort";

export function isBookmarkSort(value: unknown): value is BookmarkSort {
  return BOOKMARK_SORTS.some((sort) => sort.key === value);
}

export function bookmarkSortLabel(sort: BookmarkSort): string {
  return BOOKMARK_SORTS.find((entry) => entry.key === sort)?.label ?? "";
}

/**
 * The bookmarks in the chosen order. Core owns the comparison, so the web and
 * Android list the same vault the same way.
 */
export function sortBookmarksBy(bookmarks: Bookmark[], sort: BookmarkSort): Bookmark[] {
  if (sort === "updated") return sortBookmarks(bookmarks);
  const ids = coreOrderBookmarks(
    bookmarks.map((bookmark, index) => ({
      id: String(index),
      title: bookmark.title,
      url: bookmark.url,
      created_at: bookmark.createdAt,
      updated_at: bookmark.updatedAt,
    })),
    sort,
  );
  return ids.map((position) => bookmarks[Number(position)]);
}

export function loadBookmarkSort(): BookmarkSort {
  try {
    const stored = localStorage.getItem(BOOKMARK_SORT_STORAGE_KEY);
    return isBookmarkSort(stored) ? stored : DEFAULT_BOOKMARK_SORT;
  } catch {
    return DEFAULT_BOOKMARK_SORT;
  }
}

export function storeBookmarkSort(sort: BookmarkSort): void {
  try {
    localStorage.setItem(BOOKMARK_SORT_STORAGE_KEY, sort);
  } catch {
    // Storage unavailable; the choice then lasts for this session only.
  }
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

/** Collections kept out of "All Bookmarks": marked, or nested under one that is. */
export function hiddenFromAllIds(
  tree: TreeNode<BookmarkCollection>[],
): Set<string> {
  const hidden = new Set<string>();
  const walk = (nodes: TreeNode<BookmarkCollection>[], inherited: boolean) => {
    for (const node of nodes) {
      const hide = inherited || node.item.hideFromAll === true;
      if (hide) hidden.add(node.item.id);
      walk(node.children, hide);
    }
  };
  walk(tree, false);
  return hidden;
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
