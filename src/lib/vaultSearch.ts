import { resolveAddressBookId } from "./addressBook";
import { archivedIds } from "./archive";
import { resolveCollectionId } from "./bookmark";
import { resolveNotebookId } from "./note";
import { resolveTaskListId } from "./task";
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
 * contacts and books, anything in an archived notebook, list or collection,
 * finished tasks and events in archived calendars are left out, as is any
 * disabled feature. Hiding a container from the overviews does not leave its
 * contents out.
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
    const archived = archivedIds(data.notebooks);
    add("note", data.notes.filter((note) => !archived.has(resolveNotebookId(note.notebookId))));
    name("note", data.notebooks.filter((notebook) => !archived.has(notebook.id)));
  }
  if (data.enabled("bookmarks")) {
    const archived = archivedIds(data.collections);
    add(
      "bookmark",
      data.bookmarks.filter((bookmark) => !archived.has(resolveCollectionId(bookmark.collectionId))),
    );
    name("bookmark", data.collections.filter((collection) => !archived.has(collection.id)));
  }
  if (data.enabled("tasks")) {
    const archived = archivedIds(data.taskLists);
    add(
      "task",
      data.tasks.filter((task) => !task.done && !archived.has(resolveTaskListId(task.taskListId))),
    );
    name("task", data.taskLists.filter((list) => !archived.has(list.id)));
  }
  return { contacts, books, sources, containers };
}

export function buildVaultIndex(data: SearchData): VaultSearchIndex {
  const { contacts, books, sources, containers } = searchInputs(data);
  return coreVaultIndex(contacts, books, sources, containers);
}
