// Pure viewport-clamping for the Fit Matrix "why this score" popover, extracted from
// MatrixTab so it can be unit-tested AND reused on layout change (MatrixTab is .tsx —
// the node --test runner can't load JSX).
//
// bug-ui-scan-2026-07-09 (skill-matrix-coverage #5): the popover was positioned once, from
// the clicked cell's getBoundingClientRect() captured at click time, with only an Escape
// listener — no resize/scroll handler — so rotating a tablet or resizing left it floating
// detached from its cell. MatrixTab now recomputes position from the live trigger rect on
// resize/scroll via THIS function. The old inline math also had no LOWER clamp on `top`
// (`Math.min(rect.bottom + 6, innerHeight - 340)`), so on a short viewport the popover was
// pushed to a NEGATIVE top and rendered partly off the top edge; the fix clamps to `margin`.

export type Rect = { left: number; bottom: number };
export type Viewport = { width: number; height: number };
export type PopoverDims = { width?: number; height?: number; gap?: number; margin?: number };

// grid-chrome-holds-the-floor. `PopoverDims` existed but NOTHING ever passed one, so
// every placement used the module's 320 × 340 default — and the dialog it clamps is
// `w-80 max-h-[60vh]` (MatrixReasoningPopover.tsx). The width happened to agree (w-80 =
// 320px); the height did not, and it is viewport-relative, so the constant was wrong in
// both directions: too small on a tall window (the popover was pushed further down the
// page than it needed to be) and too large on a short one. These two constants are the
// class list, restated once where the math can see it.
export const POPOVER_WIDTH = 320; // w-80
export const POPOVER_MAX_VH = 0.6; // max-h-[60vh]

/** The dims to clamp against. `measuredHeight` is the dialog's real box when it exists;
 *  on the FIRST placement it does not yet, so the declared 60vh ceiling stands in. The
 *  measured height is still capped by that ceiling — a dialog mid-transition can report
 *  a box taller than its own max-height. */
export function popoverDims(viewport: Viewport, measuredHeight?: number | null): PopoverDims {
  const ceiling = viewport.height * POPOVER_MAX_VH;
  const height = measuredHeight != null && measuredHeight > 0 ? Math.min(measuredHeight, ceiling) : ceiling;
  return { width: POPOVER_WIDTH, height };
}

/** Clamp a popover anchored under `rect` to stay fully within `viewport`. Prefers to sit
 *  `gap`px below the cell; clamps left/top into [margin, edge − size − margin]. `top` is
 *  clamped on BOTH ends, so a viewport too short for the popover pins it to `margin`
 *  (visible) instead of a negative, off-screen top. */
export function computePopoverPosition(rect: Rect, viewport: Viewport, dims: PopoverDims = {}): { top: number; left: number } {
  const width = dims.width ?? POPOVER_WIDTH;
  const height = dims.height ?? 340;
  const gap = dims.gap ?? 6;
  const margin = dims.margin ?? 8;
  const left = clamp(rect.left, margin, viewport.width - width - margin);
  const top = clamp(rect.bottom + gap, margin, viewport.height - height - margin);
  return { top, left };
}

/** Clamp `v` into [min, max]; when the range is inverted (max < min — the element is larger
 *  than the room available), `min` wins so the popover stays anchored at the safe margin. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, Math.max(min, max)));
}
