import { describe, expect, it } from "vitest";
import {
  ALL_FOLDERS,
  generateBookmarkExportData,
  importFolders,
  parseBookmarkImport,
  planBookmarkImport,
} from "./bookmarkExport";
import { parseBookmarkCollection } from "./bookmark";
import { DEFAULT_BOOKMARK_COLLECTION_ID } from "./bookmark";

const BROWSER_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Reading</H3>
    <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="1700000000" TAGS="rust,wasm">Example A</A>
        <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
    </DL><p>
    <DT><A HREF="https://example.org/">Top level</A>
</DL><p>
`;

describe("a bookmark import", () => {
  it("reads a browser's HTML export into the chosen collection", () => {
    const read = parseBookmarkImport(BROWSER_EXPORT, "target");
    expect(read.skipped).toBe(1);
    expect(read.bookmarks.map((b) => [b.url, b.title, b.collectionId])).toEqual([
      ["https://example.com/a", "Example A", "target"],
      ["https://example.org/", "Top level", "target"],
    ]);
    expect(read.bookmarks[0].tags).toEqual(["rust", "wasm"]);
    expect(read.bookmarks[0].createdAt).toBeTruthy();
  });

  it("reads back what it exported", () => {
    const { data } = generateBookmarkExportData([], []);
    expect(parseBookmarkImport(data, DEFAULT_BOOKMARK_COLLECTION_ID)).toMatchObject({
      bookmarks: [],
      skipped: 0,
    });
  });

  it("reads a bare JSON array", () => {
    const read = parseBookmarkImport('[{"url":"https://a.example/","title":" A "},{"notes":"x"}]', "t");
    expect(read.bookmarks).toMatchObject([{ url: "https://a.example/", title: "A", collectionId: "t" }]);
    expect(read.skipped).toBe(1);
  });

  it("refuses a file that is not a bookmark file with a sentence", () => {
    expect(() => parseBookmarkImport("not json", "t")).toThrow("Not a valid JSON file.");
    expect(() => parseBookmarkImport('{"a":1}', "t")).toThrow(/Unrecognised format/);
  });

  describe("where it goes", () => {
    const read = parseBookmarkImport(BROWSER_EXPORT, "ignored");
    const flat = { depth: 0, rules: [] };
    const all = { depth: ALL_FOLDERS, rules: [] };

    it("notes whether the file has folders", () => {
      expect(read.hasFolders).toBe(true);
      expect(parseBookmarkImport('[{"url":"https://a.example/"}]', "t").hasFolders).toBe(false);
    });

    it("puts everything in the target as one collection", () => {
      const plan = planBookmarkImport(read, [], "target", flat);
      expect(plan.collections).toEqual([]);
      expect(plan.bookmarks.map((b) => b.collectionId)).toEqual(["target", "target"]);
    });

    it("mirrors the folders under the target", () => {
      const plan = planBookmarkImport(read, [], "target", all);
      expect(plan.collections).toHaveLength(1);
      expect(plan.collections[0]).toMatchObject({ name: "Reading", parentId: "target" });
      expect(plan.bookmarks.map((b) => b.collectionId)).toEqual([plan.collections[0].id, "target"]);
    });

    it("reuses a collection that is already there", () => {
      const existing = [parseBookmarkCollection("r", JSON.stringify({ "@type": "BookmarkCollection", name: "reading", parentId: "target" }))];
      const plan = planBookmarkImport(read, existing, "target", all);
      expect(plan.collections).toEqual([]);
      expect(plan.bookmarks[0].collectionId).toBe("r");
    });

    it("lists the folders with sizes and what each will do", () => {
      expect(importFolders(read, flat)).toMatchObject([
        { path: ["Reading"], direct: 1, total: 1, action: { kind: "merge" }, excluded: false },
      ]);
      expect(importFolders(read, all)[0].action.kind).toBe("collection");
    });

    it("renames, skips and merges by rule", () => {
      const options = { depth: 1, rules: [{ path: ["Reading"], action: { kind: "collection" as const, name: "Later" } }] };
      expect(planBookmarkImport(read, [], "target", options).collections[0].name).toBe("Later");
      const skipped = planBookmarkImport(read, [], "target", { depth: 1, rules: [{ path: ["reading"], action: { kind: "skip" as const } }] });
      expect(skipped.excluded).toBe(1);
      expect(skipped.bookmarks.map((b) => b.url)).toEqual(["https://example.org/"]);
    });
  });
});
