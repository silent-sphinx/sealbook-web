import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_ADDRESS_BOOK_NAME,
  bookNameById,
  parseAddressBook,
  resolveAddressBookId,
  serializeAddressBook,
  sortAddressBooks,
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
    expect(parseAddressBook("b1", JSON.stringify({})).name).toBe("Untitled");
    expect(parseAddressBook("b1", JSON.stringify({ name: "   " })).name).toBe("Untitled");
  });

  it("keeps a body it cannot read visible rather than throwing", () => {
    const parsed = parseAddressBook("b1", "not json");
    expect(parsed.name).toBe("not json");
    expect(parsed.raw).toBe("not json");
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
