import { describe, expect, it } from "vitest";
import {
  bookmarkHost,
  bookmarkMatches,
  buildCollectionTree,
  canMoveCollection,
  collectionSubtree,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  isValidUrl,
  normalizeTags,
  normalizeUrl,
  parseBookmark,
  parseBookmarkCollection,
  resolveCollectionId,
  serializeBookmark,
  serializeBookmarkCollection,
  sortBookmarks,
  BOOKMARK_COLLECTION_CONTENT_TYPE,
  BOOKMARK_CONTENT_TYPE,
} from "./bookmark";
import { flattenTree } from "./tree";
import type { Bookmark, BookmarkCollection } from "./types";

/**
 * Mirrors of the Rust constants in
 * `sealbook/crates/sealbook-protocol/src/lib.rs`. There is no codegen between the
 * two, so this is the test that pins the pairing.
 */
describe("the wire constants", () => {
  it("match the protocol crate", () => {
    expect(BOOKMARK_CONTENT_TYPE).toBe("application/sealbook.bookmark+json");
    expect(BOOKMARK_COLLECTION_CONTENT_TYPE).toBe(
      "application/sealbook.bookmark-collection+json",
    );
    // Reserved id 5: 1 is the address book, 2 the notebook, 3 the calendar, 4 settings.
    expect(DEFAULT_BOOKMARK_COLLECTION_ID).toBe("00000000-0000-0000-0000-000000000005");
  });
});

describe("serializeBookmark", () => {
  it("round trips through parseBookmark", () => {
    const raw = serializeBookmark({
      url: "https://example.com/a",
      title: "Example",
      notes: "why",
      tags: ["rust", "reading"],
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    });
    const parsed = parseBookmark("id-1", raw);
    expect(parsed.url).toBe("https://example.com/a");
    expect(parsed.title).toBe("Example");
    expect(parsed.notes).toBe("why");
    expect(parsed.tags).toEqual(["rust", "reading"]);
    expect(parsed.collectionId).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
    expect(parsed.createdAt).toBeTruthy();
  });

  it("carries a field this build does not own through an edit", () => {
    const stored = JSON.stringify({
      "@type": "Bookmark",
      version: "1.0",
      url: "https://example.com/old",
      title: "old",
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
      favicon: "data:,",
      futureField: 7,
    });
    const raw = serializeBookmark({
      url: "https://example.com/new",
      title: "new",
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
      raw: stored,
    });
    const value = JSON.parse(raw) as Record<string, unknown>;
    expect(value.title).toBe("new");
    expect(value.favicon).toBe("data:,");
    expect(value.futureField).toBe(7);
  });

  it("omits an empty optional rather than writing it", () => {
    const raw = serializeBookmark({
      url: "https://example.com/a",
      title: "Example",
      notes: "   ",
      tags: [],
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    });
    const value = JSON.parse(raw) as Record<string, unknown>;
    expect("notes" in value).toBe(false);
    expect("tags" in value).toBe(false);
  });

  it("adds a scheme to a bare host", () => {
    const raw = serializeBookmark({
      url: "example.com/page",
      title: "",
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    });
    expect((JSON.parse(raw) as { url: string }).url).toBe("https://example.com/page");
  });
});

describe("parseBookmark", () => {
  it("falls back to the url when there is no title", () => {
    const parsed = parseBookmark("id", JSON.stringify({ url: "https://example.com/a" }));
    expect(parsed.title).toBe("https://example.com/a");
  });

  it("renders a payload that will not parse rather than taking the list down", () => {
    const parsed = parseBookmark("id", "not json");
    expect(parsed.title).toBe("Unreadable bookmark");
    expect(parsed.collectionId).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
    expect(parsed.tags).toEqual([]);
  });

  it("reads tags that are not an array of strings as none", () => {
    expect(parseBookmark("id", JSON.stringify({ url: "x", tags: "rust" })).tags).toEqual([]);
    expect(parseBookmark("id", JSON.stringify({ url: "x", tags: [1, {}] })).tags).toEqual([]);
  });
});

