import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_ADDRESS_BOOK_NAME,
  addressBookTone,
  bookNameById,
  bookToneById,
  effectiveHiddenBooks,
  isAddressBookVisible,
  loadHiddenAddressBooks,
  parseAddressBook,
  pruneHiddenAddressBooks,
  resolveAddressBookId,
  serializeAddressBook,
  sortAddressBooks,
  storeHiddenAddressBooks,
  visibleAddressBooks,
} from "./addressBook";
import type { AddressBook } from "./types";

function book(id: string, name: string): AddressBook {
  return { id, name, raw: JSON.stringify({ "@type": "AddressBook", name }) };
}

describe("serializeAddressBook", () => {
  it("writes the type, the version and a trimmed name", () => {
    const body = JSON.parse(serializeAddressBook("  Work  ")) as Record<string, unknown>;
    expect(body["@type"]).toBe("AddressBook");
    expect(body.name).toBe("Work");
    expect(body.version).toBeDefined();
  });

  it("keeps fields it does not know about when rewriting", () => {
    // The rule that lets a newer client add a field without this one erasing it
    // on the next rename. Dropping it here loses the other client's data.
    const previous = JSON.stringify({
      "@type": "AddressBook",
      name: "Work",
      "x-future:colour": "blue",
    });
    const body = JSON.parse(serializeAddressBook("Home", previous)) as Record<string, unknown>;
    expect(body.name).toBe("Home");
    expect(body["x-future:colour"]).toBe("blue");
  });
});

describe("parseAddressBook", () => {
  it("takes the name and keeps the raw body for the next write", () => {
    const parsed = parseAddressBook("b1", JSON.stringify({ name: "  Work  " }));
    expect(parsed).toEqual({
      id: "b1",
      name: "Work",
      raw: JSON.stringify({ name: "  Work  " }),
    });
  });

  it("names a book that arrived without one", () => {
    expect(parseAddressBook("b1", JSON.stringify({})).name).toBe("Untitled Address Book");
    expect(parseAddressBook("b1", JSON.stringify({ name: "   " })).name).toBe(
      "Untitled Address Book",
    );
  });

  it("keeps a body it cannot read visible rather than throwing", () => {
    const parsed = parseAddressBook("b1", "not json");
    expect(parsed.name).toBe("Untitled Address Book");
    expect(parsed.raw).toBe("not json");
  });
});

