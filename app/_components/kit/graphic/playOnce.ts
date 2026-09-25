/*
 * "Plays once per data change" for every graphic part. A part's motion is keyed by the caller's
 * `replayKey`: the first time a part with this `id` sees a key it plays, an equal key never plays again,
 * and the memory survives re-renders AND remounts (a tab switch away and back does not re-pour), because
 * it lives in this module, not in component state. Pure and synchronous so node:test can drive it.
 */

const played = new Map<string, string>();

/**
 * True exactly once per (id, replayKey): the caller should animate now. Under reduced motion it never
 * plays, but the key is still recorded, so switching reduced motion off later does not replay stale data.
 */
export function claimPlay(id: string, replayKey: string, reducedMotion: boolean): boolean {
  if (played.get(id) === replayKey) return false;
  played.set(id, replayKey);
  return !reducedMotion;
}

/** Whether (id, replayKey) has already been claimed, without claiming it. */
export function hasPlayed(id: string, replayKey: string): boolean {
  return played.get(id) === replayKey;
}

/**
 * The OS preference read synchronously, for the one moment the hook cannot answer yet: a part claims its
 * play in a layout effect on first mount, before `useReducedMotion`'s own effect has flipped it true.
 */
export function prefersReducedMotionNow(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false; // no media query support: motion plays, the CSS @media rule still resolves it
  }
}

/** Test hatch: forget every part's played key. */
export function resetPlayed(): void {
  played.clear();
}
