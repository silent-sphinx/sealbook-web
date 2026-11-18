import { describe, expect, it } from "vitest";
import { parseAddressBook, serializeAddressBook } from "./addressBook";
import { parseCalendar, serializeCalendar } from "./calendar";
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

describe("hiding a container from the overview", () => {
  it("round-trips a notebook, and a rename or an archive keeps it hidden", () => {
    const hidden = serializeNotebook("Work", undefined, undefined, undefined, true);
    expect(parseNotebook("n", hidden).hideFromAll).toBe(true);
    const renamed = serializeNotebook("Renamed", undefined, hidden);
    expect(parseNotebook("n", renamed).hideFromAll).toBe(true);
    const archived = serializeNotebook("Renamed", undefined, renamed, true);
    expect(parseNotebook("n", archived).hideFromAll).toBe(true);
    const shown = serializeNotebook("Renamed", undefined, archived, undefined, false);
    expect(parseNotebook("n", shown).hideFromAll).toBeUndefined();
    expect(shown).not.toContain("hideFromAll");
  });

  it("round-trips a task list, and a rename keeps it hidden", () => {
    const hidden = serializeTaskList("Home", undefined, undefined, undefined, undefined, true);
    expect(parseTaskList("l", hidden).hideFromAll).toBe(true);
    const renamed = serializeTaskList("Renamed", undefined, hidden);
    expect(parseTaskList("l", renamed).hideFromAll).toBe(true);
    const shown = serializeTaskList("Renamed", undefined, renamed, undefined, undefined, false);
    expect(shown).not.toContain("hideFromAll");
  });

  it("round-trips a calendar and an address book", () => {
    const calendar = serializeCalendar({ name: "Work", color: "#112233", hideFromAll: true });
    expect(parseCalendar("c", calendar).hideFromAll).toBe(true);
    const shownCalendar = serializeCalendar({ name: "Work", color: "#112233", raw: calendar });
    expect(shownCalendar).not.toContain("hideFromAll");

    const book = serializeAddressBook("Family", undefined, false, undefined, true);
    expect(parseAddressBook("b", book).hideFromAll).toBe(true);
    const renamed = serializeAddressBook("Relatives", book);
    expect(parseAddressBook("b", renamed).hideFromAll).toBe(true);
    expect(serializeAddressBook("Relatives", book, false, undefined, false)).not.toContain("hideFromAll");
  });
});
