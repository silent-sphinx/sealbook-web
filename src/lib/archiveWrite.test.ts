import { describe, expect, it } from "vitest";
import { parseBookmarkCollection, serializeBookmarkCollection } from "./bookmark";
import { parseNotebook, serializeNotebook } from "./note";
import { parseTaskList, serializeTaskList } from "./task";

describe("archiving a collection", () => {
  it("round-trips a notebook, and a rename keeps it archived", () => {
    const archived = serializeNotebook("Work", undefined, undefined, true);
    expect(parseNotebook("n", archived).archived).toBe(true);
    const renamed = serializeNotebook("Renamed", undefined, archived);
    expect(parseNotebook("n", renamed).archived).toBe(true);
    const restored = serializeNotebook("Renamed", undefined, renamed, false);
    expect(parseNotebook("n", restored).archived).toBeUndefined();
    expect(restored).not.toContain("archived");
  });

  it("round-trips a task list, and a rename keeps it archived", () => {
    const archived = serializeTaskList("Home", undefined, undefined, undefined, true);
    expect(parseTaskList("l", archived).archived).toBe(true);
    const renamed = serializeTaskList("Renamed", undefined, archived);
    expect(parseTaskList("l", renamed).archived).toBe(true);
    const restored = serializeTaskList("Renamed", undefined, renamed, undefined, false);
    expect(restored).not.toContain("archived");
  });

  it("round-trips a bookmark collection, and a hide toggle keeps it archived", () => {
    const archived = serializeBookmarkCollection("Work", undefined, undefined, undefined, undefined, true);
    expect(parseBookmarkCollection("c", archived).archived).toBe(true);
    const hidden = serializeBookmarkCollection("Work", undefined, archived, undefined, true);
    const parsed = parseBookmarkCollection("c", hidden);
    expect(parsed.archived).toBe(true);
    expect(parsed.hideFromAll).toBe(true);
    const restored = serializeBookmarkCollection("Work", undefined, hidden, undefined, undefined, false);
    expect(restored).not.toContain("archived");
  });
});
