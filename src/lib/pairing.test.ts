import { describe, expect, it } from "vitest";
import { PAIR_CODE_WORDS, pairCodeWords } from "./pairing";

describe("pairCodeWords", () => {
  it("splits a code on any run of spaces", () => {
    expect(pairCodeWords("  apple  banana\tcherry ")).toEqual(["apple", "banana", "cherry"]);
  });

  it("returns nothing for an empty code", () => {
    expect(pairCodeWords("")).toEqual([]);
  });

  it("names eight words, as core makes them", () => {
    expect(PAIR_CODE_WORDS).toBe(8);
  });
});
