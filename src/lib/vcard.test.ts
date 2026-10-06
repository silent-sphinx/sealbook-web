import { describe, expect, it } from "vitest";
import { parseVCard, serializeVCard } from "./vcard";
import { emptyDraft } from "./contact";
import { emptyProfile } from "./contactProfile";

const BOOK = "00000000-0000-0000-0000-000000000001";

const CARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ada Lovelace",
  "ORG:Analytical Engines",
  "EMAIL;TYPE=WORK:ada@example.com",
  "TEL;TYPE=CELL:+44 20 7946 0958",
  "END:VCARD",
].join("\r\n");

describe("parseVCard", () => {
  it("reads a single card", () => {
    const contacts = parseVCard(CARD, BOOK);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Ada Lovelace");
  });

  it("reads several cards from one file", () => {
    const contacts = parseVCard(`${CARD}\r\n${CARD.replace("Ada Lovelace", "Grace Hopper")}`, BOOK);
    expect(contacts.map((contact) => contact.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("assigns the target address book", () => {
    expect(parseVCard(CARD, BOOK)[0].addressBookId).toBe(BOOK);
  });

  it("unfolds continuation lines", () => {
    const folded = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:A very long name that has been",
      "  folded across lines",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCard(folded, BOOK)[0].name).toBe("A very long name that has been folded across lines");
  });

  it("accepts bare LF line endings", () => {
    expect(parseVCard(CARD.replace(/\r\n/g, "\n"), BOOK)).toHaveLength(1);
  });

  it("keeps the email address", () => {
    expect(JSON.stringify(parseVCard(CARD, BOOK)[0])).toContain("ada@example.com");
  });

  it("returns nothing for input that is not a vCard", () => {
    expect(parseVCard("just some text", BOOK)).toEqual([]);
  });

  it("recovers a truncated card that never reached END:VCARD", () => {
    // Deliberately lenient: a file cut short still yields its contact rather
    // than importing nothing. Documenting the behaviour so a future change to
    // strict parsing is a conscious decision, not an accident.
    const contacts = parseVCard("BEGIN:VCARD\r\nFN:Broken", BOOK);
    expect(contacts.map((contact) => contact.name)).toEqual(["Broken"]);
  });
});

describe("vCard round trip", () => {
  it("reads back a card it serialized", () => {
    const original = parseVCard(CARD, BOOK);
    const back = parseVCard(serializeVCard(original), BOOK);
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe("Ada Lovelace");
  });

  it("preserves punctuation that must be escaped", () => {
    const tricky = parseVCard(
      ["BEGIN:VCARD", "VERSION:3.0", "FN:Doe\\, Jane\\; Esq.", "END:VCARD"].join("\r\n"),
      BOOK,
    );
    const back = parseVCard(serializeVCard(tricky), BOOK);
    expect(back[0].name).toBe(tricky[0].name);
  });

  it("emits a card per contact", () => {
    const contacts = parseVCard(`${CARD}\r\n${CARD.replace("Ada Lovelace", "Grace Hopper")}`, BOOK);
    const output = serializeVCard(contacts);
    expect(output.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(output.match(/END:VCARD/g)).toHaveLength(2);
  });
});

describe("the relationship profile", () => {
  const draft = {
    ...emptyDraft(BOOK),
    name: "Ada Lovelace",
    profile: {
      ...emptyProfile(),
      howWeMet: "At a lecture on the Analytical Engine.",
      pets: [{ id: "p", name: "Puff", species: "Cat" }],
    },
  };

  it("survives an export and re-import", () => {
    const back = parseVCard(serializeVCard([draft]), BOOK);
    expect(back[0].profile?.howWeMet).toBe("At a lecture on the Analytical Engine.");
    expect(back[0].profile?.pets[0]).toMatchObject({ name: "Puff", species: "Cat" });
  });

  it("travels as one X- line, so another reader shows nothing extra", () => {
    const lines = serializeVCard([draft]).split("\r\n");
    expect(lines.filter((line) => line.startsWith("X-SEALBOOK-PROFILE:"))).toHaveLength(1);
  });

  it("writes no line for a contact with no profile", () => {
    expect(serializeVCard([{ ...emptyDraft(BOOK), name: "Ada" }])).not.toContain("X-SEALBOOK");
  });

  it("loses only the profile when the line is damaged", () => {
    const damaged = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Ada Lovelace",
      "X-SEALBOOK-PROFILE:{not json",
      "END:VCARD",
    ].join("\r\n");
    const back = parseVCard(damaged, BOOK);
    expect(back[0].name).toBe("Ada Lovelace");
    expect(back[0].profile).toBeUndefined();
  });
});
