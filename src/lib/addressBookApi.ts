import {
  ADDRESS_BOOK_CONTENT_TYPE,
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_ADDRESS_BOOK_NAME,
  JSCONTACT_CONTENT_TYPE,
  serializeAddressBook,
  sortAddressBooks,
} from "./addressBook";
import { contactFitsObjectLimit, serializeCard } from "./contact";
import { putSealed } from "./client";
import type { AddressBook, ContactDraft } from "./types";
import type { Session } from "./client";
import { newUuid } from "./wasm";

export async function ensureDefaultAddressBook(
  session: Session,
  books: AddressBook[],
): Promise<AddressBook[]> {
  if (books.some((book) => book.id === DEFAULT_ADDRESS_BOOK_ID)) {
    return sortAddressBooks(books);
  }
  await putAddressBook(session, DEFAULT_ADDRESS_BOOK_NAME, DEFAULT_ADDRESS_BOOK_ID);
  return sortAddressBooks([
    {
      id: DEFAULT_ADDRESS_BOOK_ID,
      name: DEFAULT_ADDRESS_BOOK_NAME,
      raw: serializeAddressBook(DEFAULT_ADDRESS_BOOK_NAME),
    },
    ...books,
  ]);
}

export async function putAddressBook(
  session: Session,
  name: string,
  id = newUuid(),
  previousRaw?: string,
): Promise<string> {
  const plaintext = serializeAddressBook(name, previousRaw);
  await putSealed(session, id, ADDRESS_BOOK_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function deleteAddressBook(
  session: Session,
  id: string,
): Promise<void> {
  await putSealed(session, id, ADDRESS_BOOK_CONTENT_TYPE, true, "");
}

export async function putContact(
  session: Session,
  draft: ContactDraft,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  if (!contactFitsObjectLimit(draft)) {
    throw new Error("This contact is too large to store.");
  }
  const plaintext = serializeCard(draft);
  await putSealed(session, id, JSCONTACT_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function deleteContact(
  session: Session,
  id: string,
): Promise<void> {
  await putSealed(session, id, JSCONTACT_CONTENT_TYPE, true, "");
}
