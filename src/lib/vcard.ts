import { coreDraftOf, draftOfCore } from "./contact";
import type { Contact, ContactDraft } from "./types";
import { coreVcardImport, coreVcardWrite } from "./wasm";

export type ContactImport = {
  contacts: ContactDraft[];
  skipped: { label: string; reason: string }[];
};

/** The cards in a vCard file, and the ones left out, read by core. */
export function importVCard(text: string, targetAddressBookId: string): ContactImport {
  const { contacts, skipped } = coreVcardImport(text, targetAddressBookId);
  return { contacts: contacts.map(draftOfCore), skipped };
}

export function parseVCard(text: string, targetAddressBookId: string): ContactDraft[] {
  return importVCard(text, targetAddressBookId).contacts;
}

export function serializeVCard(contacts: Contact[] | ContactDraft[]): string {
  return coreVcardWrite((contacts as ContactDraft[]).map((c) => coreDraftOf({ ...c, derivedName: undefined })));
}
