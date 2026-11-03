import type { AddressBook, Contact, ContactDraft } from "./types";
import { draftOfCore } from "./contact";
import { serializeVCard } from "./vcard";
import { serializeCsvContacts } from "./csv";
import { coreContactsImport, coreErrorOf } from "./wasm";

export type ImportResult = {
  format: "vCard" | "CSV" | "JSON";
  contacts: ContactDraft[];
  /** Cards or rows the file held that could not be used. */
  skipped: { label: string; reason: string }[];
};

export type ExportFormat = "vcf" | "csv" | "json";

export function parseImportContent(
  filename: string,
  content: string,
  targetAddressBookId: string,
): ImportResult {
  try {
    const file = coreContactsImport(filename, content, targetAddressBookId);
    return { ...file, contacts: file.contacts.map(draftOfCore) } as ImportResult;
  } catch (error) {
    const core = coreErrorOf(error);
    throw core?.kind === "Malformed" ? new Error(core.detail) : error;
  }
}

export function generateExportData(
  format: ExportFormat,
  contacts: Contact[],
  addressBooks: AddressBook[],
): { filename: string; mime: string; data: string } {
  const date = new Date().toISOString().slice(0, 10);

  if (format === "vcf") {
    const data = serializeVCard(contacts);
    return {
      filename: `sealbook-contacts-${date}.vcf`,
      mime: "text/vcard;charset=utf-8",
      data,
    };
  }

  if (format === "csv") {
    const data = serializeCsvContacts(contacts, addressBooks);
    return {
      filename: `sealbook-contacts-${date}.csv`,
      mime: "text/csv;charset=utf-8",
      data,
    };
  }

  // JSON format
  const exportPayload = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    addressBooks: addressBooks.map((b) => ({ id: b.id, name: b.name })),
    contacts: contacts.map((c) => ({
      name: c.name,
      nickname: c.nickname,
      pronouns: c.pronouns,
      emails: c.emails,
      phones: c.phones,
      addresses: c.addresses,
      work: c.work,
      dates: c.dates,
      socials: c.socials,
      notes: c.notes,
      avatar: c.avatar,
      addressBookId: c.addressBookId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  };

  return {
    filename: `sealbook-contacts-backup-${date}.json`,
    mime: "application/json;charset=utf-8",
    data: JSON.stringify(exportPayload, null, 2),
  };
}

export function triggerDownload(filename: string, mime: string, data: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
