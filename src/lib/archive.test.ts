import { describe, expect, it } from "vitest";
import { archivedIds } from "./archive";

describe("archivedIds", () => {
  it("holds an archived collection and everything nested under it", () => {
    const away = archivedIds([
      { id: "a" },
      { id: "b", parentId: "a", archived: true },
      { id: "c", parentId: "b" },
      { id: "d", parentId: "a" },
    ]);
    expect([...away].sort()).toEqual(["b", "c"]);
  });

  it("is empty when nothing is archived", () => {
    expect(archivedIds([{ id: "a" }, { id: "b", parentId: "a" }]).size).toBe(0);
  });

  it("ends on a parent cycle", () => {
    const away = archivedIds([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]);
    expect(away.size).toBe(0);
  });
});
