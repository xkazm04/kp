/*
 * The level stack (pure; pinned by levelStack.test.ts): a surface you walk INTO, level by level,
 * instead of a page of tabs. The root is always level 0; a push opens a level over the current one,
 * a pop returns, popTo is a breadcrumb click, replaceTop is a sideways step (the next channel, the
 * next message). Lifted from the Night Post (Hiring > Channels); a surface keeps its own entry type
 * and says when two entries name the same place, and nothing here knows React, the DOM or the URL.
 */

/** Anything with a level; level 0 is the root. */
export type LevelEntry = { level: number };

export type LevelAction<E extends LevelEntry> =
  | { type: "push"; entry: E }
  | { type: "pop" }
  | { type: "popTo"; depth: number }
  | { type: "replaceTop"; entry: E }
  | { type: "reset"; stack: readonly E[] };

/** What a surface tells the reducer: its root stack, and when two entries are the same place. */
export type LevelRules<E extends LevelEntry> = { root: readonly E[]; same: (a: E, b: E) => boolean };

/**
 * One transition. The root never leaves; a push of a place already on the stack returns to it
 * (relay -> ledger -> message -> "configure the relay" pops back to the relay instead of stacking a
 * second one); pushing a level-0 entry is going home; a sideways step keeps its level; a reset to a
 * stack without a level-0 root is refused (the root stack instead).
 */
export function levelReduce<E extends LevelEntry>(stack: readonly E[], action: LevelAction<E>, rules: LevelRules<E>): readonly E[] {
  const base = stack.length > 0 && stack[0].level === 0 ? stack : rules.root;
  switch (action.type) {
    case "push": {
      if (action.entry.level === 0) return base.slice(0, 1);
      const at = base.findIndex((e, i) => i > 0 && rules.same(e, action.entry));
      if (at > 0) return [...base.slice(0, at), action.entry];
      return [...base, action.entry];
    }
    case "pop":
      return base.length > 1 ? base.slice(0, -1) : base;
    case "popTo":
      return base.slice(0, Math.max(1, Math.min(base.length, action.depth + 1)));
    case "replaceTop": {
      const top = base[base.length - 1];
      if (base.length < 2 || !top || top.level !== action.entry.level) return base;
      return [...base.slice(0, -1), action.entry];
    }
    case "reset":
      return action.stack.length > 0 && action.stack[0].level === 0 ? action.stack : rules.root;
  }
}

/* ------------------------------------------------------------------ how each layer is on screen */

/**
 * How a stacked level is on screen (LevelTransition draws each one):
 *   flow      the current level, in the page flow
 *   under     the level beneath an opening one: still drawn, inert
 *   entering  opening: laid over `under`, a circle growing from the element that was touched
 *   leaving   closing: laid over the level it returns to, the circle shrinking back onto its opener
 *   swapping  a sideways step: a short fade in place
 *   hidden    covered: kept mounted (its typed state survives the descent), not displayed
 */
export type LayerMode = "flow" | "under" | "entering" | "leaving" | "swapping" | "hidden";
export type TransitionKind = "open" | "close" | "swap" | null;

/**
 * The mode of the layer at `depth` when the top is `top` and a transition may be running. Only the
 * top is ever in the page flow; while it opens, the one beneath stays drawn (inert) so the circle
 * has something to grow over. A closing level is not in the stack any more: the surface draws it
 * separately as `leaving`, over the new top.
 */
export function layerModeAt(depth: number, top: number, transition: TransitionKind): LayerMode {
  if (depth === top) return transition === "open" ? "entering" : transition === "swap" ? "swapping" : "flow";
  if (depth === top - 1 && transition === "open") return "under";
  return "hidden";
}