describe("normalizeTags", () => {
  it("trims, drops blanks, and drops repeats regardless of case", () => {
    expect(normalizeTags([" rust ", "RUST", "", "   ", "reading"])).toEqual(["rust", "reading"]);
  });

  it("reads a non-array as no tags", () => {
    expect(normalizeTags("rust")).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe("normalizeUrl and isValidUrl", () => {
  it("leaves an explicit scheme alone", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeUrl(" https://example.com ")).toBe("https://example.com");
  });

  it("refuses something no browser could open", () => {
    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("   ")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
    expect(isValidUrl("example.com")).toBe(true);
  });

  it("reduces a url to its host for a list row", () => {
    expect(bookmarkHost("https://www.example.com/a/b?c=d")).toBe("example.com");
  });
});

function aCollection(id: string, name: string, parentId?: string): BookmarkCollection {
  return { id, name, parentId, raw: serializeBookmarkCollection(name, parentId) };
}

describe("collections", () => {
  it("round trips, keeping its place in the tree", () => {
    const raw = serializeBookmarkCollection("Recipes", "parent-1");
    const parsed = parseBookmarkCollection("id", raw);
    expect(parsed.name).toBe("Recipes");
    expect(parsed.parentId).toBe("parent-1");
  });

  it("keeps its place in the tree and its unknown fields through a rename", () => {
    // What a rename sends: the new name, the parent unchanged, and the stored
    // payload as `previousRaw`.
    const stored = JSON.stringify({
      "@type": "BookmarkCollection",
      version: "1.0",
      name: "Old",
      parentId: "work",
      sortOrder: 3,
    });
    const renamed = serializeBookmarkCollection("New", "work", stored);
    const value = JSON.parse(renamed) as Record<string, unknown>;
    expect(value.name).toBe("New");
    expect(value.parentId).toBe("work");
    expect(value.sortOrder).toBe(3);
  });

  it("omits parentId at the top level", () => {
    const value = JSON.parse(serializeBookmarkCollection("Top")) as Record<string, unknown>;
    expect("parentId" in value).toBe(false);
  });

  it("nests, with the default first among siblings", () => {
    const collections = [
      aCollection("work", "Work"),
      aCollection(DEFAULT_BOOKMARK_COLLECTION_ID, "Default Collection"),
      aCollection("rust", "Rust", "work"),
    ];
    const flat = flattenTree(buildCollectionTree(collections));
    expect(flat.map((node) => [node.item.id, node.depth])).toEqual([
      [DEFAULT_BOOKMARK_COLLECTION_ID, 0],
      ["work", 0],
      ["rust", 1],
    ]);
  });

  it("reads a cycle as no parent rather than hiding a collection", () => {
    const collections = [aCollection("a", "A", "b"), aCollection("b", "B", "a")];
    const flat = flattenTree(buildCollectionTree(collections));
    expect(flat).toHaveLength(2);
    expect(flat.every((node) => node.depth === 0)).toBe(true);
  });

  it("reads a parent that is gone as no parent", () => {
    const flat = flattenTree(buildCollectionTree([aCollection("a", "A", "missing")]));
    expect(flat).toHaveLength(1);
    expect(flat[0].depth).toBe(0);
  });

  it("gives a collection and everything under it", () => {
    const collections = [
      aCollection("work", "Work"),
      aCollection("rust", "Rust", "work"),
      aCollection("async", "Async", "rust"),
      aCollection("other", "Other"),
    ];
    expect(collectionSubtree(collections, "work").sort()).toEqual(["async", "rust", "work"]);
  });

  it("refuses a move that would eat the tree", () => {
    const collections = [
      aCollection("work", "Work"),
      aCollection("rust", "Rust", "work"),
    ];
    expect(canMoveCollection(collections, "work", "rust")).toBe(false);
    expect(canMoveCollection(collections, "work", "work")).toBe(false);
    expect(canMoveCollection(collections, "rust", null)).toBe(true);
  });

  it("keeps the default collection at the top level", () => {
    const collections = [
      aCollection(DEFAULT_BOOKMARK_COLLECTION_ID, "Default Collection"),
      aCollection("work", "Work"),
    ];
    expect(canMoveCollection(collections, DEFAULT_BOOKMARK_COLLECTION_ID, "work")).toBe(false);
    expect(canMoveCollection(collections, DEFAULT_BOOKMARK_COLLECTION_ID, null)).toBe(true);
  });

  it("resolves a missing collection id to the default", () => {
    expect(resolveCollectionId(undefined)).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
    expect(resolveCollectionId("  ")).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
    expect(resolveCollectionId("work")).toBe("work");
  });
});

function aBookmark(id: string, title: string, updatedAt?: string): Bookmark {
  const draft = {
    id,
    url: `https://example.com/${id}`,
    title,
    collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    updatedAt,
    raw: "{}",
  };
  return draft;
}

describe("sortBookmarks", () => {
  it("puts the most recently saved first, then falls back to the title", () => {
    const sorted = sortBookmarks([
      aBookmark("c", "Cherry", "2024-01-01T00:00:00Z"),
      aBookmark("a", "Apple", "2025-01-01T00:00:00Z"),
      aBookmark("b", "Banana"),
    ]);
    expect(sorted.map((bookmark) => bookmark.id)).toEqual(["a", "c", "b"]);
  });
});

describe("bookmarkMatches", () => {
  const bookmark: Bookmark = {
    id: "1",
    url: "https://doc.rust-lang.org/book/",
    title: "The Book",
    notes: "read chapter 4",
    tags: ["rust", "reading"],
    collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    raw: "{}",
  };

  it("matches the title, url, tags and notes", () => {
    expect(bookmarkMatches(bookmark, "")).toBe(true);
    expect(bookmarkMatches(bookmark, "book")).toBe(true);
    expect(bookmarkMatches(bookmark, "rust-lang")).toBe(true);
    expect(bookmarkMatches(bookmark, "reading")).toBe(true);
    expect(bookmarkMatches(bookmark, "chapter")).toBe(true);
    expect(bookmarkMatches(bookmark, "zanzibar")).toBe(false);
  });
});
