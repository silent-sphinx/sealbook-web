import { describe, expect, it } from "vitest";
import { placeAt } from "./placement";

const viewport = { width: 1000, height: 800 };
const panel = { width: 200, height: 300 };

describe("placeAt", () => {
  it("opens at the point when the panel fits", () => {
    expect(placeAt({ x: 100, y: 100 }, panel, viewport)).toEqual({ left: 100, top: 100 });
  });

  it("flips left of the point when it would cross the right edge", () => {
    expect(placeAt({ x: 900, y: 100 }, panel, viewport)).toEqual({ left: 700, top: 100 });
  });

  it("flips above the point when it would cross the bottom edge", () => {
    expect(placeAt({ x: 100, y: 700 }, panel, viewport)).toEqual({ left: 100, top: 400 });
  });

  it("flips on both axes in the bottom-right corner", () => {
    expect(placeAt({ x: 990, y: 790 }, panel, viewport)).toEqual({ left: 790, top: 490 });
  });

  it("keeps the margin when the panel is taller than the room above the point", () => {
    expect(placeAt({ x: 100, y: 200 }, { width: 200, height: 780 }, viewport)).toEqual({
      left: 100,
      top: 8,
    });
  });

  it("counts the margin when deciding whether the panel fits", () => {
    // 492 + 300 + 8 is exactly the viewport's height, so it still fits.
    expect(placeAt({ x: 100, y: 492 }, panel, viewport)).toEqual({ left: 100, top: 492 });
    expect(placeAt({ x: 100, y: 493 }, panel, viewport)).toEqual({ left: 100, top: 193 });
  });
});
