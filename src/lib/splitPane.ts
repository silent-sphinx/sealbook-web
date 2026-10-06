/** Width of the grid track the drag handle occupies. */
export const HANDLE_WIDTH = 7;

/** Narrowest the leading pane may get: a name and its subtitle still have to fit. */
export const MIN_LEADING = 240;

/** Narrowest the trailing pane may get, which is what the drag is protecting. */
export const MIN_TRAILING = 352;

/** 22rem, the width the contacts list had before the split could be dragged. */
export const DEFAULT_LEADING = 352;

/** One nudge of an arrow key. */
export const KEY_STEP = 16;

/**
 * The widest the leading pane may be drawn, given the room the container has.
 *
 * Never below `MIN_LEADING`: on a container too narrow for both minimums the
 * leading pane holds its floor and the trailing one takes what is left, which is
 * the same thing the grid's `minmax(0, 1fr)` would have done anyway. Returning
 * something smaller than the minimum would invert the clamp.
 */
export function maxLeading(available: number): number {
  if (available <= 0) return Infinity;
  return Math.max(MIN_LEADING, available - HANDLE_WIDTH - MIN_TRAILING);
}

/**
 * The width to draw: what the user dragged to, held inside the room available.
 *
 * Kept separate from the stored value so that shrinking the window or reopening
 * the sidebar cannot squeeze the trailing pane out of existence, and widening it
 * again restores the width the user chose rather than the clamped one.
 */
export function clampLeading(stored: number, available: number): number {
  return Math.min(Math.max(stored, MIN_LEADING), maxLeading(available));
}

/**
 * Session storage, not local: the size is remembered for the session, which is
 * also the honest scope for a layout tweak usually made to read one contact
 * rather than as a lasting preference.
 */
export function loadSplit(key: string): number {
  try {
    const stored = Number(sessionStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_LEADING;
  } catch {
    return DEFAULT_LEADING;
  }
}

export function saveSplit(key: string, width: number | null) {
  try {
    if (width === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, String(width));
  } catch {
    // storage unavailable; the width still holds until the view unmounts
  }
}
