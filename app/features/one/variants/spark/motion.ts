"use client";

// Spark's finish-local motion (round 3) — the landing's "sticker slapped onto the page" feel
// on top of motion.ts's spring flavor. Same moves, same moments as every finish; only the
// physics differ. Every spec has the shared STILL form under reduced motion, every move
// settles under ~300 ms, nothing loops.
import type { Transition } from "framer-motion";
import type { MotionSpec, OneMotionPresets } from "../../motion";

/** The featured card's resting tilt (deg) — the ONE tilted surface on the screen. It is a
 *  pose, not a motion, so it holds under reduced motion too. */
export const CARD_TILT = -0.6;

/** A confident spring: lands in ~260 ms with one small overshoot. */
const SLAP: Transition = { type: "spring", stiffness: 520, damping: 30, mass: 0.7 };
const FADE_IN = { duration: 0.12 };
const LEAVE = { opacity: 0, transition: { duration: 0.08 } };

export type SparkMotion = {
  /** The reply + card block, keyed by answer id: slides in from the stepper's side. */
  answerSwap: (dir: 1 | -1) => MotionSpec;
  /** The featured card inside it: drops onto its tilt, a beat after the reply. */
  cardSettle: MotionSpec;
  /** A consent card: rises, untilts and settles flat. */
  consentEnter: MotionSpec;
};

export function sparkMotion(m: OneMotionPresets): SparkMotion {
  if (m.reduced) {
    return {
      answerSwap: m.answerSwap,
      cardSettle: { initial: false, animate: { rotate: CARD_TILT, opacity: 1 }, transition: { duration: 0 } },
      consentEnter: m.consentEnter,
    };
  }
  return {
    answerSwap: (dir) => ({
      initial: { opacity: 0, x: dir * 24 },
      animate: { opacity: 1, x: 0 },
      exit: LEAVE,
      transition: { ...SLAP, opacity: FADE_IN },
    }),
    cardSettle: {
      initial: { opacity: 0, y: 10, rotate: 1.2, scale: 0.985 },
      animate: { opacity: 1, y: 0, rotate: CARD_TILT, scale: 1 },
      transition: { ...SLAP, delay: 0.04, opacity: { duration: 0.12, delay: 0.04 } },
    },
    consentEnter: {
      initial: { opacity: 0, y: 18, rotate: 1.5, scale: 0.96 },
      animate: { opacity: 1, y: 0, rotate: 0, scale: 1 },
      exit: LEAVE,
      transition: { type: "spring", stiffness: 460, damping: 26, mass: 0.8, opacity: FADE_IN },
    },
  };
}
