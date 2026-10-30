import { describe, expect, it } from "vitest";
import { readFixture } from "../test/fixtures";
import { coreErrorMessage } from "./wasm";

const fixture = JSON.parse(readFixture("payloads/messages.json")) as {
  cases: { name: string; error: unknown; message: string | null }[];
};

describe("error sentences", () => {
  it.each(fixture.cases)("match the fixture: $name", ({ error, message }) => {
    expect(coreErrorMessage(JSON.stringify(error))).toBe(message);
  });

  it("has no sentence for text that is not a core error", () => {
    expect(coreErrorMessage("Failed to fetch")).toBeNull();
  });
});
