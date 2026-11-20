import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { newPasswordProblem, passwordStrength } from "./strength";

describe("password strength", () => {
  it("refuses a common password with core's warning", async () => {
    const strength = await passwordStrength("password123", "alice");
    expect(strength.acceptable).toBe(false);
    expect(strength.warning).toBeTruthy();
  });

  it("accepts several unrelated words", async () => {
    expect(await newPasswordProblem("correct vivid harbour lantern", "alice")).toBeNull();
  });

  it("refuses a weak password with a sentence a person can act on", async () => {
    const problem = await newPasswordProblem("qwertyuiop[]", "alice");
    expect(problem).toContain("too easy to guess");
  });

  it("still refuses a short password before loading anything", async () => {
    expect(await newPasswordProblem("short", "alice")).not.toBeNull();
  });
});

describe("the main wasm module", () => {
  const main = readFileSync(resolve(process.cwd(), "src/pkg/sealbook_wasm_bg.wasm"));
  const contains = (bytes: Uint8Array, text: string) => {
    const needle = new TextEncoder().encode(text);
    outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  };

  it("carries no zxcvbn dictionary", () => {
    // A word from zxcvbn's common-password list that nothing else in core holds.
    expect(contains(main, "trustno1")).toBe(false);
    const strength = readFileSync(resolve(process.cwd(), "src/pkg-strength/sealbook_strength_bg.wasm"));
    expect(contains(strength, "trustno1")).toBe(true);
  });

  it("stays within 5% of its size before the strength check existed", () => {
    // 1.10 MB gzipped when this check was added.
    const baseline = 1_106_589;
    expect(gzipSync(main).length).toBeLessThan(baseline * 1.05);
  });
});
