import type { AddressBook, Contact, ContactDraft } from "./types";
import { parseVCard, serializeVCard } from "./vcard";
import { parseCsvContacts, serializeCsvContacts } from "./csv";
import { resolveAddressBookId } from "./addressBook";

export type ImportResult = {
  format: "vCard" | "CSV" | "JSON";
  contacts: ContactDraft[];
};

export type ExportFormat = "vcf" | "csv" | "json";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORTED_CONTACTS = 1_000;
const MAX_CONTACT_LIST_ITEMS = 100;

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 100_000 ? value : undefined;
}

function objectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_CONTACT_LIST_ITEMS)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export function parseImportContent(
  filename: string,
  content: string,
  targetAddressBookId: string,
): ImportResult {
  if (content.length > MAX_IMPORT_BYTES) {
    throw new Error("Import file is too large (maximum 5 MB). ");
  }
  const trimmed = content.trim();
  const lowerName = filename.toLowerCase();

  // 1. JSON check
  if (
    lowerName.endsWith(".json") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{")
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.contacts)
          ? parsed.contacts
          : [parsed];
      if (list.length > MAX_IMPORTED_CONTACTS) {
        throw new Error("Import contains too many contacts (maximum 1,000).");
      }

      const drafts: ContactDraft[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const name = stringField(item.name)?.trim() ?? "";
        if (!name) continue;

        drafts.push({
          name,
          nickname: stringField(item.nickname),
          pronouns: stringField(item.pronouns),
          emails: objectList(item.emails) as ContactDraft["emails"],
          phones: objectList(item.phones) as ContactDraft["phones"],
          dates: objectList(item.dates) as ContactDraft["dates"],
          socials: objectList(item.socials) as ContactDraft["socials"],
          notes: stringField(item.notes),
          avatar: stringField(item.avatar),
          address: item.address && typeof item.address === "object" ? item.address as ContactDraft["address"] : undefined,
          work: objectList(item.work) as ContactDraft["work"],
          addressBookId: resolveAddressBookId(
            stringField(item.addressBookId) || targetAddressBookId,
          ),
          createdAt: stringField(item.createdAt),
          updatedAt: stringField(item.updatedAt),
        });
      }

      if (drafts.length > 0) {
        return { format: "JSON", contacts: drafts };
      }
    } catch {
      // Not JSON, continue to vCard or CSV
    }
  }

  // 2. vCard check
  if (lowerName.endsWith(".vcf") || trimmed.toUpperCase().includes("BEGIN:VCARD")) {
    const contacts = parseVCard(trimmed, targetAddressBookId);
    if (contacts.length > 0) {
      return { format: "vCard", contacts };
    }
  }

  // 3. Fallback to CSV
  const contacts = parseCsvContacts(trimmed, targetAddressBookId);
  return { format: "CSV", contacts };
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
      address: c.address,
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
