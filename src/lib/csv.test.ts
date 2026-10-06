import { describe, expect, it } from "vitest";
import { parseCsvContacts, parseCsvRows, serializeCsvContacts } from "./csv";
import { emptyDraft } from "./contact";
import { emptyProfile } from "./contactProfile";

const BOOK = "00000000-0000-0000-0000-000000000001";

describe("parseCsvRows", () => {
  it("splits a simple grid", () => {
    expect(parseCsvRows("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsvRows('name,note\n"Doe, Jane",hello')).toEqual([
      ["name", "note"],
      ["Doe, Jane", "hello"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvRows('a\n"She said ""hi"""')).toEqual([["a"], ['She said "hi"']]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsvRows('a\n"line one\nline two"')).toEqual([["a"], ["line one\nline two"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsvRows("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves empty fields", () => {
    expect(parseCsvRows("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsvRows("")).toEqual([]);
  });
});

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
