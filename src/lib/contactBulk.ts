import type { Contact, ContactDraft } from "./types";

/** One edit applied to every contact in a bulk selection. */
export type ContactBulkChange =
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "move"; addressBookId: string };

/**
 * The draft a contact is saved as under a bulk change. `archived` is cleared
 * rather than written false, as the single-contact toggle does, so a restored
 * card reads as one that was never archived.
 */
export function applyBulkChange(contact: Contact, change: ContactBulkChange): ContactDraft {
  switch (change.kind) {
    case "archive":
      return { ...contact, archived: true };
    case "restore":
      return { ...contact, archived: undefined };
    case "move":
      return { ...contact, addressBookId: change.addressBookId };
  }
}
