import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACCENT_COLORS, DEFAULT_ACCENT } from "./accountSettings";
import { readFixture } from "../test/fixtures";

const tokens = JSON.parse(readFixture("design/tokens.json")) as {
  colors: Record<string, string>;
  default_accent: string;
  accents: Record<string, { base: string; dim: string }>;
};

const css = new TextDecoder().decode(
  readFileSync(new URL("../index.css", import.meta.url)),
);

function declared(name: string): string | undefined {
  return css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
}

describe("shared design tokens", () => {
  it.each(Object.entries(tokens.colors))("index.css declares the colour %s", (name, value) => {
    expect(declared(`color-${name.replace("_", "-")}`)).toBe(value);
  });

  it("the accent table matches", () => {
    expect(ACCENT_COLORS).toEqual(tokens.accents);
    expect(DEFAULT_ACCENT).toBe(tokens.default_accent);
  });

  it("the stylesheet's default accent is the default accent's pair", () => {
    const pair = tokens.accents[tokens.default_accent];
    expect(declared("sb-accent")).toBe(pair.base);
    expect(declared("sb-accent-dim")).toBe(pair.dim);
  });
});
