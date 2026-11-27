import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { Node } from "@tiptap/pm/model";

import { parseMarkdown } from "./markdown";
import { docToMarkdown, markdownToDoc } from "./noteDoc";
import { noteExtensions } from "./noteEditorSchema";
import { readFixture } from "../test/fixtures";
import { ROUNDTRIP_EXTRAS } from "../test/markdownRoundtripInputs";

const NAME = "notes/markdown.json";
const ROUNDTRIP = "notes/markdown-roundtrip.json";

type Case = { input: string; blocks: unknown };
type Trip = { input: string; canonical: string };

/** The tree without `line`, which indexes the note's own text and is host-specific. */
function canonical(source: string): unknown {
  return JSON.parse(JSON.stringify(parseMarkdown(source), (key, value) => (key === "line" ? null : value)));
}

const schema = getSchema(noteExtensions("placeholder"));

/** What a save writes: the body loaded into the editor's schema and serialised. */
function saved(source: string): string {
  return docToMarkdown(Node.fromJSON(schema, markdownToDoc(source)).toJSON());
}

const cases = (JSON.parse(readFixture(NAME)) as { cases: Case[] }).cases;

/** Every input, then every output that differs from them, so a second save is pinned too. */
function roundtrips(): Trip[] {
  const inputs = new Set([...cases.map((c) => c.input), ...ROUNDTRIP_EXTRAS]);
  const trips = [...inputs].map((input) => ({ input, canonical: saved(input) }));
  for (const { canonical: output } of [...trips]) {
    if (inputs.has(output)) continue;
    inputs.add(output);
    trips.push({ input: output, canonical: saved(output) });
  }
  return trips;
}

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

  it.skipIf(!process.env.REGENERATE_ROUNDTRIP_FIXTURE)("regenerate the round trips", () => {
    const path = new URL(`../../../sealbook/crates/sealbook-protocol/fixtures/${ROUNDTRIP}`, import.meta.url);
    writeFileSync(path, `${JSON.stringify({ cases: roundtrips() }, null, 1)}\n`);
  });

  it.skipIf(!!process.env.REGENERATE_ROUNDTRIP_FIXTURE)("saves every body as recorded", () => {
    const recorded = (JSON.parse(readFixture(ROUNDTRIP)) as { cases: Trip[] }).cases;
    expect(roundtrips()).toEqual(recorded);
  });
});