describe("address book colour", () => {
  it("round-trips a colour, and a rename without one clears it", () => {
    const coloured = serializeAddressBook("Work", undefined, false, "#9ece6a");
    expect(parseAddressBook("b", coloured).color).toBe("#9ece6a");
    const cleared = serializeAddressBook("Work", coloured);
    expect(parseAddressBook("b", cleared).color).toBeUndefined();
  });

  it("tones a book by its stored colour, or one derived from its id", () => {
    const work = { ...book("b", "Work"), color: "#9ece6a" };
    expect(addressBookTone(work)).toBe("#9ece6a");
    expect(bookToneById([work], "b")).toBe("#9ece6a");
    expect(addressBookTone(book("b", "Work"))).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("resolveAddressBookId", () => {
  it("falls back to the default book for anything blank", () => {
    expect(resolveAddressBookId()).toBe(DEFAULT_ADDRESS_BOOK_ID);
    expect(resolveAddressBookId("")).toBe(DEFAULT_ADDRESS_BOOK_ID);
    expect(resolveAddressBookId("   ")).toBe(DEFAULT_ADDRESS_BOOK_ID);
  });

  it("trims an id rather than treating the spacing as part of it", () => {
    expect(resolveAddressBookId("  b1  ")).toBe("b1");
  });
});

describe("sortAddressBooks", () => {
  it("keeps the default book first, whatever it is called", () => {
    const sorted = sortAddressBooks([
      book("b1", "Alpha"),
      book(DEFAULT_ADDRESS_BOOK_ID, "Zulu"),
      book("b2", "Beta"),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([DEFAULT_ADDRESS_BOOK_ID, "b1", "b2"]);
  });

  it("orders the rest by name, ignoring case", () => {
    const sorted = sortAddressBooks([book("b1", "beta"), book("b2", "Alpha")]);
    expect(sorted.map((row) => row.name)).toEqual(["Alpha", "beta"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [book("b1", "Beta"), book(DEFAULT_ADDRESS_BOOK_ID, "Default")];
    sortAddressBooks(input);
    expect(input.map((row) => row.id)).toEqual(["b1", DEFAULT_ADDRESS_BOOK_ID]);
  });
});

describe("bookNameById", () => {
  const books = [book(DEFAULT_ADDRESS_BOOK_ID, "Contacts"), book("b1", "Work")];

  it("names the book a contact belongs to", () => {
    expect(bookNameById(books, "b1")).toBe("Work");
  });

  it("treats a missing id as the default book", () => {
    expect(bookNameById(books)).toBe("Contacts");
  });

  it("falls back to the default name when the book is gone", () => {
    // A contact whose book was deleted elsewhere still has to render a row.
    expect(bookNameById(books, "deleted")).toBe(DEFAULT_ADDRESS_BOOK_NAME);
  });
});

describe("address book visibility", () => {
  const books = [book(DEFAULT_ADDRESS_BOOK_ID, "Contacts"), book("b1", "Work"), book("b2", "Family")];

  it("shows every book until one is switched off", () => {
    expect(visibleAddressBooks(books, new Set()).map((row) => row.id)).toEqual([
      DEFAULT_ADDRESS_BOOK_ID,
      "b1",
      "b2",
    ]);
  });

  it("hides only the books named", () => {
    const hidden = new Set(["b1"]);
    expect(isAddressBookVisible(books[1], hidden)).toBe(false);
    expect(isAddressBookVisible(books[2], hidden)).toBe(true);
    expect(visibleAddressBooks(books, hidden).map((row) => row.id)).toEqual([
      DEFAULT_ADDRESS_BOOK_ID,
      "b2",
    ]);
  });

  it("hides a book in play that is marked hidden, and an archived one unless it is shown", () => {
    const marked = [
      { ...books[1], hideFromAll: true },
      { ...books[2], archived: true },
    ];
    expect([...effectiveHiddenBooks(marked, new Set())].sort()).toEqual(["b1", "b2"]);
    expect([...effectiveHiddenBooks(marked, new Set(["b2"]))]).toEqual(["b1"]);
    expect([...effectiveHiddenBooks([{ ...books[1], archived: true, hideFromAll: true }], new Set(["b1"]))]).toEqual([]);
  });

  it("forgets a toggle whose book is gone", () => {
    // Left in place it would hide a later book that reuses the id.
    expect([...pruneHiddenAddressBooks(books, new Set(["b1", "deleted"]))]).toEqual(["b1"]);
  });
});

describe("hidden address book storage", () => {
  const stored: Record<string, string> = {};

  afterEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  function stubStorage(setItem?: (key: string, value: string) => void) {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => stored[key] ?? null,
      setItem: setItem ?? ((key: string, value: string) => { stored[key] = value; }),
      removeItem: (key: string) => delete stored[key],
    };
  }

  it("survives a reload, and is kept per collection", () => {
    stubStorage();
    storeHiddenAddressBooks("c1", new Set(["b1", "b2"]));
    expect([...loadHiddenAddressBooks("c1")].sort()).toEqual(["b1", "b2"]);
    expect([...loadHiddenAddressBooks("c2")]).toEqual([]);
  });

  it("reads nothing from a value that is not a list of ids", () => {
    stubStorage();
    stored["sealbook.hidden-address-books.c1"] = '{"b1":true}';
    expect([...loadHiddenAddressBooks("c1")]).toEqual([]);
  });

  it("drops non-string entries rather than the whole record", () => {
    stubStorage();
    stored["sealbook.hidden-address-books.c1"] = '["b1",7]';
    expect([...loadHiddenAddressBooks("c1")]).toEqual(["b1"]);
  });

  it("treats a refused write as showing every book", () => {
    // A blocked storage area must not stop the sidebar working.
    stubStorage(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(() => storeHiddenAddressBooks("c1", new Set(["b1"]))).not.toThrow();
    expect([...loadHiddenAddressBooks("c1")]).toEqual([]);
  });

  it("reads nothing where there is no storage area at all", () => {
    expect([...loadHiddenAddressBooks("c1")]).toEqual([]);
  });
});
