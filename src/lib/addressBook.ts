import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import type { AddressBook } from "./types";

export const JSCONTACT_CONTENT_TYPE = "application/jscontact+json";
export const ADDRESS_BOOK_CONTENT_TYPE = "application/sealbook.addressbook+json";
export const ADDRESS_BOOK_ID_PROP = "sealbook:addressBookId";
export const DEFAULT_ADDRESS_BOOK_NAME = "Default Address Book";
export const DEFAULT_ADDRESS_BOOK_ID = "00000000-0000-0000-0000-000000000001";
export const ALL_ADDRESS_BOOKS = "all";

/**
 * The archive, which is a view rather than a stored book: an archived contact
 * keeps its `addressBookId` and carries `sealbook:archived` instead, so nothing
 * has to be moved back on restore. Never written to a card.
 */
export const ARCHIVE_VIEW = "archive";
export const ARCHIVE_VIEW_NAME = "Archived Contacts";

const ADDRESS_BOOK_KEYS = ["@type", "version", "name"] as const;

export function serializeAddressBook(name: string, previousRaw?: string): string {
  return mergePayload(
    previousRaw,
    {
      "@type": "AddressBook",
      version: PAYLOAD_SCHEMA_VERSION,
      name: name.trim(),
    },
    ADDRESS_BOOK_KEYS,
  );
}

export function parseAddressBook(id: string, raw: string): AddressBook {
  try {
    const body = JSON.parse(raw) as { name?: string };
    const name = body.name?.trim() || "Untitled";
    return { id, name, raw };
  } catch {
    return { id, name: raw, raw };
  }
}

export function resolveAddressBookId(addressBookId?: string): string {
  const trimmed = addressBookId?.trim();
  return trimmed || DEFAULT_ADDRESS_BOOK_ID;
}

export function sortAddressBooks(books: AddressBook[]): AddressBook[] {
  return [...books].sort((a, b) => {
    if (a.id === DEFAULT_ADDRESS_BOOK_ID) {
      return -1;
    }
    if (b.id === DEFAULT_ADDRESS_BOOK_ID) {
      return 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function bookNameById(
  books: AddressBook[],
  addressBookId?: string,
): string {
  const id = resolveAddressBookId(addressBookId);
  return (
    books.find((book) => book.id === id)?.name ?? DEFAULT_ADDRESS_BOOK_NAME
  );
}

const HIDDEN_BOOKS_KEY = "sealbook.hidden-address-books";

function hiddenBooksStorageKey(collectionId: string): string {
  return `${HIDDEN_BOOKS_KEY}.${collectionId}`;
}

/**
 * The books switched off in the sidebar. Held as the exception rather than the
 * selection, so a book added on another device shows up instead of staying
 * hidden until it is found and ticked.
 *
 * localStorage rather than sessionStorage: the choice is meant to survive a
 * reload and a new tab, which is the one thing a filter here is used for.
 */
export function loadHiddenAddressBooks(collectionId: string): Set<string> {
  try {
    const stored = localStorage.getItem(hiddenBooksStorageKey(collectionId));
    const ids = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function storeHiddenAddressBooks(collectionId: string, hidden: ReadonlySet<string>): void {
  try {
    localStorage.setItem(hiddenBooksStorageKey(collectionId), JSON.stringify([...hidden]));
  } catch {
    // Storage unavailable; the choice then lasts for this session only.
  }
}

export function isAddressBookVisible(book: AddressBook, hidden: ReadonlySet<string>): boolean {
  return !hidden.has(book.id);
}

export function visibleAddressBooks(
  books: AddressBook[],
  hidden: ReadonlySet<string>,
): AddressBook[] {
  return books.filter((book) => isAddressBookVisible(book, hidden));
}

/**
 * Drops hidden ids with no book behind them, so deleting a book cannot leave a
 * toggle that silently hides a later book reusing its id.
 */
export function pruneHiddenAddressBooks(
  books: AddressBook[],
  hidden: ReadonlySet<string>,
): Set<string> {
  const known = new Set(books.map((book) => book.id));
  return new Set([...hidden].filter((id) => known.has(id)));
}
