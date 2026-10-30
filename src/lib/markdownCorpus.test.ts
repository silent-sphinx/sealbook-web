import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseMarkdown } from "./markdown";
import { readFixture } from "../test/fixtures";

const NAME = "notes/markdown.json";

type Case = { input: string; blocks: unknown };

/** The tree without `line`, which indexes the note's own text and is host-specific. */
function canonical(source: string): unknown {
  return JSON.parse(JSON.stringify(parseMarkdown(source), (key, value) => (key === "line" ? null : value)));
}

const cases = (JSON.parse(readFixture(NAME)) as { cases: Case[] }).cases;

describe("shared markdown corpus", () => {
  it.skipIf(!process.env.REGENERATE_MARKDOWN_FIXTURE)("regenerate", () => {
    const path = new URL(`../../../sealbook/crates/sealbook-protocol/fixtures/${NAME}`, import.meta.url);
    const out = cases.map(({ input }) => ({ input, blocks: canonical(input) }));
    writeFileSync(path, `${JSON.stringify({ cases: out }, null, 1)}\n`);
  });

  it("holds cases", () => {
    expect(cases.length).toBeGreaterThan(80);
  });

  it.each(cases.map((c, i) => [i, c] as const))("case %i parses to the recorded tree", (_i, c) => {
    expect(canonical(c.input)).toEqual(c.blocks);
  });
});
