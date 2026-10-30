import { coreDraftOf, draftOfCore } from "./contact";
import type { AddressBook, Contact, ContactDraft } from "./types";
import { coreCsvParse, coreCsvWrite } from "./wasm";

/** The contacts in a CSV file, read by core. */
export function parseCsvContacts(text: string, targetAddressBookId: string): ContactDraft[] {
  return coreCsvParse(text, targetAddressBookId).map(draftOfCore);
}

export function serializeCsvContacts(
  contacts: Contact[] | ContactDraft[],
  addressBooks: AddressBook[],
): string {
  return coreCsvWrite(
    (contacts as ContactDraft[]).map((c) => coreDraftOf({ ...c, derivedName: undefined })),
    addressBooks.map(({ id, name, raw }) => ({ id, name, readable: true, raw: raw ?? "" })),
  );
}
