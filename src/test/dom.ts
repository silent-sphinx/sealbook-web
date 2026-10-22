/**
 * Shared setup for the component suites. Importing this module is what a
 * `@vitest-environment jsdom` test file needs; the lib suites run under node
 * and must not pull it in.
 */

import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/**
 * The default 1,000 ms leaves too little room for what these suites wait on.
 * Several of them unlock the vault, which is two 600,000-iteration PBKDF2
 * derivations before anything renders, and with one worker per file a full run
 * has every core busy: the calendar import waits were measured at 757 ms under
 * load, so a wait that is doing nothing wrong sits at three quarters of its
 * budget. This is headroom against the machine, not against the app, and it
 * stays well under `testTimeout` so an assertion that will never pass still
 * fails with the query's own report of what it could not find.
 */
configure({ asyncUtilTimeout: 4000 });

/**
 * jsdom performs no layout, so every element reports `offsetParent` as null.
 *
 * That matters because it is the layout property the app reads where a zero
 * cannot be lived with: `Modal` filters its focusable elements by it to skip
 * controls that are present but not rendered. Left as jsdom has it, the filter
 * would discard every candidate and a focus-trap test would exercise the
 * empty-list branch rather than the wrap it is meant to cover.
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
 * jsdom performs no layout, so it ships no `ResizeObserver` either. The shell's
 * header measures itself to size the calendar, `SplitPane` measures its own
 * column and the contact network map measures its pane; all three only need
 * the constructor to exist for a render to get through, and nothing a suite
 * looks at depends on a measurement.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;

/**
 * jsdom implements `getClientRects` on an element but not on a `Range`, which
 * is how the note editor's ProseMirror view measures the caret: a transaction
 * asking to scroll the selection into view throws out of the dispatch, past the
 * test that caused it, and lands as an unhandled error rather than a failure.
 *
 * Both are given, because an empty rect list is what sends the measurement on
 * to `getBoundingClientRect`. They report zeros, as everything else here does;
 * a suite asserting on a real measurement stubs the box itself.
 */
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

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
