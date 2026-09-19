import type { AddressBook, Contact, ContactDraft } from "./types";
import { parseVCard, serializeVCard } from "./vcard";
import { parseCsvContacts, serializeCsvContacts } from "./csv";
import { resolveAddressBookId } from "./addressBook";

export type ImportResult = {
  format: "vCard" | "CSV" | "JSON";
  contacts: ContactDraft[];
};

export type ExportFormat = "vcf" | "csv" | "json";

export function parseImportContent(
  filename: string,
  content: string,
  targetAddressBookId: string,
): ImportResult {
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

      const drafts: ContactDraft[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const name = (item.name || "").trim();
        if (!name) continue;

        drafts.push({
          name,
          nickname: item.nickname || undefined,
          pronouns: item.pronouns || undefined,
          emails: Array.isArray(item.emails) ? item.emails : [],
          phones: Array.isArray(item.phones) ? item.phones : [],
          dates: Array.isArray(item.dates) ? item.dates : [],
          socials: Array.isArray(item.socials) ? item.socials : [],
          notes: item.notes || undefined,
          avatar: item.avatar || undefined,
          address: item.address || undefined,
          work: Array.isArray(item.work) ? item.work : [],
          addressBookId: resolveAddressBookId(
            item.addressBookId || targetAddressBookId,
          ),
          createdAt: item.createdAt || undefined,
          updatedAt: item.updatedAt || undefined,
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
      emails: c.emails,
      phones: c.phones,
      address: c.address,
      work: c.work,
      addressBookId: c.addressBookId,
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
