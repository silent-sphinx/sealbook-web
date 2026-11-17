import { describe, expect, it } from "vitest";
import { readFixture } from "../test/fixtures";
import { buildVaultIndex, searchInputs, type SearchData } from "./vaultSearch";
import { coreVaultIndex, type CoreSearchContainer, type CoreSearchHit, type CoreSearchSource } from "./wasm";
import type {
  AddressBook,
  Bookmark,
  BookmarkCollection,
  Calendar,
  CalendarEvent,
  Contact,
  Note,
  Notebook,
  Task,
  TaskList,
} from "./types";

const fixture = JSON.parse(readFixture("payloads/vault-search.json")) as {
  contacts: { id: string; raw: string }[];
  sources: CoreSearchSource[];
  containers: CoreSearchContainer[];
  queries: { case: string; query: string; per_kind: number; hits: CoreSearchHit[] }[];
};

describe("vault search", () => {
  const index = coreVaultIndex(fixture.contacts, [], fixture.sources, fixture.containers);

  it.each(fixture.queries)("matches the fixture: $case", ({ query, per_kind, hits }) => {
    expect(index.search(query, per_kind)).toEqual(hits);
  });
});

const raw = (payload: object) => JSON.stringify(payload);

function data(overrides: Partial<SearchData>): SearchData {
  return {
    contacts: [],
    addressBooks: [],
    notes: [],
    notebooks: [],
    tasks: [],
    taskLists: [],
    bookmarks: [],
    collections: [],
    events: [],
    calendars: [],
    enabled: () => true,
    ...overrides,
  };
}

describe("what the palette searches", () => {
  it("leaves out finished tasks, archived calendars and hidden collections", () => {
    const vault = data({
      tasks: [
        { id: "open", done: false, raw: raw({ title: "Lunch open" }) } as Task,
        { id: "done", done: true, raw: raw({ title: "Lunch done", done: true }) } as Task,
      ],
      calendars: [{ id: "old", name: "Old", archived: true } as Calendar],
      events: [
        { id: "kept", raw: raw({ title: "Lunch", start: "2026-11-10T12:00:00Z" }) } as CalendarEvent,
        {
          id: "gone",
          calendarId: "old",
          raw: raw({ title: "Lunch", start: "2026-11-10T12:00:00Z", calendarId: "old" }),
        } as CalendarEvent,
      ],
      collections: [
        { id: "top", name: "Top", hideFromAll: true } as BookmarkCollection,
        { id: "child", name: "Child", parentId: "top" } as BookmarkCollection,
      ],
      bookmarks: [
        { id: "nested", collectionId: "child", raw: raw({ url: "https://a.example", title: "Lunch spots", collectionId: "child" }) } as Bookmark,
      ],
    });
    const hits = buildVaultIndex(vault).search("lunch", 10);
    expect(hits.map((hit) => hit.id)).toEqual(["kept", "open"]);
  });

  it("leaves out whatever sits in an archived notebook, list or collection", () => {
    const vault = data({
      notebooks: [
        { id: "old", name: "Old", archived: true } as Notebook,
        { id: "live", name: "Live" } as Notebook,
      ],
      notes: [
        { id: "n-old", notebookId: "old", raw: raw({ title: "Lunch plan", notebookId: "old" }) } as Note,
        { id: "n-live", notebookId: "live", raw: raw({ title: "Lunch plan", notebookId: "live" }) } as Note,
      ],
      taskLists: [
        { id: "l-old", name: "Old", archived: true } as TaskList,
        { id: "l-sub", name: "Sub", parentId: "l-old" } as TaskList,
      ],
      tasks: [
        { id: "t-old", done: false, taskListId: "l-old", raw: raw({ title: "Lunch task", taskListId: "l-old" }) } as Task,
        { id: "t-sub", done: false, taskListId: "l-sub", raw: raw({ title: "Lunch task", taskListId: "l-sub" }) } as Task,
      ],
      collections: [{ id: "c-old", name: "Old", archived: true } as BookmarkCollection],
      bookmarks: [
        { id: "b-old", collectionId: "c-old", raw: raw({ url: "https://a.example", title: "Lunch spots", collectionId: "c-old" }) } as Bookmark,
      ],
    });
    expect(buildVaultIndex(vault).search("lunch", 10).map((hit) => hit.id)).toEqual(["n-live"]);
  });

  it("leaves out archived contacts and contacts in archived books", () => {
    const { contacts } = searchInputs(
      data({
        addressBooks: [{ id: "shelf", name: "Shelf", archived: true } as AddressBook],
        contacts: [
          { id: "live", raw: "{}" } as Contact,
          { id: "archived", archived: true, raw: "{}" } as Contact,
          { id: "shelved", addressBookId: "shelf", raw: "{}" } as Contact,
        ],
      }),
    );
    expect(contacts.map((contact) => contact.id)).toEqual(["live"]);
  });

  it("indexes nothing for a disabled feature", () => {
    const { sources } = searchInputs(
      data({
        notes: [{ id: "n", raw: raw({ title: "Lunch" }) } as SearchData["notes"][number]],
        enabled: (feature) => feature !== "notes",
      }),
    );
    expect(sources).toEqual([]);
  });
});
