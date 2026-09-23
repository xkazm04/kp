/*
 * Spark motion presets — ONE vocabulary for the landing's feature previews and
 * the /about step illustrations.
 *
 * There used to be two: previews/shared.tsx held `entrance`/`pop`/`stamp`, and
 * about-art/shared.ts held `ENTER`/`DRAW` while every one of the 22 about-art
 * reveals hand-copied its end state twice (`whileInView` + a reduced-motion
 * `animate`) and a `{ duration: 0 }` ternary onto its transition. The two halves
 * had already drifted on the one rule they share (below). This file is plain
 * `.ts` with a type-only framer import, so node:test exercises the rule directly
 * (motion-presets.test.ts) instead of regex-checking TSX, and the server-side
 * /about page can import the phase list beside it without pulling a client module.
 *
 * THE REDUCED-MOTION RULE: the gate is the TRANSITION, never the `initial` prop
 * and never the markup. `initial` is the style the server writes; branching it
 * would hand the hydrating render a different inline style than the HTML it is
 * hydrating (spark/useStillMotion.ts is the long version of why that is fatal).
 * Swapping the transition for `{ duration: 0 }` instead lands the element on its
 * END state — the composition the visitor is meant to see, arrived at instantly.
 *
 * Fixed Spark art direction: nothing here themes; see docs/design/README.md for
 * the app/landing/ exemption.
 */
import type { TargetAndTransition, Transition } from "framer-motion";

/** The about-art viewport: every step art replays when it re-enters (`once: false`). */
export const ENTER = { once: false, amount: 0.5 } as const;
/** The about-art "draw" easing, for bars and dials filling to their value. */
export const DRAW = { duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

/** What a still reader gets instead of a transition: the end state, now. */
export const INSTANT: Transition = { duration: 0 };

/** A choreography, gated: `transition={entrance(reduce, {…})}`. */
export const entrance = (reduce: boolean, transition: Transition): Transition => (reduce ? INSTANT : transition);

/** What starts a reveal: scrolling into view (the /about arts) or mounting (the previews, inside a dialog). */
export type RevealTrigger = "inView" | "mount";

export type InViewReveal = {
  initial: TargetAndTransition;
  whileInView: TargetAndTransition;
  animate: TargetAndTransition | undefined;
  viewport: typeof ENTER;
  transition: Transition;
};

export type MountReveal = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  transition: Transition;
};

/**
 * The framer props for one reveal, spread onto a motion element:
 * `{...reveal("inView", reduceMotion, final, transition, initial)}`.
 *
 * `inView`: `whileInView` plays the reveal each time the element re-enters.
 * framer's in-view observer is the only thing that would move it there, so a
 * still reader is also given `animate` = the SAME end state and an instant
 * transition — it lands without motion or delay, wherever it is on the page.
 * `mount`: a plain `animate`, no viewport wiring.
 *
 * `initial` never branches on `reduce` (see the rule above).
 */
export function reveal(
  trigger: "inView",
  reduce: boolean,
  final: TargetAndTransition,
  transition: Transition,
  initial: TargetAndTransition
): InViewReveal;
export function reveal(
  trigger: "mount",
  reduce: boolean,
  final: TargetAndTransition,
  transition: Transition,
  initial: TargetAndTransition
): MountReveal;
export function reveal(
  trigger: RevealTrigger,
  reduce: boolean,
  final: TargetAndTransition,
  transition: Transition,
  initial: TargetAndTransition
): InViewReveal | MountReveal {
  const gated = entrance(reduce, transition);
  if (trigger === "mount") return { initial, animate: final, transition: gated };
  return {
    initial,
    whileInView: final,
    animate: reduce ? final : undefined,
    viewport: ENTER,
    transition: gated
  };
}

/** Pop in with a spring — the default entrance for a line of copy or a chip. */
export const pop = (delay: number, reduce = false) =>
  reveal(
    "mount",
    reduce,
    { opacity: 1, scale: 1, y: 0 },
    { delay, type: "spring", bounce: 0.45 },
    { opacity: 0, scale: 0.6, y: 14 }
  );

/** Slam down oversized and settle askew — for anything that reads as a stamp. */
export const stamp = (delay: number, reduce = false) =>
  reveal(
    "mount",
    reduce,
    { opacity: 1, scale: 1, rotate: -6 },
    { delay, type: "spring", bounce: 0.45 },
    { opacity: 0, scale: 2.2, rotate: 10 }
  );
