import { coreDraftOf, draftOfCore } from "./contact";
import type { Contact, ContactDraft } from "./types";
import { coreVcardParse, coreVcardWrite } from "./wasm";

/** The cards in a vCard file, read by core. */
export function parseVCard(text: string, targetAddressBookId: string): ContactDraft[] {
  return coreVcardParse(text, targetAddressBookId).map(draftOfCore);
}

export function serializeVCard(contacts: Contact[] | ContactDraft[]): string {
  return coreVcardWrite((contacts as ContactDraft[]).map((c) => coreDraftOf({ ...c, derivedName: undefined })));
}
