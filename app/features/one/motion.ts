"use client";

// /one's motion presets (round 3) — ONE vocabulary of moves the finishes pick from, so the
// three finishes differ in FEEL (calm / spring / snap), never in what moves or when.
//
//   answerSwap    the reply + the answer's card, keyed by answer id. Direction comes from the
//                 stepper: back enters from the left, forward / a new answer from the right.
//   panelEnter    a view arriving on the side (a new primary, a tab pick).
//   rowStagger    a table's first ROW_STAGGER_MAX rows on mount, 20–30 ms apart (the rest
//                 arrive with the last of them).
//   consentEnter  a consent card: rise + settle.
//   countTick     a header figure tweening to its new value.
//   tabIndicator  the shared-layout pill under the active segment (framer `layoutId`, the
//                 repo's segmented-control standard — AnalyzeWorkspace.tsx).
//
// Every preset has a STILL form under the OS "reduce motion" preference
// (useReducedMotion): the end state, at once, with at most a short opacity change. Every
// move is under ~300 ms and nothing loops.
import { createContext, useContext, useMemo } from "react";
import type { TargetAndTransition, Transition } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { VariantId } from "./types";

export type MotionFlavor = "calm" | "spring" | "snap";

/** The flavor each direction moves in. Round 4: every layout wears the dense finish, so
 *  every one moves in `snap` (calm and spring stay as presets, unused for now). */
export const FLAVOR_OF: Record<VariantId, MotionFlavor> = {
  dense: "snap",
  workbench: "snap",
  sheets: "snap",
  cards: "snap",
};

export const ROW_STAGGER_MAX = 8;

const EASE_OUT: Transition["ease"] = [0.22, 1, 0.36, 1];

/** The base transition of a flavor (`scale` stretches the calm/snap durations). */
function base(flavor: MotionFlavor, scale = 1): Transition {
  switch (flavor) {
    case "spring":
      return { type: "spring", stiffness: 420, damping: 30, mass: 0.8 };
    case "snap":
      return { duration: 0.12 * scale, ease: EASE_OUT };
    case "calm":
      return { duration: 0.22 * scale, ease: EASE_OUT };
  }
}

const OFFSET: Record<MotionFlavor, number> = { calm: 8, spring: 16, snap: 4 };

/** The props a preset hands a `motion.*` element. */
export type MotionSpec = {
  initial: false | TargetAndTransition;
  animate: TargetAndTransition;
  exit?: TargetAndTransition;
  transition: Transition;
};

/** Leaving is always quick and directionless (a fade), so an `AnimatePresence mode="wait"`
 *  swap never holds the next answer back. */
const LEAVE: TargetAndTransition = { opacity: 0, transition: { duration: 0.09 } };

const STILL: MotionSpec = { initial: false, animate: { opacity: 1, x: 0, y: 0, scale: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } };

export type OneMotionPresets = {
  flavor: MotionFlavor;
  reduced: boolean;
  /** `dir` 1 = forward / new (from the right), -1 = back (from the left). */
  answerSwap: (dir: 1 | -1) => MotionSpec;
  panelEnter: MotionSpec;
  /** Row `index` of a freshly mounted table; rows past ROW_STAGGER_MAX arrive with the last
   *  staggered one. null = no motion (reduced). */
  rowStagger: (index: number) => MotionSpec | null;
  consentEnter: MotionSpec;
  /** Duration in seconds of a count tween (0 = jump). */
  countTick: number;
  tabIndicator: Transition;
};

export function presets(flavor: MotionFlavor, reduced: boolean): OneMotionPresets {
  const d = OFFSET[flavor];
  if (reduced) {
    return {
      flavor,
      reduced,
      answerSwap: () => STILL,
      panelEnter: STILL,
      // NOT null: useReducedMotion starts false on mount, so a row may already have
      // mounted at the stagger's opacity 0. Dropping `animate` would leave it there; an
      // instant animate-to-rest settles it whenever the preference arrives.
      rowStagger: () => ({ initial: false, animate: { opacity: 1, x: 0, y: 0, scale: 1 }, transition: { duration: 0 } }),
      consentEnter: STILL,
      countTick: 0,
      tabIndicator: { duration: 0 },
    };
  }
  return {
    flavor,
    reduced,
    answerSwap: (dir) => ({
      initial: { opacity: 0, x: dir * d * 2 },
      animate: { opacity: 1, x: 0 },
      exit: LEAVE,
      transition: flavor === "spring" ? { ...base("spring"), opacity: { duration: 0.16 } } : base(flavor),
    }),
    panelEnter: {
      initial: { opacity: 0, y: d },
      animate: { opacity: 1, y: 0 },
      exit: LEAVE,
      transition: flavor === "spring" ? { ...base("spring"), opacity: { duration: 0.14 } } : base(flavor),
    },
    // Rows past the cap arrive together with the last staggered one — never before it, so
    // a tall table never shows a hole where rows 2–8 are still on their way.
    rowStagger: (index) => ({
      initial: { opacity: 0, y: Math.ceil(d / 2) },
      animate: { opacity: 1, y: 0 },
      transition: { ...base(flavor === "spring" ? "calm" : flavor, 0.8), delay: Math.min(index, ROW_STAGGER_MAX - 1) * (flavor === "snap" ? 0.02 : 0.03) },
    }),
    consentEnter: {
      initial: { opacity: 0, y: d * 1.5, scale: flavor === "spring" ? 0.96 : 0.99 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: LEAVE,
      transition: flavor === "spring" ? { type: "spring", stiffness: 380, damping: 22 } : base(flavor, 1.2),
    },
    countTick: flavor === "snap" ? 0.18 : flavor === "spring" ? 0.32 : 0.28,
    tabIndicator: flavor === "spring" ? { type: "spring", stiffness: 420, damping: 30 } : flavor === "snap" ? { duration: 0.12, ease: EASE_OUT } : { type: "spring", stiffness: 420, damping: 38 },
  };
}

/** The flavor in effect below a provider (the shell provides the variant's). */
export const OneMotion = createContext<MotionFlavor>("calm");

/** The presets for the flavor in effect, still under reduced motion. */
export function useOneMotion(): OneMotionPresets {
  const flavor = useContext(OneMotion);
  const reduced = useReducedMotion();
  return useMemo(() => presets(flavor, reduced), [flavor, reduced]);
}
