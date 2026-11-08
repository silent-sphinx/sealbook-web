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
  Task,
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
