import type {
  AddressBook,
  Contact,
  ContactAddress,
  ContactChannel,
  ContactDraft,
  ContactWork,
} from "./types";
import { emptyChannel } from "./contact";
import { bookNameById } from "./addressBook";

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Robust RFC 4180 CSV parser.
 * Handles commas inside quotes, escaped quotes (""), and multiline cells.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuote = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuote) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // End of quote
          insideQuote = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuote = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentCell.trim());
        currentCell = "";
        i++;
        continue;
      } else if (char === "\r" || char === "\n") {
        currentRow.push(currentCell.trim());
        currentCell = "";
        // Don't add completely empty trailing row
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        if (char === "\r" && nextChar === "\n") {
          i += 2;
        } else {
          i++;
        }
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function escapeCsv(value: string | undefined): string {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function parseCsvContacts(
  text: string,
  targetAddressBookId: string,
): ContactDraft[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const contacts: ContactDraft[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || row.every((c) => !c)) continue;

    const get = (patterns: string[]): string => {
      for (const pattern of patterns) {
        const cleanPattern = pattern.toLowerCase().replace(/[\s_-]+/g, "");
        const idx = headers.findIndex((h) => h === cleanPattern || h.includes(cleanPattern));
        if (idx !== -1 && row[idx]) {
          return row[idx].trim();
        }
      }
      return "";
    };

    // Extract Name
    let name = get(["name", "fullname", "displayname"]);
    const firstName = get(["firstname", "givenname", "first"]);
    const lastName = get(["lastname", "familyname", "last", "surname"]);
    const nickname = get(["nickname"]);

    if (!name) {
      if (firstName || lastName) {
        name = `${firstName} ${lastName}`.trim();
      }
    }

    // Extract Emails
    const emails: ContactChannel[] = [];
    const emailHome = get(["emailhome", "homeemail", "email1value", "e-mail1-value", "email"]);
    const emailWork = get(["emailwork", "workemail", "email2value", "e-mail2-value", "businessemail"]);

    if (emailHome) {
      emails.push({ id: newId(), kind: "home", value: emailHome });
    }
    if (emailWork && emailWork !== emailHome) {
      emails.push({ id: newId(), kind: "work", value: emailWork });
    }

    // Also check for any other column containing "email" or "e-mail"
    headers.forEach((h, idx) => {
      if (
        (h.includes("email") || h.includes("mail")) &&
        row[idx] &&
        !emails.some((e) => e.value.toLowerCase() === row[idx].toLowerCase())
      ) {
        emails.push({ id: newId(), kind: "home", value: row[idx] });
      }
    });

    // Extract Phones
    const phones: ContactChannel[] = [];
    const phoneCell = get(["phonemobile", "mobilephone", "cellphone", "phone1value", "mobile", "phone"]);
    const phoneHome = get(["phonehome", "homephone", "phone2value"]);
    const phoneWork = get(["phonework", "workphone", "businessphone", "phone3value"]);

    if (phoneCell) {
      phones.push({ id: newId(), kind: "mobile", value: phoneCell });
    }
    if (phoneHome && phoneHome !== phoneCell) {
      phones.push({ id: newId(), kind: "home", value: phoneHome });
    }
    if (phoneWork && phoneWork !== phoneCell && phoneWork !== phoneHome) {
      phones.push({ id: newId(), kind: "work", value: phoneWork });
    }

    // Extract Work / Organization
    const organization = get(["organization", "company", "org", "companyname", "organization1name"]);
    const jobTitle = get(["jobtitle", "title", "role", "position", "organization1title"]);
    const work: ContactWork[] = [];
    if (organization || jobTitle) {
      work.push({
        id: newId(),
        organization: organization || "",
        title: jobTitle || undefined,
      });
    }

    // Extract Address
    const street1 = get(["street1", "street", "address", "homestreet", "address1street"]);
    const street2 = get(["street2", "addressline2", "apartment", "suite"]);
    const city = get(["city", "locality", "homecity", "address1city"]);
    const region = get(["region", "state", "province", "homestate", "address1region"]);
    const postcode = get(["postalcode", "postcode", "zip", "zipcode", "homepostalcode", "address1postalcode"]);
    const country = get(["country", "homecountry", "address1country"]);

    let address: ContactAddress | undefined = undefined;
    if (street1 || street2 || city || region || postcode || country) {
      address = {
        street1: street1 || undefined,
        street2: street2 || undefined,
        locality: city || undefined,
        region: region || undefined,
        postcode: postcode || undefined,
        country: country || undefined,
      };
    }

    // Final fallback name resolution
    if (!name && emails.length > 0) {
      name = emails[0].value.split("@")[0];
    }
    if (!name && phones.length > 0) {
      name = phones[0].value;
    }
    if (!name) continue;

    if (emails.length === 0) {
      emails.push(emptyChannel("home"));
    }
    if (phones.length === 0) {
      phones.push(emptyChannel("mobile"));
    }

    contacts.push({
      name,
      nickname: nickname || undefined,
      emails,
      phones,
      address,
      work,
      addressBookId: targetAddressBookId,
    });
  }

  return contacts;
}

export function serializeCsvContacts(
  contacts: Contact[] | ContactDraft[],
  addressBooks: AddressBook[],
): string {
  const headers = [
    "Name",
    "Nickname",
    "Email (Home)",
    "Email (Work)",
    "Phone (Mobile)",
    "Phone (Home)",
    "Phone (Work)",
    "Organization",
    "Job Title",
    "Street 1",
    "Street 2",
    "City",
    "Region",
    "Postal Code",
    "Country",
    "Address Book",
  ];

  const rows: string[] = [headers.join(",")];

  for (const c of contacts) {
    const emailHome = c.emails.find((e) => e.kind === "home")?.value || "";
    const emailWork = c.emails.find((e) => e.kind === "work")?.value || "";
    const phoneMobile = c.phones.find((p) => p.kind === "mobile")?.value || "";
    const phoneHome = c.phones.find((p) => p.kind === "home")?.value || "";
    const phoneWork = c.phones.find((p) => p.kind === "work")?.value || "";

    const firstWork = c.work[0];
    const organization = firstWork?.organization || "";
    const jobTitle = firstWork?.title || "";

    const a = c.address;
    const street1 = a?.street1 || "";
    const street2 = a?.street2 || "";
    const locality = a?.locality || "";
    const region = a?.region || "";
    const postcode = a?.postcode || "";
    const country = a?.country || "";

    const bookName = bookNameById(addressBooks, c.addressBookId);

    const values = [
      escapeCsv(c.name),
      escapeCsv(c.nickname),
      escapeCsv(emailHome),
      escapeCsv(emailWork),
      escapeCsv(phoneMobile),
      escapeCsv(phoneHome),
      escapeCsv(phoneWork),
      escapeCsv(organization),
      escapeCsv(jobTitle),
      escapeCsv(street1),
      escapeCsv(street2),
      escapeCsv(locality),
      escapeCsv(region),
      escapeCsv(postcode),
      escapeCsv(country),
      escapeCsv(bookName),
    ];

    rows.push(values.join(","));
  }

  return rows.join("\r\n");
}
