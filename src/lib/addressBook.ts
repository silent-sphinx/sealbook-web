import type { AddressBook } from "./types";
import { coreAddressBookParse, coreAddressBookTone, coreAddressBookWrite } from "./wasm";
import { sortContainers } from "./order";

export const JSCONTACT_CONTENT_TYPE = "application/jscontact+json";
export const ADDRESS_BOOK_CONTENT_TYPE =
  "application/sealbook.addressbook+json";
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

/** Mirror of core's `UNTITLED_ADDRESS_BOOK_NAME`; `contactParity.test.ts` asserts it. */
export const UNTITLED_ADDRESS_BOOK_NAME = "Untitled Address Book";

/**
 * The wire form of an address book, which is core's as of the client
 * unification's phase 8: the owned keys, the trim, and the fallback names are
 * one implementation. Throws `PayloadSchema` for a book written by a newer
 * client, which this build may read but must not write over.
 */
export function serializeAddressBook(
  name: string,
  previousRaw?: string,
  archived = false,
  color?: string,
  hideFromAll?: boolean,
): string {
  const stored = previousRaw ? coreAddressBookParse("", previousRaw) : undefined;
  return coreAddressBookWrite({
    name,
    archived,
    hide_from_all: hideFromAll ?? stored?.hide_from_all ?? false,
    color,
    raw: previousRaw,
  });
}

export function parseAddressBook(id: string, raw: string): AddressBook {
  const book = coreAddressBookParse(id, raw);
  return {
    id: book.id,
    name: book.name,
    archived: book.archived || undefined,
    hideFromAll: book.hide_from_all || undefined,
    color: book.color,
    raw: book.raw,
  };
}

export function activeAddressBooks(books: AddressBook[]): AddressBook[] {
  return books.filter((book) => book.archived !== true);
}

export function archivedAddressBooks(books: AddressBook[]): AddressBook[] {
  return books.filter((book) => book.archived === true);
}

/**
 * The books whose contacts are out of the list: a book in play that is marked
 * hidden, which is stored on the book and so follows the account to every
 * device, and an archived one unless it is in `shownArchived`, a choice kept on
 * this device. So an archived book can be switched on for a look without being
 * restored.
 */
export function effectiveHiddenBooks(
  books: AddressBook[],
  shownArchived: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const book of books) {
    const away = book.archived === true ? !shownArchived.has(book.id) : book.hideFromAll === true;
    if (away) out.add(book.id);
  }
  return out;
}

/**
 * A blank id, or the sidebar's `all`, is the default book. A mirror of core's
 * `resolve_address_book_id` rather than a call to it, because this runs once per
 * contact when the search text is built; `contactParity.test.ts` holds them
 * together.
 */
export function resolveAddressBookId(addressBookId?: string): string {
  const trimmed = addressBookId?.trim();
  return trimmed && trimmed !== ALL_ADDRESS_BOOKS
    ? trimmed
    : DEFAULT_ADDRESS_BOOK_ID;
}

export function sortAddressBooks(books: AddressBook[]): AddressBook[] {
  return sortContainers(DEFAULT_ADDRESS_BOOK_ID, books);
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

export function addressBookTone(book: AddressBook): string {
  return coreAddressBookTone(book.id, book.color);
}

export function bookToneById(books: AddressBook[], addressBookId?: string): string {
  const id = resolveAddressBookId(addressBookId);
  return coreAddressBookTone(id, books.find((book) => book.id === id)?.color);
}

const HIDDEN_BOOKS_KEY = "sealbook.hidden-address-books";
const SHOWN_ARCHIVED_BOOKS_KEY = "sealbook.shown-archived-address-books";

function hiddenBooksStorageKey(collectionId: string): string {
  return `${HIDDEN_BOOKS_KEY}.${collectionId}`;
}

function shownArchivedStorageKey(collectionId: string): string {
  return `${SHOWN_ARCHIVED_BOOKS_KEY}.${collectionId}`;
}

/**
 * The books switched off in the sidebar. Held as the exception rather than the
 * selection, so a book added on another device shows up instead of staying
 * hidden until it is found and ticked.
 *
 * localStorage rather than sessionStorage: the choice is meant to survive a
 * reload and a new tab, which is the one thing a filter here is used for.
 */
export function loadHiddenAddressBooks(
  collectionId: string,
  key = hiddenBooksStorageKey,
): Set<string> {
  try {
    const stored = localStorage.getItem(key(collectionId));
    const ids = stored ? JSON.parse(stored) : [];
    return new Set(
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function storeHiddenAddressBooks(
  collectionId: string,
  hidden: ReadonlySet<string>,
  key = hiddenBooksStorageKey,
): void {
  try {
    localStorage.setItem(
      key(collectionId),
      JSON.stringify([...hidden]),
    );
  } catch {
    // Storage unavailable; the choice then lasts for this session only.
  }
}

export function isAddressBookVisible(
  book: AddressBook,
  hidden: ReadonlySet<string>,
): boolean {
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

export function loadShownArchivedBooks(collectionId: string): Set<string> {
  return loadHiddenAddressBooks(collectionId, shownArchivedStorageKey);
}

export function storeShownArchivedBooks(
  collectionId: string,
  shown: ReadonlySet<string>,
): void {
  storeHiddenAddressBooks(collectionId, shown, shownArchivedStorageKey);
}
