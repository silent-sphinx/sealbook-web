import type {
  Contact,
  ContactAddress,
  ContactChannel,
  ContactChannelKind,
  ContactDraft,
  ContactWork,
} from "./types";
import { emptyChannel } from "./contact";

function newId(): string {
  return crypto.randomUUID();
}

function unescapeVCard(val: string): string {
  return val
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function escapeVCard(val: string): string {
  return val
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

type ParsedProp = {
  name: string;
  params: Record<string, string>;
  value: string;
};

function parseLine(raw: string): ParsedProp | null {
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) return null;

  const left = raw.slice(0, colonIdx);
  const value = raw.slice(colonIdx + 1);

  const parts = left.split(";");
  const name = parts[0].trim().toUpperCase();
  const params: Record<string, string> = {};

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!p) continue;
    const eqIdx = p.indexOf("=");
    if (eqIdx !== -1) {
      const k = p.slice(0, eqIdx).trim().toUpperCase();
      const v = p.slice(eqIdx + 1).trim();
      params[k] = v;
    } else {
      // e.g. TEL;CELL:123
      params[p.toUpperCase()] = "true";
    }
  }

  return { name, params, value };
}

export function parseVCard(
  text: string,
  targetAddressBookId: string,
): ContactDraft[] {
  // 1. Unfold lines (RFC 2426 / RFC 6350: lines starting with space or tab continue previous line)
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const contacts: ContactDraft[] = [];
  let inCard = false;
  let currentLines: ParsedProp[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toUpperCase() === "BEGIN:VCARD") {
      inCard = true;
      currentLines = [];
      continue;
    }

    if (trimmed.toUpperCase() === "END:VCARD") {
      if (inCard && currentLines.length > 0) {
        const contact = buildContactFromProps(currentLines, targetAddressBookId);
        if (contact) {
          contacts.push(contact);
        }
      }
      inCard = false;
      currentLines = [];
      continue;
    }

    if (inCard) {
      const prop = parseLine(trimmed);
      if (prop) {
        currentLines.push(prop);
      }
    }
  }

  // Handle case where BEGIN/END tags might be missing for a single card
  if (contacts.length === 0 && currentLines.length > 0) {
    const single = buildContactFromProps(currentLines, targetAddressBookId);
    if (single) contacts.push(single);
  }

  return contacts;
}

function buildContactFromProps(
  props: ParsedProp[],
  addressBookId: string,
): ContactDraft | null {
  let fn = "";
  let familyName = "";
  let givenName = "";
  let nickname = "";
  const emails: ContactChannel[] = [];
  const phones: ContactChannel[] = [];
  let address: ContactAddress | undefined = undefined;
  let orgName = "";
  let jobTitle = "";

  for (const prop of props) {
    switch (prop.name) {
      case "FN":
        fn = unescapeVCard(prop.value);
        break;

      case "N": {
        const parts = prop.value.split(";").map(unescapeVCard);
        familyName = parts[0] || "";
        givenName = parts[1] || "";
        break;
      }

      case "NICKNAME":
        nickname = unescapeVCard(prop.value);
        break;

      case "EMAIL": {
        const emailVal = unescapeVCard(prop.value);
        if (emailVal) {
          const typeParam = (
            prop.params["TYPE"] ||
            Object.keys(prop.params)[0] ||
            ""
          ).toLowerCase();
          let kind: ContactChannelKind = "home";
          let label: string | undefined = undefined;

          if (typeParam.includes("work")) {
            kind = "work";
          } else if (typeParam.includes("home")) {
            kind = "home";
          } else if (typeParam) {
            kind = "custom";
            label = typeParam;
          }

          emails.push({
            id: newId(),
            kind,
            label,
            value: emailVal,
          });
        }
        break;
      }

      case "TEL": {
        const phoneVal = unescapeVCard(prop.value);
        if (phoneVal) {
          const typeParam = (
            prop.params["TYPE"] ||
            Object.keys(prop.params).join(",")
          ).toLowerCase();
          let kind: ContactChannelKind = "mobile";
          let label: string | undefined = undefined;

          if (typeParam.includes("cell") || typeParam.includes("mobile")) {
            kind = "mobile";
          } else if (typeParam.includes("work")) {
            kind = "work";
          } else if (typeParam.includes("home")) {
            kind = "home";
          } else if (typeParam) {
            kind = "custom";
            label = typeParam;
          }

          phones.push({
            id: newId(),
            kind,
            label,
            value: phoneVal,
          });
        }
        break;
      }

      case "ADR": {
        // Post office box; extended address; street address; locality; region; postal code; country
        const parts = prop.value.split(";").map(unescapeVCard);
        const street1 = parts[2] || parts[1] || "";
        const street2 = parts[2] && parts[1] ? parts[1] : "";
        const locality = parts[3] || "";
        const region = parts[4] || "";
        const postcode = parts[5] || "";
        const country = parts[6] || "";

        if (street1 || locality || region || postcode || country) {
          address = {
            street1: street1 || undefined,
            street2: street2 || undefined,
            locality: locality || undefined,
            region: region || undefined,
            postcode: postcode || undefined,
            country: country || undefined,
          };
        }
        break;
      }

      case "ORG": {
        const orgParts = prop.value.split(";").map(unescapeVCard);
        orgName = orgParts[0] || "";
        break;
      }

      case "TITLE":
        jobTitle = unescapeVCard(prop.value);
        break;
    }
  }

  // Resolve best name
  let name = fn;
  if (!name && (givenName || familyName)) {
    name = `${givenName} ${familyName}`.trim();
  }
  if (!name && emails.length > 0) {
    name = emails[0].value.split("@")[0];
  }
  if (!name && phones.length > 0) {
    name = phones[0].value;
  }
  if (!name) {
    return null;
  }

  const work: ContactWork[] = [];
  if (orgName || jobTitle) {
    work.push({
      id: newId(),
      organization: orgName,
      title: jobTitle || undefined,
    });
  }

  if (emails.length === 0) {
    emails.push(emptyChannel("home"));
  }
  if (phones.length === 0) {
    phones.push(emptyChannel("mobile"));
  }

  return {
    name,
    nickname: nickname || undefined,
    emails,
    phones,
    address,
    work,
    addressBookId,
  };
}

