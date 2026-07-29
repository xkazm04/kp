/*
 * Pure decisions behind <Defer> and the loading choreography (docs/LOADING_CHOREOGRAPHY.md).
 * Kept apart from the component so the rules are unit-testable and so a tab can
 * import the timing constants without pulling a client component into its chunk.
 */

/** When a deferred subtree is allowed to enter the DOM.
 *  - `next-frame` — one requestAnimationFrame after mount. For content that is
 *    part of the page but must not compete with the first paint.
 *  - `idle`       — requestIdleCallback (500ms timeout), falling back to a
 *    macrotask. For genuinely secondary sections.
 *  - `visible`    — when the placeholder scrolls near the viewport. For heavy
 *    below-the-fold widgets (charts, long tables) that many sessions never see. */
export type DeferStrategy = "next-frame" | "idle" | "visible";

/** How far ahead of the viewport a `visible` deferral arms, so the content is
 *  already there by the time the user scrolls to it. */
export const DEFER_VISIBLE_ROOT_MARGIN = "240px";

/** rIC safety net: never hold content longer than this, even on a busy main thread. */
export const DEFER_IDLE_TIMEOUT_MS = 500;

/**
 * How long a gap-filler stays invisible before it fades in (paired with
 * `animation-fill-mode: both`, see `.reveal-quiet` in globals.css).
 *
 * This is the whole anti-flash mechanism: a chunk or fetch that resolves inside
 * this window never paints a single placeholder pixel, and it costs zero timers
 * and zero JS — the CSS delay does it. Content itself is NEVER held for this
 * long; the delay lives on the placeholder only.
 */
export const QUIET_PLACEHOLDER_DELAY_MS = 150;

/**
 * Does this deferral collapse to "render immediately"?
 *
 * Staging is a *perceptual* device — it exists so a tab arrives in waves instead
 * of one big bang. Under `prefers-reduced-motion` the waves themselves read as
 * motion, so the whole tree mounts at once (same principle as the CSS entrance
 * classes going `animation: none`). `immediate` is the test/SSR escape hatch.
 */
export function mountsImmediately({
  strategy,
  reducedMotion = false,
  immediate = false,
}: {
  strategy: DeferStrategy;
  reducedMotion?: boolean;
  immediate?: boolean;
}): boolean {
  if (immediate) return true;
  // `visible` is a payload/perf decision (don't mount a chart nobody scrolls to),
  // not a choreography one — reduced motion must not force it into the DOM.
  if (strategy === "visible") return false;
  return reducedMotion;
}
