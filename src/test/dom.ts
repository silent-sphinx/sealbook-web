/**
 * Shared setup for the component suites. Importing this module is what a
 * `@vitest-environment jsdom` test file needs; the lib suites run under node
 * and must not pull it in.
 */

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom performs no layout, so every element reports `offsetParent` as null.
 *
 * That matters because it is the one layout property the app reads: `Modal`
 * filters its focusable elements by it to skip controls that are present but
 * not rendered. Left as jsdom has it, the filter would discard every candidate
 * and a focus-trap test would exercise the empty-list branch rather than the
 * wrap it is meant to cover.
 *
 * This restores the only part of the real contract that filter depends on: an
 * element that is rendered has an offset parent, one that is hidden does not.
 */
function isHidden(node: HTMLElement): boolean {
  // `hidden` reflects as `boolean | "until-found"`, so it is coerced rather
  // than returned directly.
  return Boolean(node.hidden) || node.style.display === "none";
}

Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get(this: HTMLElement): Element | null {
    if (isHidden(this)) return null;
    for (let node = this.parentElement; node; node = node.parentElement) {
      if (isHidden(node)) return null;
    }
    return this.parentElement;
  },
});

// Vitest is not configured with globals, so React Testing Library cannot
// register its own teardown and each render would otherwise be left in the
// document for the next test.
afterEach(cleanup);
