import { describe, expect, it } from "vitest";
import { confirmationGroups, formatConfirmation, normalizeConfirmation } from "./pairing";

// Protocol v2 codes are 26 base-32 characters.
const CODE = "ABCD2345EFGH6789JKLMNPQRST";

describe("normalizeConfirmation", () => {
  it("strips spaces and hyphens and uppercases", () => {
    expect(normalizeConfirmation("abcd 2345-efgh")).toBe("ABCD2345EFGH");
  });

  it("leaves an already-normalised code untouched", () => {
    expect(normalizeConfirmation(CODE)).toBe(CODE);
  });

  it("makes a displayed code compare equal to a typed one", () => {
    const displayed = formatConfirmation(CODE);
    expect(normalizeConfirmation(displayed)).toBe(normalizeConfirmation(CODE.toLowerCase()));
  });

  it("handles empty input", () => {
    expect(normalizeConfirmation("")).toBe("");
  });
});

describe("confirmationGroups", () => {
  it("splits into groups of four", () => {
    expect(confirmationGroups(CODE)).toEqual([
      "ABCD", "2345", "EFGH", "6789", "JKLM", "NPQR", "ST",
    ]);
  });

  it("normalises before grouping, so re-grouping is stable", () => {
    expect(confirmationGroups(formatConfirmation(CODE))).toEqual(confirmationGroups(CODE));
  });

  it("returns a single short group for a code shorter than one group", () => {
    expect(confirmationGroups("AB")).toEqual(["AB"]);
  });

  it("returns nothing for empty input", () => {
    expect(confirmationGroups("")).toEqual([]);
  });
});

describe("formatConfirmation", () => {
  it("joins groups with single spaces", () => {
    expect(formatConfirmation(CODE)).toBe("ABCD 2345 EFGH 6789 JKLM NPQR ST");
  });

  it("is idempotent", () => {
    expect(formatConfirmation(formatConfirmation(CODE))).toBe(formatConfirmation(CODE));
  });
});
