import { describe, expect, it } from "vitest";
import { canonicalTag, hasTag, normalizeTags, tagVocabulary } from "./tags";

describe("tagVocabulary", () => {
  it("counts a tag once per use, ignoring case, and keeps the first spelling", () => {
    const vocabulary = tagVocabulary([["Rust", "web"], undefined, ["rust"]]);
    expect(vocabulary).toEqual([
      { key: "rust", name: "Rust", count: 2 },
      { key: "web", name: "web", count: 1 },
    ]);
  });
});

describe("canonicalTag", () => {
  const vocabulary = tagVocabulary([["Rust"]]);

  it("returns the known spelling, or the trimmed input for a new tag", () => {
    expect(canonicalTag(vocabulary, " RUST ")).toBe("Rust");
    expect(canonicalTag(vocabulary, " go ")).toBe("go");
  });
});

describe("hasTag", () => {
  it("matches by lowercase key", () => {
    expect(hasTag(["Rust"], "rust")).toBe(true);
    expect(hasTag(undefined, "rust")).toBe(false);
  });
});

describe("normalizeTags", () => {
  it("trims, drops blanks and case-insensitive duplicates, and reads a non-array as none", () => {
    expect(normalizeTags([" a ", "A", "", "b", 3])).toEqual(["a", "b"]);
    expect(normalizeTags("a")).toEqual([]);
  });
});
