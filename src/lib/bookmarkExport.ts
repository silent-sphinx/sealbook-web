import { collectionTo } from "./bookmark";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "./types";
import {
  coreBookmarkImport,
  coreBookmarkImportFolders,
  coreBookmarkImportPlan,
  coreErrorOf,
  type CoreBookmarkImport,
  type CoreBookmarkImportOptions,
  type CoreImportFolder,
} from "./wasm";

export type BookmarkExportEntry = {
  url: string;
  title: string;
  notes?: string;
  tags?: string[];
  collectionId: string;
  /** For readers that predate `collectionId`, and for a hand-edited file. */
  collectionName: string;
  createdAt?: string;
  updatedAt?: string;
};

type BookmarkExportPayload = {
  "@type": "sealbook-bookmark-export";
  version: 1;
  exportedAt: string;
  bookmarks: BookmarkExportEntry[];
  collections: Array<{
    id: string;
    name: string;
    parentId?: string;
    color?: string;
  }>;
};

export type BookmarkImportResult = {
  bookmarks: BookmarkDraft[];
  skipped: number;
  /** True when the file puts any bookmark in a folder. */
  hasFolders: boolean;
  /** The file as core read it, for `planBookmarkImport`. */
  source: CoreBookmarkImport;
};

export type BookmarkImportPlan = {
  /** Parents before the collections nested in them. */
  collections: Array<{ id: string; name: string; parentId?: string }>;
  bookmarks: BookmarkDraft[];
  /** Bookmarks left out because their folder is skipped. */
  excluded: number;
};

/** Folders this deep or less become collections; deeper ones merge into the folder above. */
export const ALL_FOLDERS = 0xffff_ffff;

export const NO_FOLDERS: CoreBookmarkImportOptions = { depth: 0, rules: [] };

/** The folders of a read file as `options` would treat them, parents first. */
export function importFolders(
  read: BookmarkImportResult,
  options: CoreBookmarkImportOptions,
): CoreImportFolder[] {
  return coreBookmarkImportFolders(read.source, options);
}

export function generateBookmarkExportData(
  bookmarks: Bookmark[],
  collections: BookmarkCollection[],
): { filename: string; mime: string; data: string } {
  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const entries: BookmarkExportEntry[] = bookmarks.map((b) => ({
    url: b.url,
    title: b.title,
    ...(b.notes ? { notes: b.notes } : {}),
    ...(b.tags && b.tags.length > 0 ? { tags: b.tags } : {}),
    collectionId: b.collectionId,
    collectionName: collectionById.get(b.collectionId)?.name ?? "Default Collection",
    ...(b.createdAt ? { createdAt: b.createdAt } : {}),
    ...(b.updatedAt ? { updatedAt: b.updatedAt } : {}),
  }));

  const payload: BookmarkExportPayload = {
    "@type": "sealbook-bookmark-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    bookmarks: entries,
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.parentId ? { parentId: c.parentId } : {}),
      ...(c.color ? { color: c.color } : {}),
    })),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `sealbook-bookmarks-${stamp}.json`,
    mime: "application/json",
    data: JSON.stringify(payload, null, 2),
  };
}

/**
 * Reads a browser's HTML bookmarks export, a Sealbook export or a JSON array,
 * with every bookmark filed in `targetCollectionId`. Throws an `Error` whose
 * message is the sentence to show.
 */
export function parseBookmarkImport(
  content: string,
  targetCollectionId: string,
): BookmarkImportResult {
  try {
    const read = coreBookmarkImport(content);
    return {
      bookmarks: read.bookmarks.map(({ draft }) => ({
        url: draft.url,
        title: draft.title,
        ...(draft.notes ? { notes: draft.notes } : {}),
        ...(draft.tags.length > 0 ? { tags: draft.tags } : {}),
        collectionId: targetCollectionId,
        ...(draft.created_at ? { createdAt: draft.created_at } : {}),
      })),
      skipped: read.skipped,
      hasFolders: read.bookmarks.some((item) => item.folder.length > 0),
      source: read,
    };
  } catch (error) {
    const core = coreErrorOf(error);
    throw core?.kind === "Malformed" ? new Error(core.detail) : error;
  }
}

/**
 * Where a read file's bookmarks go: all in `targetCollectionId`, or into
 * collections that mirror the file's folders as `options` says, nested under the
 * target unless that is the default collection.
 */
export function planBookmarkImport(
  read: BookmarkImportResult,
  existing: BookmarkCollection[],
  targetCollectionId: string,
  options: CoreBookmarkImportOptions,
): BookmarkImportPlan {
  const plan = coreBookmarkImportPlan(
    read.source,
    existing.map(collectionTo),
    targetCollectionId,
    options,
  );
  return {
    collections: plan.collections.map(({ id, draft }) => ({
      id,
      name: draft.name,
      ...(draft.parent_id ? { parentId: draft.parent_id } : {}),
    })),
    bookmarks: plan.bookmarks.map((draft) => ({
      url: draft.url,
      title: draft.title,
      ...(draft.notes ? { notes: draft.notes } : {}),
      ...(draft.tags.length > 0 ? { tags: draft.tags } : {}),
      collectionId: draft.collection_id,
      ...(draft.created_at ? { createdAt: draft.created_at } : {}),
    })),
    excluded: plan.excluded,
  };
}
