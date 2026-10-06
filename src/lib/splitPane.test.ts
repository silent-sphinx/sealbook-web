import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEADING,
  HANDLE_WIDTH,
  MIN_LEADING,
  MIN_TRAILING,
  clampLeading,
  loadSplit,
  maxLeading,
  saveSplit,
} from "./splitPane";

describe("the widest the leading pane may be", () => {
  it("leaves the trailing pane its minimum plus the handle", () => {
    expect(maxLeading(1200)).toBe(1200 - HANDLE_WIDTH - MIN_TRAILING);
  });

  it("never drops below the leading minimum, which would invert the clamp", () => {
    // A container with no room for both: the leading pane holds its floor and
    // the trailing one takes what is left, as `minmax(0, 1fr)` would anyway.
    expect(maxLeading(400)).toBe(MIN_LEADING);
    expect(maxLeading(1)).toBe(MIN_LEADING);
  });

  it("is unbounded before the container has been measured", () => {
    expect(maxLeading(0)).toBe(Infinity);
  });
});

describe("the width actually drawn", () => {
  it("is what the user dragged to when it fits", () => {
    expect(clampLeading(500, 1600)).toBe(500);
  });

  it("holds the leading minimum against a drag past it", () => {
    expect(clampLeading(10, 1600)).toBe(MIN_LEADING);
  });

  it("keeps the trailing pane alive when the window shrinks under a wide list", () => {
    // Dragged out to 900px on a wide monitor, then the window narrows to 1000px.
    const drawn = clampLeading(900, 1000);
    expect(drawn).toBe(1000 - HANDLE_WIDTH - MIN_TRAILING);
    expect(1000 - HANDLE_WIDTH - drawn).toBeGreaterThanOrEqual(MIN_TRAILING);
  });

  it("restores the chosen width when the room comes back, not the clamped one", () => {
    // The clamp is applied on the way out rather than written back, so widening
    // the window again returns the pane to where it was dragged.
    const stored = 900;
    expect(clampLeading(stored, 1000)).toBeLessThan(stored);
    expect(clampLeading(stored, 1600)).toBe(stored);
  });

  it("falls back to the leading minimum on a container too small for either", () => {
    expect(clampLeading(500, 300)).toBe(MIN_LEADING);
  });

  it("passes the stored width through before the first measurement", () => {
    expect(clampLeading(640, 0)).toBe(640);
  });
});

describe("session persistence", () => {
  // sessionStorage does not exist in this environment, which is the same path a
  // private window or blocked site data takes: the default, never a throw.
  it("reads the default when storage is unavailable", () => {
    expect(loadSplit("sealbook.test-split")).toBe(DEFAULT_LEADING);
  });

  it("does not throw when it cannot write", () => {
    expect(() => saveSplit("sealbook.test-split", 500)).not.toThrow();
    expect(() => saveSplit("sealbook.test-split", null)).not.toThrow();
  });

  it("reads a stored width back, and rejects a value that is not one", () => {
    const store = new Map<string, string>();
    const stub = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    Object.defineProperty(globalThis, "sessionStorage", {
      value: stub,
      configurable: true,
    });
    try {
      saveSplit("k", 480);
      expect(loadSplit("k")).toBe(480);
      // A cleared key, and junk a user or another tab could have left behind.
      saveSplit("k", null);
      expect(loadSplit("k")).toBe(DEFAULT_LEADING);
      stub.setItem("k", "wide");
      expect(loadSplit("k")).toBe(DEFAULT_LEADING);
      stub.setItem("k", "-20");
      expect(loadSplit("k")).toBe(DEFAULT_LEADING);
    } finally {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  });
});