export function serializeVCard(contacts: Contact[] | ContactDraft[]): string {
  const cards: string[] = [];

  for (const c of contacts) {
    const lines: string[] = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${escapeVCard(c.name)}`,
    ];

    // N: Family;Given;Additional;Prefix;Suffix
    const nameParts = c.name.trim().split(/\s+/);
    if (nameParts.length > 1) {
      const given = nameParts[0];
      const family = nameParts.slice(1).join(" ");
      lines.push(`N:${escapeVCard(family)};${escapeVCard(given)};;;`);
    } else {
      lines.push(`N:${escapeVCard(c.name)};;;;`);
    }

    if (c.nickname) {
      lines.push(`NICKNAME:${escapeVCard(c.nickname)}`);
    }

    for (const em of c.emails) {
      if (!em.value.trim()) continue;
      const type =
        em.kind === "work" ? "WORK" : em.kind === "custom" && em.label ? em.label.toUpperCase() : "HOME";
      lines.push(`EMAIL;TYPE=${type}:${escapeVCard(em.value.trim())}`);
    }

    for (const ph of c.phones) {
      if (!ph.value.trim()) continue;
      const type =
        ph.kind === "mobile"
          ? "CELL"
          : ph.kind === "work"
            ? "WORK"
            : ph.kind === "custom" && ph.label
              ? ph.label.toUpperCase()
              : "HOME";
      lines.push(`TEL;TYPE=${type}:${escapeVCard(ph.value.trim())}`);
    }

    if (c.address) {
      const a = c.address;
      const poBox = "";
      const ext = a.street2 ? escapeVCard(a.street2) : "";
      const street = a.street1 ? escapeVCard(a.street1) : "";
      const locality = a.locality ? escapeVCard(a.locality) : "";
      const region = a.region ? escapeVCard(a.region) : "";
      const postCode = a.postcode ? escapeVCard(a.postcode) : "";
      const country = a.country ? escapeVCard(a.country) : "";

      if (street || locality || region || postCode || country) {
        lines.push(`ADR;TYPE=HOME:${poBox};${ext};${street};${locality};${region};${postCode};${country}`);
      }
    }

    for (const w of c.work) {
      if (w.organization?.trim()) {
        lines.push(`ORG:${escapeVCard(w.organization.trim())}`);
      }
      if (w.title?.trim()) {
        lines.push(`TITLE:${escapeVCard(w.title.trim())}`);
      }
    }

    lines.push("END:VCARD");
    cards.push(lines.join("\r\n"));
  }

  return cards.join("\r\n\r\n");
}
