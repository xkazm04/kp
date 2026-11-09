"use client";

// /one's motion presets — ONE vocabulary of moves (round 3), orchestrated in round 5
// (docs/design/one-interface.md "Motion orchestration"). Which element owns which gesture:
//
//   answerSwap    the reply line, keyed by answer id. Direction comes from the stepper: back
//                 enters from the left, forward / a new answer from the right.
//   panelEnter    a view a region has NEVER shown arriving in it (fade + a small rise).
//   viewSwap      a view the region HAS shown before swapping back in: a plain crossfade.
//   rowList/row   a table's rows on the view's FIRST arrival only (panels/seen.ts decides):
//                 the list is the parent and orchestrates (`delayChildren` cascade over the
//                 first ROW_STAGGER_MAX rows, the rest arrive with the last of them); a row
//                 that joins later plays `row` once on its own; a row that leaves is gone
//                 at once and its neighbours close the gap with `layout="position"`.
//   consentEnter  a consent card: rise + settle.
//   countTick     a header figure tweening to a CHANGED value (the first value is plain).
//   tabIndicator  the shared-layout pill under the active segment (framer `layoutId`, the
//                 repo's segmented-control standard — AnalyzeWorkspace.tsx).
//
// Reduced motion is honoured in ONE place: OneShell's root <MotionConfig reducedMotion="user">
// (ONE_MOTION_CONFIG), which drops every transform and layout animation and keeps at most the
// opacity change — so these presets do NOT carry a second, per-component still form. The
// JS-driven moves framer cannot see (the count tween, a smooth scroll) read `reduced` here,
// which comes from that same MotionConfig. Every move is under ~300 ms and nothing loops.
import { createContext, useContext } from "react";
import { useReducedMotionConfig, type MotionConfigProps, type TargetAndTransition, type Transition, type Variants } from "framer-motion";

export type MotionFlavor = "calm" | "spring" | "snap";

/** The flavor /one moves in. Round 5: one layout (Sheets) in the dense finish, so one
 *  flavor — `snap` (calm and spring stay as presets, unused for now). */
export const ONE_FLAVOR: MotionFlavor = "snap";

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

/** The root MotionConfig: reduced motion honoured once, for every motion element below, and
 *  the flavor's base move as the default transition. */
export function motionConfig(flavor: MotionFlavor): Pick<MotionConfigProps, "reducedMotion" | "transition"> {
  return { reducedMotion: "user", transition: base(flavor) };
}
export const ONE_MOTION_CONFIG = motionConfig(ONE_FLAVOR);

/** The props a preset hands a `motion.*` element. */
export type MotionSpec = {
  initial: false | TargetAndTransition;
  animate: TargetAndTransition;
  exit?: TargetAndTransition;
  transition: Transition;
};

/** Leaving is always quick and directionless (a fade), so a swap never holds the next view back. */
const LEAVE: TargetAndTransition = { opacity: 0, transition: { duration: 0.06 } };

export type OneMotionPresets = {
  flavor: MotionFlavor;
  /** The reader asked for reduced motion (from the root MotionConfig). For JS-driven moves only. */
  reduced: boolean;
  /** `dir` 1 = forward / new (from the right), -1 = back (from the left). */
  answerSwap: (dir: 1 | -1) => MotionSpec;
  panelEnter: MotionSpec;
  viewSwap: MotionSpec;
  /** The row list (the parent): `hidden` → `shown` orchestrates its rows' first arrival. */
  rowList: Variants;
  /** One row: `hidden` → `shown`. */
  row: Variants;
  consentEnter: MotionSpec;
  /** Duration in seconds of a count tween (0 = jump). */
  countTick: number;
  tabIndicator: Transition;
};

/** The cascade step between two rows. */
const STEP: Record<MotionFlavor, number> = { calm: 0.015, spring: 0.015, snap: 0.02 };

/** Row `i`'s delay in the first-arrival cascade: rows past the cap arrive with the last
 *  staggered one — never before it, so a tall table never shows a hole. */
export function cascadeDelay(flavor: MotionFlavor, i: number): number {
  return Math.min(i, ROW_STAGGER_MAX - 1) * STEP[flavor];
}

function build(flavor: MotionFlavor, reduced: boolean): OneMotionPresets {
  const d = OFFSET[flavor];
  const rowMove = base(flavor === "spring" ? "calm" : flavor, 0.8);
  return {
    flavor,
    reduced,
    answerSwap: (dir) => (dir === 1 ? SWAP[flavor].fwd : SWAP[flavor].back),
    panelEnter: {
      initial: { opacity: 0, y: d },
      animate: { opacity: 1, y: 0 },
      exit: LEAVE,
      transition: flavor === "spring" ? { ...base("spring"), opacity: { duration: 0.14 } } : base(flavor),
    },
    viewSwap: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: LEAVE, transition: { duration: 0.12, ease: EASE_OUT } },
    rowList: { hidden: {}, shown: { transition: { delayChildren: (i: number) => cascadeDelay(flavor, i) } } },
    row: { hidden: { opacity: 0, y: Math.ceil(d / 2) }, shown: { opacity: 1, y: 0, transition: rowMove } },
    consentEnter: {
      initial: { opacity: 0, y: d * 1.5, scale: flavor === "spring" ? 0.96 : 0.99 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: LEAVE,
      transition: flavor === "spring" ? { type: "spring", stiffness: 380, damping: 22 } : base(flavor, 1.2),
    },
    countTick: reduced ? 0 : flavor === "snap" ? 0.18 : flavor === "spring" ? 0.32 : 0.28,
    tabIndicator: flavor === "spring" ? { type: "spring", stiffness: 420, damping: 30 } : flavor === "snap" ? { duration: 0.12, ease: EASE_OUT } : { type: "spring", stiffness: 420, damping: 38 },
  };
}

const swapOf = (flavor: MotionFlavor, dir: 1 | -1): MotionSpec => ({
  initial: { opacity: 0, x: dir * OFFSET[flavor] * 2 },
  animate: { opacity: 1, x: 0 },
  exit: LEAVE,
  transition: flavor === "spring" ? { ...base("spring"), opacity: { duration: 0.16 } } : base(flavor),
});
const SWAP: Record<MotionFlavor, { fwd: MotionSpec; back: MotionSpec }> = {
  calm: { fwd: swapOf("calm", 1), back: swapOf("calm", -1) },
  spring: { fwd: swapOf("spring", 1), back: swapOf("spring", -1) },
  snap: { fwd: swapOf("snap", 1), back: swapOf("snap", -1) },
};

/** Presets are built once per (flavor, reduced): the same objects every render, so a motion
 *  element's props never change identity under it (performance-discipline). */
const BUILT = new Map<string, OneMotionPresets>();
export function presets(flavor: MotionFlavor, reduced: boolean): OneMotionPresets {
  const k = `${flavor}|${reduced}`;
  let hit = BUILT.get(k);
  if (!hit) {
    hit = build(flavor, reduced);
    BUILT.set(k, hit);
  }
  return hit;
}

/** The flavor in effect below a provider (the shell provides ONE_FLAVOR). */
export const OneMotion = createContext<MotionFlavor>("calm");

/** The presets for the flavor in effect. `reduced` is the root MotionConfig's answer. */
export function useOneMotion(): OneMotionPresets {
  const flavor = useContext(OneMotion);
  const reduced = useReducedMotionConfig() === true;
  return presets(flavor, reduced);
}
