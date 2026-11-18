import { describe, expect, it } from "vitest";
import { idsToHide } from "./hiddenMigration";

describe("idsToHide", () => {
  const containers = [
    { id: "a" },
    { id: "b", hideFromAll: true },
    { id: "c", archived: true },
    { id: "d" },
  ];

  it("names the local ones that exist, are in play and are not yet marked", () => {
    expect(idsToHide(containers, new Set(["a", "b", "c", "gone"]))).toEqual(["a"]);
  });

  it("names nothing for an empty set, and never anything that is not in it", () => {
    expect(idsToHide(containers, new Set())).toEqual([]);
    expect(idsToHide(containers, new Set(["a"]))).not.toContain("d");
  });
});
