import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");

function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/u);
        return [name, sources.join(" ")] as const;
      }),
  );
}

const metaPolicy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(
  read("index.html"),
)?.[1];
const headerPolicy = /add_header Content-Security-Policy "([^"]+)"/u.exec(
  read("security-headers.conf"),
)?.[1];

describe("the content security policy", () => {
  it("is in the page itself, so it ships with the bundle", () => {
    expect(metaPolicy).toBeDefined();
    expect(headerPolicy).toBeDefined();
  });

  it("is the header's policy, less what a meta tag cannot carry", () => {
    const header = directives(headerPolicy!);
    header.delete("frame-ancestors");
    expect(directives(metaPolicy!)).toEqual(header);
  });

  it("lets no script run inline, and keeps the header's frame-ancestors", () => {
    const meta = directives(metaPolicy!);
    expect(meta.get("script-src")).toBe("'self' 'wasm-unsafe-eval'");
    expect(directives(headerPolicy!).get("frame-ancestors")).toBe("'none'");
  });

  it("does not widen frames and media to blob: through default-src", () => {
    expect(directives(metaPolicy!).get("default-src")).toBe("'self'");
  });
});
