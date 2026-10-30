import { describe, expect, it } from "vitest";
import { readFixture } from "../test/fixtures";
import { parseMarkdown } from "./markdown";
import { coreRepairPipeTables } from "./wasm";

const fixture = JSON.parse(readFixture("payloads/pipe-tables.json")) as {
  cases: { name: string; input: string; output: string }[];
};

describe("pipe table repair", () => {
  it.each(fixture.cases)("matches the fixture: $name", ({ input, output }) => {
    expect(coreRepairPipeTables(input)).toBe(output);
  });

  it("produces a table the parser reads", () => {
    const repaired = coreRepairPipeTables("| a | b |\n| --- |  |\n| 1 | 2 |");
    expect(parseMarkdown(repaired).map((block) => block.kind)).toEqual(["table"]);
  });
});
