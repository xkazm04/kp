"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { IN_VIEW_AMOUNT, TICK_MS } from "./motion";

/*
 * The tick clock every About scene runs on.
 *
 * The whole deck follows one discipline: a scene is a **deterministic integer
 * clock** driving a **pure phase function** (`sceneAt(phase)` in each scene's
 * `data.ts`). This hook is the only stateful thing in a scene — every component
 * below it is dumb and renders whatever the phase says. That split is what lets
 * a scene's choreography be reviewed as a table of beats instead of chased
 * through JSX, and it is why these loops can be unit-tested without a DOM.
 *
 * Three behaviours are the contract:
 *
 *   - OFF SCREEN → the interval is torn down. Nothing animates in a scene you
 *     are not looking at, so the tab runs one timer per *visible* scene rather
 *     than one per scene on the page.
 *   - RE-ENTERING → the clock REWINDS to 0, so nobody joins a sentence
 *     half-typed. Rewind-on-entry, not pause-on-exit.
 *   - REDUCED MOTION → pin `stillTick` — the one frame that makes the scene's
 *     whole argument — and never create a timer at all. Note this *pins* rather
 *     than freezes: a reader who flips the OS preference mid-loop lands on the
 *     complete diagram, not on whichever half-drawn beat was showing.
 *
 * `stillTick` is a real authoring obligation, not a default. It must be the
 * first tick at which every module has reached its final stage. A scene whose
 * last beat is a teardown or a reset has to name an earlier tick, or its
 * reduced-motion readers get the wrong story.
 */

export type SceneClock = {
  /** Attach to the scene's outermost element — visibility is measured on it. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** The current beat, already wrapped into `[0, cycle)`. Feed this to `sceneAt`. */
  phase: number;
  /** True when the scene is genuinely animating (visible AND motion allowed). */
  playing: boolean;
  /** Pass down to every part so it can zero out its own transition. */
  reduced: boolean;
};

export function useSceneClock(
  cycle: number,
  opts: { stillTick?: number; tickMs?: number; amount?: number } = {},
): SceneClock {
  const { stillTick = cycle - 1, tickMs = TICK_MS, amount = IN_VIEW_AMOUNT } = opts;

  const ref = useRef<HTMLDivElement>(null);
  // `once: false` — scenes replay every time they re-enter, matching the public
  // /about step art (`app/landing/spark/about-art/shared.ts`). A one-shot reveal
  // on a page built for scrolling back and forth reads as broken.
  const inView = useInView(ref, { amount });
  const reduced = useReducedMotion();

  const [tick, setTick] = useState(0);

  // Rewind on entry. This is the render-time previous-state pattern rather than
  // an effect: React 19 forbids a synchronous setState in a useEffect body, and
  // doing it in an effect would also paint one frame of the stale phase first.
  const [prevInView, setPrevInView] = useState(inView);
  if (inView !== prevInView) {
    setPrevInView(inView);
    if (inView && !reduced) setTick(0);
  }

  useEffect(() => {
    if (reduced || !inView) return;
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [reduced, inView, tickMs]);

  // `% cycle` is applied at READ time so `tick` increases monotonically and
  // never wraps in state — a wrapping counter makes "did we just restart?"
  // impossible to answer from the value alone.
  const phase = reduced ? stillTick % cycle : tick % cycle;

  return { ref, phase, playing: inView && !reduced, reduced };
}
