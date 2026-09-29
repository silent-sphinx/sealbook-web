import { describe, expect, it } from "vitest";
import { extractRecoveryWords, formatRecoveryWordsFile } from "./phrase";

/** A stand-in 24-word phrase; the words need not be real BIP-39 entries here. */
const WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliet", "kilo", "lima",
  "mike", "november", "oscar", "papa", "quebec", "romeo",
  "sierra", "tango", "uniform", "victor", "whiskey", "xray",
];

describe("extractRecoveryWords", () => {
  it("returns nothing for empty or blank input", () => {
    expect(extractRecoveryWords("")).toEqual([]);
    expect(extractRecoveryWords("   \n  ")).toEqual([]);
  });

  it("reads a plain space-separated phrase", () => {
    expect(extractRecoveryWords(WORDS.join(" "))).toEqual(WORDS);
  });

  it("lowercases words that were pasted capitalised", () => {
    const shouty = WORDS.map((word) => word.toUpperCase()).join(" ");
    expect(extractRecoveryWords(shouty)).toEqual(WORDS);
  });

  it("reads a numbered list, as written in the downloaded file", () => {
    const numbered = WORDS.map((word, index) => `${index + 1}. ${word}`).join("\n");
    expect(extractRecoveryWords(numbered)).toEqual(WORDS);
  });

  it("reads other numbered separators", () => {
    for (const template of ["%n) %w", "%n: %w", "%n - %w"]) {
      const text = WORDS.map((word, index) =>
        template.replace("%n", String(index + 1)).replace("%w", word),
      ).join("\n");
      expect(extractRecoveryWords(text)).toEqual(WORDS);
    }
  });

  it("prefers an explicit raw phrase line when one is present", () => {
    const text = `Some preamble\nRaw phrase: ${WORDS.join(" ")}\nmore trailing text`;
    expect(extractRecoveryWords(text)).toEqual(WORDS);
  });

  it("reads a comma-separated phrase", () => {
    expect(extractRecoveryWords(WORDS.join(", "))).toEqual(WORDS);
  });

  it("tolerates ragged whitespace and newlines", () => {
    expect(extractRecoveryWords(`  ${WORDS.join("\n  ")}  \n`)).toEqual(WORDS);
  });

  it("round-trips the file it generates", () => {
    expect(extractRecoveryWords(formatRecoveryWordsFile(WORDS))).toEqual(WORDS);
  });
});

describe("formatRecoveryWordsFile", () => {
  it("numbers every word", () => {
    const file = formatRecoveryWordsFile(WORDS);
    expect(file).toContain("1. alpha");
    expect(file).toContain("24. xray");
  });
});
