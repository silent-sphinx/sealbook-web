import type { AddressBook } from "./types";

export const JSCONTACT_CONTENT_TYPE = "application/jscontact+json";
export const ADDRESS_BOOK_CONTENT_TYPE = "application/sealbook.addressbook+json";
export const ADDRESS_BOOK_ID_PROP = "sealbook:addressBookId";
export const DEFAULT_ADDRESS_BOOK_NAME = "Default Address Book";
export const DEFAULT_ADDRESS_BOOK_ID = "00000000-0000-0000-0000-000000000001";
export const ALL_ADDRESS_BOOKS = "all";

export function serializeAddressBook(name: string): string {
  return JSON.stringify({
    "@type": "AddressBook",
    version: "1.0",
    name: name.trim(),
  });
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
