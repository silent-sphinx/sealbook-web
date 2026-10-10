import { describe, expect, it } from "vitest";
import { parseImportContent } from "./importExport";
import { DEFAULT_ADDRESS_BOOK_ID } from "./addressBook";

const TARGET = "book-7";

const VCARD = ["BEGIN:VCARD", "VERSION:3.0", "FN:Ada Lovelace", "END:VCARD"].join("\n");

describe("picking the format of an import", () => {
  it("reads JSON named as JSON", () => {
    const result = parseImportContent(
      "contacts.json",
      JSON.stringify([{ name: "Ada Lovelace" }]),
      TARGET,
    );
    expect(result.format).toBe("JSON");
    expect(result.contacts.map((row) => row.name)).toEqual(["Ada Lovelace"]);
  });

  it("reads JSON by its shape when the name says nothing", () => {
    const result = parseImportContent("export", JSON.stringify([{ name: "Ada" }]), TARGET);
    expect(result.format).toBe("JSON");
  });

  it("unwraps an export that put the list under `contacts`", () => {
    const result = parseImportContent(
      "backup.json",
      JSON.stringify({ contacts: [{ name: "Ada" }, { name: "Grace" }] }),
      TARGET,
    );
    expect(result.contacts.map((row) => row.name)).toEqual(["Ada", "Grace"]);
  });

  it("takes a single contact that was not wrapped in a list", () => {
    const result = parseImportContent("one.json", JSON.stringify({ name: "Ada" }), TARGET);
    expect(result.format).toBe("JSON");
    expect(result.contacts).toHaveLength(1);
  });

  it("reads a vCard by extension and by content", () => {
    expect(parseImportContent("contacts.vcf", VCARD, TARGET).format).toBe("vCard");
    expect(parseImportContent("whatever", VCARD, TARGET).format).toBe("vCard");
  });

  it("falls back to CSV for anything else", () => {
    const csv = "name,email\nAda Lovelace,ada@example.com";
    const result = parseImportContent("contacts.csv", csv, TARGET);
    expect(result.format).toBe("CSV");
    expect(result.contacts.map((row) => row.name)).toEqual(["Ada Lovelace"]);
  });

  it("does not give up on a .json file that is really a vCard", () => {
    // The extension is a hint, not a promise; a mislabelled file still imports
    // rather than failing with nothing explained.
    expect(parseImportContent("contacts.json", VCARD, TARGET).format).toBe("vCard");
  });
});

describe("what an import is allowed to contain", () => {
  it("refuses a file beyond the size cap", () => {
    const huge = "x".repeat(5 * 1024 * 1024 + 1);
    expect(() => parseImportContent("big.csv", huge, TARGET)).toThrow(/too large/iu);
  });

  it("refuses more contacts than the cap", () => {
    const many = JSON.stringify(
      Array.from({ length: 1001 }, (_, i) => ({ name: `Contact ${i}` })),
    );
    expect(() => parseImportContent("many.json", many, TARGET)).toThrow(/too many/iu);
  });

  it("skips rows with no name instead of importing blanks", () => {
    const result = parseImportContent(
      "mixed.json",
      JSON.stringify([{ name: "Ada" }, { name: "   " }, { nickname: "no name" }]),
      TARGET,
    );
    expect(result.contacts.map((row) => row.name)).toEqual(["Ada"]);
  });

  it("drops a field that is not the type it should be", () => {
    const result = parseImportContent(
      "odd.json",
      JSON.stringify([{ name: "Ada", nickname: 42, emails: "not a list", work: null }]),
      TARGET,
    );
    expect(result.contacts[0]?.nickname).toBeUndefined();
    expect(result.contacts[0]?.emails).toEqual([]);
    expect(result.contacts[0]?.work).toEqual([]);
  });
});

describe("where imported contacts land", () => {
  it("puts them in the book the import chose", () => {
    const result = parseImportContent("c.json", JSON.stringify([{ name: "Ada" }]), TARGET);
    expect(result.contacts[0]?.addressBookId).toBe(TARGET);
  });

  it("keeps a book the file named itself", () => {
    const result = parseImportContent(
      "c.json",
      JSON.stringify([{ name: "Ada", addressBookId: "book-from-file" }]),
      TARGET,
    );
    expect(result.contacts[0]?.addressBookId).toBe("book-from-file");
  });

  it("falls back to the default book when neither names one", () => {
    const result = parseImportContent("c.json", JSON.stringify([{ name: "Ada" }]), "");
    expect(result.contacts[0]?.addressBookId).toBe(DEFAULT_ADDRESS_BOOK_ID);
  });
});
