import { describe, expect, it } from "vitest";
import {
  CONTACT_ARCHIVED_PROP,
  MAX_CONTACT_NOTES_CHARS,
  addressLines,
  channelKindLabel,
  contactByteSize,
  contactSearchText,
  contactValidationError,
  dateKindLabel,
  emptyDraft,
  parseContact,
  parseDraft,
  serializeCard,
  sortContacts,
} from "./contact";
import { DEFAULT_ADDRESS_BOOK_ID } from "./addressBook";
import { emptyProfile } from "./contactProfile";
import type { AddressBook, Contact, ContactDraft } from "./types";

/** A card with something in every section a person can fill in. */
function fullDraft(): ContactDraft {
  return {
    ...emptyDraft(),
    name: "Ada Lovelace",
    nickname: "Ada",
    pronouns: "she/her",
    emails: [
      { id: "e1", kind: "home", value: "ada@example.com" },
      { id: "e2", kind: "work", value: "ada@analytical.example" },
    ],
    phones: [
      { id: "p1", kind: "mobile", value: "+44 7700 900000" },
      { id: "p2", kind: "custom", label: "Study", value: "+44 20 7946 0000" },
    ],
    address: {
      street1: "12 Dorset Street",
      locality: "London",
      postcode: "W1U 6QH",
      country: "United Kingdom",
    },
    work: [{ id: "w1", organization: "Analytical Engine", title: "Mathematician" }],
    dates: [
      { id: "d1", kind: "birthday", date: "1815-12-10" },
      { id: "d2", kind: "custom", label: "First algorithm", date: "1843-01-01" },
    ],
    socials: [{ id: "s1", platform: "GitHub", handle: "ada" }],
    notes: "Wrote the first algorithm.",
  };
}

/** Everything a person typed, with the ids the editor uses left out. */
function content(draft: ContactDraft) {
  return {
    name: draft.name,
    nickname: draft.nickname,
    pronouns: draft.pronouns,
    emails: draft.emails.map(({ kind, value, label }) => ({ kind, value, label })),
    phones: draft.phones.map(({ kind, value, label }) => ({ kind, value, label })),
    address: draft.address,
    work: draft.work.map(({ organization, title }) => ({ organization, title })),
    dates: draft.dates.map(({ kind, date, label }) => ({ kind, date, label })),
    socials: draft.socials.map(({ platform, handle }) => ({ platform, handle })),
    notes: draft.notes,
  };
}

describe("the card round trip", () => {
  it("brings back everything a person filled in", () => {
    const draft = fullDraft();
    // The payload every client reads: a field lost here is lost for the Android
    // client and the CLI too, not just this one.
    expect(content(parseDraft(serializeCard(draft)))).toEqual(content(draft));
  });

  it("keeps a mobile number marked as mobile", () => {
    const draft: ContactDraft = {
      ...emptyDraft(),
      name: "Ada",
      phones: [{ id: "p1", kind: "mobile", value: "+44 7700 900000" }],
    };
    const back = parseDraft(serializeCard(draft));
    expect(back.phones[0]?.kind).toBe("mobile");
  });

  it("keeps the label of a custom channel, which is all that names it", () => {
    const draft: ContactDraft = {
      ...emptyDraft(),
      name: "Ada",
      phones: [{ id: "p1", kind: "custom", label: "Study", value: "+44 20 7946 0000" }],
    };
    const back = parseDraft(serializeCard(draft));
    expect(back.phones[0]?.kind).toBe("custom");
    expect(back.phones[0]?.label).toBe("Study");
  });

  it("drops rows the person left blank rather than storing empties", () => {
    const draft: ContactDraft = {
      ...emptyDraft(),
      name: "Ada",
      emails: [{ id: "e1", kind: "home", value: "   " }],
      phones: [{ id: "p1", kind: "mobile", value: "" }],
    };
    const back = parseDraft(serializeCard(draft));
    expect(back.emails).toEqual([]);
    expect(back.phones).toEqual([]);
  });

  it("writes the schema version, so a reader can tell what it is holding", () => {
    const card = JSON.parse(serializeCard(fullDraft())) as Record<string, unknown>;
    expect(card["@type"]).toBe("Card");
    expect(card.version).toBeDefined();
  });

  it("carries the address book, so a card does not move on a round trip", () => {
    const draft = { ...emptyDraft("book-7"), name: "Ada" };
    expect(parseDraft(serializeCard(draft)).addressBookId).toBe("book-7");
  });
});

