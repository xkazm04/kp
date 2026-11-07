// The refined finish's motion — the calm flavor, tuned quieter (docs/design/one-interface.md
// "Motion"). Short crossfades with 4–8px slides, one ease-out curve, no spring anywhere:
//
//   answerSwap    6px from the side the stepper went to, 200 ms; leaving is an 80 ms fade.
//   panelEnter    4px rise + fade, 180 ms (a new primary, a tab pick on the side).
//   consentEnter  8px rise + fade, 220 ms, no scale (a card settles, it does not pop).
//
// The presets PanelFrame and Seg read for themselves (rowStagger, tabIndicator) come from
// the flavor the layout provides around the side: `snap` — a 2px rise 20 ms apart (all
// eight rows in ~240 ms) and a 120 ms TWEEN for the tab pill, never the calm spring.
// Every preset has the still form under reduced motion: the end state at once.
import type { TargetAndTransition, Transition } from "framer-motion";
import type { MotionFlavor, MotionSpec } from "../../motion";

export const REFINED_EASE: Transition["ease"] = [0.22, 1, 0.36, 1];

/** The flavor the side (tables + tab strip) moves in — see the header note. */
export const REFINED_SIDE_FLAVOR: MotionFlavor = "snap";

export const REFINED_OFFSET = { swap: 6, panel: 4, consent: 8 } as const;
export const REFINED_DURATION = { swap: 0.2, panel: 0.18, consent: 0.22, leave: 0.08 } as const;

const LEAVE: TargetAndTransition = { opacity: 0, transition: { duration: REFINED_DURATION.leave } };
const STILL: MotionSpec = { initial: false, animate: { opacity: 1, x: 0, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0 } };

export type RefinedMotion = {
  answerSwap: (dir: 1 | -1) => MotionSpec;
  panelEnter: MotionSpec;
  consentEnter: MotionSpec;
};

export function refinedMotion(reduced: boolean): RefinedMotion {
  if (reduced) return { answerSwap: () => STILL, panelEnter: STILL, consentEnter: STILL };
  return {
    answerSwap: (dir) => ({
      initial: { opacity: 0, x: dir * REFINED_OFFSET.swap },
      animate: { opacity: 1, x: 0 },
      exit: LEAVE,
      transition: { duration: REFINED_DURATION.swap, ease: REFINED_EASE },
    }),
    panelEnter: {
      initial: { opacity: 0, y: REFINED_OFFSET.panel },
      animate: { opacity: 1, y: 0 },
      exit: LEAVE,
      transition: { duration: REFINED_DURATION.panel, ease: REFINED_EASE },
    },
    consentEnter: {
      initial: { opacity: 0, y: REFINED_OFFSET.consent },
      animate: { opacity: 1, y: 0 },
      exit: LEAVE,
      transition: { duration: REFINED_DURATION.consent, ease: REFINED_EASE },
    },
  };
}
