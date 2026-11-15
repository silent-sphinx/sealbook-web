import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

describe("qrPath", () => {
  it("draws a pairing code as square modules inside its border", () => {
    const { size, path } = qrPath("SEALBOOK-PAIR:ABANDON ABILITY ABLE ABOUT ABOVE ABSENT ABSORB ABSTRACT");
    expect(size).toBeGreaterThan(21);
    const modules = path.match(/M(\d+) (\d+)h1v1h-1z/gu) ?? [];
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      const [x, y] = module.slice(1).split(/[ h]/u).map(Number);
      // The two-module quiet zone stays white.
      expect(x).toBeGreaterThanOrEqual(2);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThan(size - 2);
      expect(y).toBeLessThan(size - 2);
    }
  });

  it("encodes different codes differently", () => {
    expect(qrPath("SEALBOOK-PAIR:A").path).not.toBe(qrPath("SEALBOOK-PAIR:B").path);
  });
});