describe("parsing a card another client wrote", () => {
  const minimal = { "@type": "Card", name: { full: "Ada" } };

  it("reads a phone under either spelling of the number", () => {
    const legacy = parseDraft(
      JSON.stringify({ ...minimal, phones: { p1: { phoneNumber: "+44 7700 900000" } } }),
    );
    expect(legacy.phones[0]?.value).toBe("+44 7700 900000");

    const current = parseDraft(
      JSON.stringify({ ...minimal, phones: { p1: { number: "+44 7700 900000" } } }),
    );
    expect(current.phones[0]?.value).toBe("+44 7700 900000");
  });

  it("reads timestamps under either spelling", () => {
    const current = parseDraft(
      JSON.stringify({ ...minimal, created: "2024-01-01T00:00:00Z", updated: "2024-02-01T00:00:00Z" }),
    );
    expect(current.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(current.updatedAt).toBe("2024-02-01T00:00:00Z");

    const legacy = parseDraft(
      JSON.stringify({ ...minimal, createdAt: "2023-01-01T00:00:00Z", updatedAt: "2023-02-01T00:00:00Z" }),
    );
    expect(legacy.createdAt).toBe("2023-01-01T00:00:00Z");
    expect(legacy.updatedAt).toBe("2023-02-01T00:00:00Z");
  });

  it("finds a photo however it was written", () => {
    expect(parseDraft(JSON.stringify({ ...minimal, photo: "data:image/png;base64,AAA" })).avatar).toBe(
      "data:image/png;base64,AAA",
    );
    expect(parseDraft(JSON.stringify({ ...minimal, photo: { href: "https://e.example/a.png" } })).avatar).toBe(
      "https://e.example/a.png",
    );
    expect(parseDraft(JSON.stringify({ ...minimal, photo: { uri: "https://e.example/b.png" } })).avatar).toBe(
      "https://e.example/b.png",
    );
    expect(parseDraft(JSON.stringify({ ...minimal, avatar: "https://e.example/c.png" })).avatar).toBe(
      "https://e.example/c.png",
    );
  });

  it("names a card that arrived without one", () => {
    // Better than an empty row in the list, which looks like a rendering fault.
    expect(parseDraft(JSON.stringify({ "@type": "Card" })).name).toBe("Unnamed contact");
  });

  it("falls back to the default address book when the card names none", () => {
    expect(parseDraft(JSON.stringify(minimal)).addressBookId).toBe(DEFAULT_ADDRESS_BOOK_ID);
  });

  it("takes a mobile marked by feature or by label", () => {
    const byFeature = parseDraft(
      JSON.stringify({ ...minimal, phones: { p1: { number: "1", features: { mobile: true } } } }),
    );
    expect(byFeature.phones[0]?.kind).toBe("mobile");

    const byLabel = parseDraft(
      JSON.stringify({ ...minimal, phones: { p1: { number: "1", label: "Mobile" } } }),
    );
    expect(byLabel.phones[0]?.kind).toBe("mobile");
  });
});

describe("the archive flag", () => {
  it("is left out of a card that is not archived", () => {
    const body = JSON.parse(serializeCard(fullDraft())) as Record<string, unknown>;
    expect(CONTACT_ARCHIVED_PROP in body).toBe(false);
  });

  it("round trips, keeping the address book the contact came from", () => {
    const draft = { ...fullDraft(), archived: true };
    const raw = serializeCard(draft);
    expect((JSON.parse(raw) as Record<string, unknown>)[CONTACT_ARCHIVED_PROP]).toBe(true);
    const parsed = parseDraft(raw);
    expect(parsed.archived).toBe(true);
    expect(parsed.addressBookId).toBe(draft.addressBookId);
  });

  it("is dropped from the payload when the contact is restored", () => {
    const archived = serializeCard({ ...fullDraft(), archived: true });
    const restored = serializeCard({ ...parseDraft(archived), archived: undefined, raw: archived });
    expect(CONTACT_ARCHIVED_PROP in (JSON.parse(restored) as Record<string, unknown>)).toBe(false);
    expect(parseDraft(restored).archived).toBeUndefined();
  });

  it("reads a non-boolean value as not archived", () => {
    const raw = JSON.stringify({
      "@type": "Card",
      name: { full: "Ada" },
      [CONTACT_ARCHIVED_PROP]: "yes",
    });
    expect(parseDraft(raw).archived).toBeUndefined();
  });
});

describe("parseContact", () => {
  it("keeps a row that will not parse visible instead of throwing", () => {
    // A card this build cannot read must not take out the list it is in; it
    // is listed under a name so the row can still be found and deleted.
    const contact = parseContact("id-1", "not json at all", "cipher", 1024);
    expect(contact.id).toBe("id-1");
    expect(contact.name).toBe("Unnamed contact");
    expect(contact.emails).toEqual([]);
    expect(contact.addressBookId).toBe(DEFAULT_ADDRESS_BOOK_ID);
    expect(contact.raw).toBe("not json at all");
  });

  it("lifts the first email out for the list row", () => {
    const contact = parseContact("id-2", serializeCard(fullDraft()), "cipher", 2048);
    expect(contact.email).toBe("ada@example.com");
    expect(contact.ciphertext).toBe("cipher");
    expect(contact.paddedSize).toBe(2048);
  });

  it("leaves the list row's email unset when the card has none", () => {
    const contact = parseContact("id-3", JSON.stringify({ "@type": "Card", name: { full: "Ada" } }), "c", 0);
    expect(contact.email).toBeUndefined();
  });
});

describe("contactValidationError", () => {
  it("passes a card that is within every cap", () => {
    expect(contactValidationError(fullDraft())).toBeNull();
  });

  it("allows notes exactly at the cap", () => {
    const draft = { ...fullDraft(), notes: "x".repeat(MAX_CONTACT_NOTES_CHARS) };
    expect(contactValidationError(draft)).toBeNull();
  });

  it("says how much to remove when notes run over", () => {
    const draft = { ...fullDraft(), notes: "x".repeat(MAX_CONTACT_NOTES_CHARS + 7) };
    const message = contactValidationError(draft);
    expect(message).toContain("Shorten by 7");
  });

  it("blames the photo when a card is too large to store", () => {
    // The backstop for a pasted avatar rather than anything typed.
    const draft = { ...fullDraft(), avatar: `data:image/png;base64,${"A".repeat(9 * 1024 * 1024)}` };
    expect(contactValidationError(draft)).toContain("too large");
  });
});

describe("contactByteSize", () => {
  it("counts the envelope as well as the card", () => {
    const draft = { ...emptyDraft(), name: "Ada" };
    const card = new TextEncoder().encode(serializeCard(draft)).length;
    expect(contactByteSize(draft)).toBeGreaterThan(card);
  });

  it("measures the encoded bytes, not the character count", () => {
    const ascii = { ...emptyDraft(), name: "aaaa" };
    const wide = { ...emptyDraft(), name: "日本語名" };
    expect(contactByteSize(wide)).toBeGreaterThan(contactByteSize(ascii));
  });
});

describe("sortContacts", () => {
  it("ignores case, so a list is not split into two alphabets", () => {
    const sorted = sortContacts([{ name: "bob" }, { name: "Alice" }, { name: "charlie" }]);
    expect(sorted.map((row) => row.name)).toEqual(["Alice", "bob", "charlie"]);
  });

  it("orders numbers the way a person counts", () => {
    const sorted = sortContacts([{ name: "Room 10" }, { name: "Room 9" }, { name: "Room 1" }]);
    expect(sorted.map((row) => row.name)).toEqual(["Room 1", "Room 9", "Room 10"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [{ name: "bob" }, { name: "Alice" }];
    sortContacts(input);
    expect(input.map((row) => row.name)).toEqual(["bob", "Alice"]);
  });

  it("puts an unnamed row somewhere rather than throwing", () => {
    const sorted = sortContacts([{ name: "Alice" }, { name: "" }]);
    expect(sorted).toHaveLength(2);
  });
});

describe("the channel and date labels", () => {
  it("names the fixed kinds", () => {
    expect(channelKindLabel("work")).toBe("Work");
    expect(channelKindLabel("home")).toBe("Home");
    expect(channelKindLabel("mobile")).toBe("Mobile");
    expect(dateKindLabel("birthday")).toBe("Birthday");
    expect(dateKindLabel("anniversary")).toBe("Anniversary");
  });

  it("uses the person's own label for a custom row", () => {
    expect(channelKindLabel("custom", "  Study  ")).toBe("Study");
    expect(dateKindLabel("custom", "  Met  ")).toBe("Met");
  });

  it("falls back to a word rather than showing an empty label", () => {
    expect(channelKindLabel("custom", "   ")).toBe("Custom");
    expect(channelKindLabel("custom")).toBe("Custom");
    expect(dateKindLabel("custom", "   ")).toBe("Event");
    expect(dateKindLabel("custom")).toBe("Event");
  });
});

describe("addressLines", () => {
  it("keeps the postal order and drops the blanks", () => {
    expect(
      addressLines({
        street1: "12 Dorset Street",
        street2: "   ",
        locality: "London",
        postcode: "W1U 6QH",
        country: "United Kingdom",
      }),
    ).toEqual(["12 Dorset Street", "London", "W1U 6QH", "United Kingdom"]);
  });

  it("is empty for no address at all", () => {
    expect(addressLines()).toEqual([]);
    expect(addressLines({})).toEqual([]);
  });
});

describe("contactSearchText", () => {
  const books: AddressBook[] = [{ id: "book-work", name: "Colleagues", raw: "" }];

  function contact(overrides: Partial<Contact> = {}): Contact {
    return {
      ...fullDraft(),
      id: "c1",
      raw: "",
      ciphertext: "",
      paddedSize: 0,
      ...overrides,
    };
  }

  it("folds every searched field into one lowercased string", () => {
    const text = contactSearchText(contact({ email: "legacy@example.com" }), books);
    expect(text).toContain("ada lovelace");
    expect(text).toContain("legacy@example.com");
    expect(text).toContain("ada@analytical.example");
    expect(text).toContain("+44 20 7946 0000");
    expect(text).toContain("analytical engine mathematician");
    expect(text).toContain("wrote the first algorithm.");
  });

  it("includes the profile and the address book name", () => {
    const text = contactSearchText(
      contact({
        addressBookId: "book-work",
        profile: { ...emptyProfile(), howWeMet: "At the Royal Society" },
      }),
      books,
    );
    expect(text).toContain("at the royal society");
    expect(text).toContain("colleagues");
  });

  it("names the default book for a contact whose book is gone", () => {
    const text = contactSearchText(contact({ addressBookId: "deleted" }), books);
    expect(text).toContain("default address book");
  });

  it("leaves out the fields a contact has not filled in", () => {
    const text = contactSearchText(
      contact({ nickname: undefined, notes: undefined, work: [], profile: undefined }),
      books,
    );
    expect(text).not.toContain("undefined");
  });
});
