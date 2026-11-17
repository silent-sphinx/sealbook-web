import {
  BOOKMARK_COLLECTION_CONTENT_TYPE,
  BOOKMARK_CONTENT_TYPE,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  DEFAULT_BOOKMARK_COLLECTION_NAME,
  serializeBookmark,
  serializeBookmarkCollection,
  sortCollections,
} from "./bookmark";
import { putSealed, putSealedMany } from "./client";
import type { BookmarkCollection, BookmarkDraft } from "./types";
import type { Session } from "./client";
import { newUuid } from "./wasm";

/**
 * The id a new bookmark will be stored under, issued before its first write so
 * that a repeated save is an update rather than a race to create.
 */
export function newBookmarkId(): string {
  return newUuid();
}

export async function putBookmark(
  session: Session,
  draft: BookmarkDraft,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(session, id, BOOKMARK_CONTENT_TYPE, false, serializeBookmark(draft));
  return id;
}

export async function deleteBookmark(session: Session, id: string): Promise<void> {
  await putSealed(session, id, BOOKMARK_CONTENT_TYPE, true, "");
}

/** Rewrites existing bookmarks in one flush; raises `RefusedWrites` for those refused. */
export async function putBookmarks(
  session: Session,
  bookmarks: { id: string; draft: BookmarkDraft }[],
): Promise<void> {
  await putSealedMany(
    session,
    bookmarks.map(({ id, draft }) => ({
      id,
      contentType: BOOKMARK_CONTENT_TYPE,
      tombstone: false,
      payload: serializeBookmark(draft),
    })),
  );
}

/** Tombstones every bookmark in one flush; raises `RefusedWrites` for those refused. */
export async function deleteBookmarks(session: Session, ids: string[]): Promise<void> {
  await putSealedMany(
    session,
    ids.map((id) => ({ id, contentType: BOOKMARK_CONTENT_TYPE, tombstone: true, payload: "" })),
  );
}

export async function putBookmarkCollection(
  session: Session,
  name: string,
  parentId?: string,
  existingId?: string,
  previousRaw?: string,
  color?: string,
  hideFromAll?: boolean,
  archived?: boolean,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(
    session,
    id,
    BOOKMARK_COLLECTION_CONTENT_TYPE,
    false,
    serializeBookmarkCollection(name, parentId, previousRaw, color, hideFromAll, archived),
  );
  return id;
}

export async function deleteBookmarkCollection(session: Session, id: string): Promise<void> {
  await putSealed(session, id, BOOKMARK_COLLECTION_CONTENT_TYPE, true, "");
}

/**
 * Returns the collection list with the default one present, creating it if
 * needed.
 *
 * Called when the Bookmarks tab is first opened rather than on every vault
 * refresh, for the reason `ensureDefaultNotebook` gives: a write here can fail,
 * and on the refresh path that failure would stop the whole vault loading.
 *
 * This is also the entire migration path for an account that predates bookmarks.
 * The id is reserved, so a second device adopts the collection already there
 * instead of creating a rival.
 */
export async function ensureDefaultBookmarkCollection(
  session: Session,
  collections: BookmarkCollection[],
): Promise<BookmarkCollection[]> {
  if (collections.some((collection) => collection.id === DEFAULT_BOOKMARK_COLLECTION_ID)) {
    return sortCollections(collections);
  }
  await putBookmarkCollection(
    session,
    DEFAULT_BOOKMARK_COLLECTION_NAME,
    undefined,
    DEFAULT_BOOKMARK_COLLECTION_ID,
  );
  return sortCollections([
    {
      id: DEFAULT_BOOKMARK_COLLECTION_ID,
      name: DEFAULT_BOOKMARK_COLLECTION_NAME,
      raw: serializeBookmarkCollection(DEFAULT_BOOKMARK_COLLECTION_NAME),
    },
    ...collections,
  ]);
}