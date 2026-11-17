// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyBulkChange } from "./contactBulk";
import { aContact } from "../test/vault";

describe("applyBulkChange", () => {
  it("archives a contact", () => {
    expect(applyBulkChange(aContact("Ada"), { kind: "archive" }).archived).toBe(true);
  });

  it("clears the flag on restore instead of writing false", () => {
    const restored = applyBulkChange({ ...aContact("Ada"), archived: true }, { kind: "restore" });
    expect(restored.archived).toBeUndefined();
  });

  it("moves a contact to the chosen address book and keeps the rest", () => {
    const moved = applyBulkChange(aContact("Ada"), { kind: "move", addressBookId: "work" });
    expect(moved.addressBookId).toBe("work");
    expect(moved.name).toBe("Ada");
  });
});
