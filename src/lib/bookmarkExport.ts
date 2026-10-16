import type { Bookmark, BookmarkCollection, BookmarkDraft } from "./types";

export type BookmarkExportEntry = {
  url: string;
  title: string;
  notes?: string;
  tags?: string[];
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
};

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

export function parseBookmarkImport(
  content: string,
  targetCollectionId: string,
): BookmarkImportResult {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Not a valid JSON file.");
  }

  const entries = extractEntries(parsed);
  if (entries === null) {
    throw new Error(
      "Unrecognised format. Expected a Sealbook bookmark export or a JSON array of bookmarks.",
    );
  }

  const bookmarks: BookmarkDraft[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      skipped++;
      continue;
    }
    const b = entry as Record<string, unknown>;
    const url = typeof b.url === "string" ? b.url.trim() : "";
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!url && !title) {
      skipped++;
      continue;
    }
    bookmarks.push({
      url,
      title: title || url,
      ...(typeof b.notes === "string" && b.notes ? { notes: b.notes } : {}),
      ...(Array.isArray(b.tags)
        ? { tags: (b.tags as unknown[]).filter((t): t is string => typeof t === "string") }
        : {}),
      collectionId: targetCollectionId,
      ...(typeof b.createdAt === "string" ? { createdAt: b.createdAt } : {}),
      ...(typeof b.updatedAt === "string" ? { updatedAt: b.updatedAt } : {}),
    });
  }
  return { bookmarks, skipped };
}

function extractEntries(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj["@type"] === "sealbook-bookmark-export" && Array.isArray(obj.bookmarks)) {
    return obj.bookmarks;
  }
  return null;
}
