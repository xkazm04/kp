/*
 * The scene clock's decisions, as pure functions.
 *
 * `useSceneClock` owns the subscriptions (viewport, motion preference, page
 * visibility) and this module owns what those three facts MEAN. Splitting them
 * is what makes the rule testable without a DOM: "does this scene tick right
 * now" is a boolean over three booleans, and it is the kind of predicate that
 * silently loses a term when a fourth condition is added.
 *
 * Pure module: no React, no DOM, no imports.
 */

export type ClockConditions = {
  /** The scene is crossing the reader's viewport. */
  inView: boolean;
  /** The OS asks for reduced motion — the scene is pinned, never animated. */
  reduced: boolean;
  /** The DOCUMENT is being displayed at all (`document.visibilityState`). */
  visible: boolean;
};

/**
 * Whether the interval should exist.
 *
 * `visible` is the term that was missing: `useInView` measures geometry, and a
 * backgrounded tab's elements keep their in-viewport geometry, so every scene a
 * reader had scrolled to went on ticking — one 900ms timer per visible scene,
 * forever, in a tab nobody is looking at. Browsers throttle background timers
 * but do not stop them, and each tick re-renders a whole diagram subtree.
 *
 * Pausing rather than rewinding on hide is deliberate: coming back to a tab is
 * not the same gesture as scrolling a scene into view. The reader left mid
 * sentence and expects to find it where they left it; the rewind belongs to
 * re-entry (see `useSceneClock`).
 */
export function shouldTick({ inView, reduced, visible }: ClockConditions): boolean {
  return inView && !reduced && visible;
}

/**
 * The beat to render.
 *
 * Under reduced motion the clock does not run at all, so the phase is pinned to
 * `stillTick` — the one frame at which every module has reached its final
 * stage. Otherwise `tick` is a monotonic counter and the wrap happens HERE, at
 * read time, so the stored value can always answer "how long has this been
 * playing" and never has to answer "did we just restart".
 */
export function phaseOf(tick: number, cycle: number, opts: { reduced: boolean; stillTick: number }): number {
  const raw = opts.reduced ? opts.stillTick : tick;
  // `% cycle` on a negative or non-integer tick would put a scene on a beat no
  // `sceneAt` table has a row for, which renders as a half-built diagram rather
  // than as an error. Clamp instead.
  const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  return cycle > 0 ? n % cycle : 0;
}

/**
 * Read a `document.visibilityState` into the boolean the clock wants.
 *
 * Anything that is not the string "hidden" counts as visible — including the
 * absence of a document (SSR, a test) and the "prerender" state, both of which
 * must not be treated as a paused tab.
 */
export function isVisibleState(state: string | undefined): boolean {
  return state !== "hidden";
}
