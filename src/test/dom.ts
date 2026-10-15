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

/**
 * jsdom has no `matchMedia` at all, so `useMediaQuery` throws before the first
 * render — which otherwise only bites a suite that happens to mount Notes,
 * Calendar or Bookmarks, the views with a breakpoint-dependent sidebar. This
 * evaluates the `min-width`/`max-width` queries the app actually writes
 * against `window.innerWidth` (1024 in jsdom, so `DESKTOP` matches and a test
 * sees the static column rather than a closed drawer) rather than hardcoding
 * one verdict, so a suite that resizes the window still gets a real answer.
 */
function evaluatesMediaQuery(query: string): boolean {
  const min = query.match(/min-width:\s*([\d.]+)px/);
  const max = query.match(/max-width:\s*([\d.]+)px/);
  const width = window.innerWidth;
  if (min && width < Number(min[1])) return false;
  if (max && width > Number(max[1])) return false;
  return true;
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return evaluatesMediaQuery(query);
      },
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

// Vitest is not configured with globals, so React Testing Library cannot
// register its own teardown and each render would otherwise be left in the
// document for the next test.
afterEach(cleanup);
