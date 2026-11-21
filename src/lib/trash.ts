import { coreTrashHidden, type CorePayloadKind, type TrashNode } from "./wasm";
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

/** Every kind of item the trash holds, by the listing's own field names. */
export type TrashableItems = {
  addressBooks: AddressBook[];
  contacts: Contact[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  notebooks: Notebook[];
  bookmarks: Bookmark[];
  bookmarkCollections: BookmarkCollection[];
  tasks: Task[];
  taskLists: TaskList[];
};

/** What is in the trash, and everything hidden inside it, with the nodes for core's rules. */
export type TrashListing = TrashableItems & { nodes: TrashNode[] };

export type TrashItem =
  | { kind: "address_book"; item: AddressBook }
  | { kind: "contact"; item: Contact }
  | { kind: "calendar"; item: Calendar }
  | { kind: "calendar_event"; item: CalendarEvent }
  | { kind: "note"; item: Note }
  | { kind: "notebook"; item: Notebook }
  | { kind: "bookmark"; item: Bookmark }
  | { kind: "bookmark_collection"; item: BookmarkCollection }
  | { kind: "task"; item: Task }
  | { kind: "task_list"; item: TaskList };

export type TrashKind = TrashItem["kind"] & CorePayloadKind;

export function emptyTrash(): TrashListing {
  return { ...emptyItems(), nodes: [] };
}

/** For a view rendered without a trash, such as in a test. */
export const NO_TRASH: TrashListing = emptyTrash();

function emptyItems(): TrashableItems {
  return {
    addressBooks: [],
    contacts: [],
    calendars: [],
    calendarEvents: [],
    notes: [],
    notebooks: [],
    bookmarks: [],
    bookmarkCollections: [],
    tasks: [],
    taskLists: [],
  };
}

function node(
  id: string,
  kind: TrashKind,
  trashedAt: string | undefined,
  parentId?: string,
  containerId?: string,
): TrashNode {
  return {
    id,
    kind,
    parent_id: parentId,
    container_id: containerId,
    trashed_at: trashedAt,
  };
}

/** One node per item, parents and containers named as core expects. */
export function trashNodes(items: TrashableItems): TrashNode[] {
  return [
    ...items.addressBooks.map((book) => node(book.id, "address_book", book.trashedAt)),
    ...items.contacts.map((contact) =>
      node(contact.id, "contact", contact.trashedAt, undefined, contact.addressBookId),
    ),
    ...items.calendars.map((calendar) => node(calendar.id, "calendar", calendar.trashedAt)),
    ...items.calendarEvents.map((event) =>
      node(event.id, "calendar_event", event.trashedAt, undefined, event.calendarId),
    ),
    ...items.notebooks.map((notebook) => node(notebook.id, "notebook", notebook.trashedAt, notebook.parentId)),
    ...items.notes.map((note) =>
      node(note.id, "note", note.trashedAt, note.parentId, note.notebookId),
    ),
    ...items.bookmarkCollections.map((collection) =>
      node(collection.id, "bookmark_collection", collection.trashedAt, collection.parentId),
    ),
    ...items.bookmarks.map((bookmark) =>
      node(bookmark.id, "bookmark", bookmark.trashedAt, undefined, bookmark.collectionId),
    ),
    ...items.taskLists.map((list) => node(list.id, "task_list", list.trashedAt, list.parentId)),
    ...items.tasks.map((task) =>
      node(task.id, "task", task.trashedAt, task.parentId, task.taskListId),
    ),
  ];
}

/**
 * Splits a listing into what the views show and what the trash holds. An item
 * is in the trash when it, a parent or its container is.
 */
export function splitTrash<T extends TrashableItems>(
  items: T,
): { live: T; trash: TrashListing } {
  const nodes = trashNodes(items);
  if (!nodes.some((each) => each.trashed_at)) {
    return { live: items, trash: { ...emptyItems(), nodes } };
  }
  const hidden = coreTrashHidden(nodes);
  const live = { ...items };
  const trash: TrashListing = { ...emptyItems(), nodes };
  const keys = Object.keys(emptyItems()) as (keyof TrashableItems)[];
  for (const key of keys) {
    const all = items[key] as { id: string }[];
    (live[key] as { id: string }[]) = all.filter((item) => !hidden.has(item.id));
    (trash[key] as { id: string }[]) = all.filter((item) => hidden.has(item.id));
  }
  return { live, trash };
}

/** The item a node names, with its kind. */
export function findTrashItem(trash: TrashListing, id: string): TrashItem | undefined {
  const pick = <K extends TrashItem["kind"]>(
    kind: K,
    list: { id: string }[],
  ): TrashItem | undefined => {
    const item = list.find((each) => each.id === id);
    return item ? ({ kind, item } as TrashItem) : undefined;
  };
  return (
    pick("address_book", trash.addressBooks) ??
    pick("contact", trash.contacts) ??
    pick("calendar", trash.calendars) ??
    pick("calendar_event", trash.calendarEvents) ??
    pick("notebook", trash.notebooks) ??
    pick("note", trash.notes) ??
    pick("bookmark_collection", trash.bookmarkCollections) ??
    pick("bookmark", trash.bookmarks) ??
    pick("task_list", trash.taskLists) ??
    pick("task", trash.tasks)
  );
}

/** The name the trash lists an item under. */
export function trashItemTitle(entry: TrashItem): string {
  switch (entry.kind) {
    case "address_book":
    case "calendar":
    case "notebook":
    case "bookmark_collection":
    case "task_list":
    case "contact":
      return entry.item.name;
    case "calendar_event":
    case "note":
    case "bookmark":
    case "task":
      return entry.item.title;
  }
}

/** Which tab's trash an item kind belongs in. */
export type TrashTab = "contacts" | "calendar" | "notes" | "bookmarks" | "tasks";

export const TRASH_TAB_KINDS: Record<TrashTab, readonly TrashKind[]> = {
  contacts: ["contact", "address_book"],
  calendar: ["calendar_event", "calendar"],
  notes: ["note", "notebook"],
  bookmarks: ["bookmark", "bookmark_collection"],
  tasks: ["task", "task_list"],
};
