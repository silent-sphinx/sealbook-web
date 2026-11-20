import { describe, expect, it } from "vitest";
import { checkMatches, chooseCheckPositions, CHECK_WORD_COUNT } from "./phraseCheck";

const WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);

describe("choosing the words to check", () => {
  it("draws distinct positions in ascending order", () => {
    for (let run = 0; run < 200; run += 1) {
      const positions = chooseCheckPositions(24);
      expect(positions).toHaveLength(CHECK_WORD_COUNT);
      expect(new Set(positions).size).toBe(CHECK_WORD_COUNT);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(positions.every((p) => p >= 0 && p < 24)).toBe(true);
    }
  });

  it("never asks for more words than the phrase has", () => {
    expect(chooseCheckPositions(2)).toHaveLength(2);
  });

  it("is driven by the random source it is given", () => {
    const draws = [0, 0.5, 0.999];
    expect(chooseCheckPositions(24, 3, () => draws.shift() ?? 0)).toEqual([0, 12, 23]);
  });
});

describe("checking the words typed back", () => {
  const positions = [2, 9, 20];

  it("accepts the right words in any case, with stray spaces", () => {
    expect(checkMatches(WORDS, positions, [" Word3", "word10 ", "WORD21"])).toBe(true);
  });

  it("refuses a wrong, swapped or missing word", () => {
    expect(checkMatches(WORDS, positions, ["word3", "word10", "word22"])).toBe(false);
    expect(checkMatches(WORDS, positions, ["word10", "word3", "word21"])).toBe(false);
    expect(checkMatches(WORDS, positions, ["word3", "word10"])).toBe(false);
    expect(checkMatches(WORDS, positions, ["", "", ""])).toBe(false);
  });
});
