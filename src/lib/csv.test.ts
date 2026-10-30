import { describe, expect, it } from "vitest";
import { parseCsvContacts, serializeCsvContacts } from "./csv";
import { emptyDraft } from "./contact";
import { emptyProfile } from "./contactProfile";

const BOOK = "00000000-0000-0000-0000-000000000001";

describe("parseCsvContacts", () => {
  it("returns nothing when there is only a header row", () => {
    expect(parseCsvContacts("Name,Email", BOOK)).toEqual([]);
  });

  it("reads a name and email", () => {
    const [contact] = parseCsvContacts("Name,Email\nAda Lovelace,ada@example.com", BOOK);
    expect(contact.name).toBe("Ada Lovelace");
    expect(JSON.stringify(contact)).toContain("ada@example.com");
  });

  it("matches headers regardless of case, spacing or punctuation", () => {
    const [contact] = parseCsvContacts("  NAME  ,E-Mail\nGrace Hopper,grace@example.com", BOOK);
    expect(contact.name).toBe("Grace Hopper");
  });

  it("assigns every contact to the target address book", () => {
    const contacts = parseCsvContacts("Name\nOne\nTwo", BOOK);
    expect(contacts).toHaveLength(2);
    expect(contacts.every((contact) => contact.addressBookId === BOOK)).toBe(true);
  });

  it("survives rows with fewer columns than the header", () => {
    const contacts = parseCsvContacts("Name,Email,Phone\nSolo", BOOK);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Solo");
  });
});

describe("exported cells a spreadsheet could execute", () => {
  const nameRow = (name: string) =>
    serializeCsvContacts([{ ...emptyDraft(BOOK), name }], []).split("\n")[1];

  it("prefixes every prefix a spreadsheet treats as a formula", () => {
    for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(nameRow(`${prefix}cmd|'/c calc'!A1`)).toMatch(/^("?)'/u);
    }
  });

  it("leaves an ordinary name alone", () => {
    expect(nameRow("Ada Lovelace").startsWith("Ada")).toBe(true);
  });
});

describe("the relationship profile", () => {
  it("survives an export and re-import through the JSON column", () => {
    const draft = {
      ...emptyDraft(BOOK),
      name: "Ada Lovelace",
      profile: {
        ...emptyProfile(),
        interests: [{ id: "a", value: "Bouldering" }],
        family: [{ id: "b", name: "Byron", relation: "Father" }],
      },
    };
    const back = parseCsvContacts(serializeCsvContacts([draft], []), BOOK);
    expect(back[0].profile?.interests.map((row) => row.value)).toEqual(["Bouldering"]);
    expect(back[0].profile?.family[0]).toMatchObject({ name: "Byron", relation: "Father" });
  });

  it("leaves the column empty for a contact with no profile", () => {
    const csv = serializeCsvContacts([{ ...emptyDraft(BOOK), name: "Ada" }], []);
    expect(parseCsvContacts(csv, BOOK)[0].profile).toBeUndefined();
  });
});
