import { coreDraftOf, draftOfCore } from "./contact";
import type { ContactImport } from "./vcard";
import type { AddressBook, Contact, ContactDraft } from "./types";
import { coreCsvImport, coreCsvWrite } from "./wasm";

/** The contacts in a CSV file, and the rows left out, read by core. */
export function importCsvContacts(text: string, targetAddressBookId: string): ContactImport {
  const { contacts, skipped } = coreCsvImport(text, targetAddressBookId);
  return { contacts: contacts.map(draftOfCore), skipped };
}

export function parseCsvContacts(text: string, targetAddressBookId: string): ContactDraft[] {
  return importCsvContacts(text, targetAddressBookId).contacts;
}

export function serializeCsvContacts(
  contacts: Contact[] | ContactDraft[],
  addressBooks: AddressBook[],
): string {
  return coreCsvWrite(
    (contacts as ContactDraft[]).map((c) => coreDraftOf({ ...c, derivedName: undefined })),
    addressBooks.map(({ id, name, archived, raw }) => ({
      id,
      name,
      archived: archived ?? false,
      readable: true,
      raw: raw ?? "",
    })),
  );
}
