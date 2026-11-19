export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * Where a floating panel's top-left corner goes when it is opened at `point`.
 *
 * It flips rather than runs off: a panel that would cross the right or bottom
 * edge is placed so that edge sits on `point` instead, and is never pushed past
 * the top or left. Flipping rather than clamping keeps the panel against what
 * opened it, which is what a menu on a rail button at the foot of the screen
 * needs.
 */
export function placeAt(
  point: Point,
  panel: Size,
  viewport: Size,
  margin = 8,
): { left: number; top: number } {
  const left =
    point.x + panel.width + margin > viewport.width
      ? Math.max(margin, point.x - panel.width)
      : point.x;
  const top =
    point.y + panel.height + margin > viewport.height
      ? Math.max(margin, point.y - panel.height)
      : point.y;
  return { left, top };
}
