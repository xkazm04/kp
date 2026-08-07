// Where a pointer-anchored menu actually lands. Kept apart from the component
// (like defer-policy.ts and select-keys.ts) so the arithmetic is unit-testable
// without a DOM — the failure mode is silent (actions render off-screen), never a
// thrown error, so it earns its own tests.

/** Width the menu is clamped against before its real size is measured (w-56). */
export const MENU_WIDTH = 224;
/** How close the menu may come to a viewport edge. */
export const VIEWPORT_MARGIN = 8;

export type Point = { x: number; y: number };

/**
 * Keep the menu fully on screen: pull it back from the right/bottom edges rather
 * than letting it overflow, and never push it past the top/left margin (a menu
 * taller than the viewport pins to the margin and scrolls its own content).
 */
export function clampMenuPosition(
  at: Point,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): Point {
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(at.x, viewport.width - size.width - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(at.y, viewport.height - size.height - VIEWPORT_MARGIN)),
  };
}
