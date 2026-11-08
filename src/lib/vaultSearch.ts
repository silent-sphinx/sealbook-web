import { resolveAddressBookId } from "./addressBook";
import { buildCollectionTree, hiddenFromAllIds, resolveCollectionId } from "./bookmark";
import type {
  AddressBook,
  Bookmark,
  BookmarkCollection,
  Calendar,
  CalendarEvent,
  Contact,
  FeatureKey,
  Note,
  Notebook,
  Task,
  TaskList,
} from "./types";
import {
  coreVaultIndex,
  type CoreSearchContainer,
  type CoreSearchHit,
  type CoreSearchKind,
  type CoreSearchSource,
  type VaultSearchIndex,
} from "./wasm";

export type SearchHit = CoreSearchHit;
export type SearchKind = CoreSearchKind;

export type SearchData = {
  contacts: Contact[];
  addressBooks: AddressBook[];
  notes: Note[];
  notebooks: Notebook[];
  tasks: Task[];
  taskLists: TaskList[];
  bookmarks: Bookmark[];
  collections: BookmarkCollection[];
  events: CalendarEvent[];
  calendars: Calendar[];
  enabled: (feature: FeatureKey) => boolean;
};

/** The feature tab each kind of result opens in. */
export const KIND_FEATURE: Record<SearchKind, FeatureKey> = {
  contact: "contacts",
  event: "calendar",
  note: "notes",
  bookmark: "bookmarks",
  task: "tasks",
};

/**
 * What the palette searches: what each tab lists by default. Archived
 * contacts and books, finished tasks, bookmarks kept out of "All Bookmarks"
 * and events in archived calendars are left out, as is any disabled feature.
 */
export function searchInputs(data: SearchData) {
  const containers: CoreSearchContainer[] = [];
  const sources: CoreSearchSource[] = [];
  const add = (kind: SearchKind, items: { id: string; raw?: string }[]) => {
    for (const { id, raw } of items) if (raw) sources.push({ kind, id, raw });
  };
  const name = (kind: SearchKind, items: { id: string; name: string }[]) => {
    for (const { id, name } of items) containers.push({ kind, id, name });
  };

  let contacts: Contact[] = [];
  let books: { id: string; name: string }[] = [];
  if (data.enabled("contacts")) {
    const archivedBooks = new Set(
      data.addressBooks.filter((book) => book.archived).map((book) => book.id),
    );
    contacts = data.contacts.filter(
      (contact) =>
        contact.archived !== true &&
        !archivedBooks.has(resolveAddressBookId(contact.addressBookId)),
    );
    books = data.addressBooks.map(({ id, name }) => ({ id, name }));
  }
  if (data.enabled("calendar")) {
    const archived = new Set(
      data.calendars.filter((calendar) => calendar.archived).map((calendar) => calendar.id),
    );
    add("event", data.events.filter((event) => !event.calendarId || !archived.has(event.calendarId)));
    name("event", data.calendars);
  }
  if (data.enabled("notes")) {
    add("note", data.notes);
    name("note", data.notebooks);
  }
  if (data.enabled("bookmarks")) {
    const hidden = hiddenFromAllIds(buildCollectionTree(data.collections));
    add(
      "bookmark",
      data.bookmarks.filter((bookmark) => !hidden.has(resolveCollectionId(bookmark.collectionId))),
    );
    name("bookmark", data.collections);
  }
  if (data.enabled("tasks")) {
    add("task", data.tasks.filter((task) => !task.done));
    name("task", data.taskLists);
  }
  return { contacts, books, sources, containers };
}

export function buildVaultIndex(data: SearchData): VaultSearchIndex {
  const { contacts, books, sources, containers } = searchInputs(data);
  return coreVaultIndex(contacts, books, sources, containers);
}
