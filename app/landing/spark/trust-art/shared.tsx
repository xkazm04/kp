"use client";

import type { ReactNode } from "react";
import type { TargetAndTransition } from "framer-motion";

/*
 * Shared vocabulary for the four Responsible-AI stories.
 *
 * Each pillar of the #trust band gets an illustration that ARGUES its claim
 * rather than decorating it: the human-gate one shows a candidate physically
 * stopped at a barrier until a person stamps it, the audit one breaks its own
 * hash chain on camera. A regulated buyer reading "human in the loop" on a
 * marketing page has no reason to believe it; watching the token wait at the
 * gate is cheap evidence, and it is the same evidence the product produces.
 *
 * Same Spark sticker idiom as the rest of the landing (ink outlines, hard
 * offset shadows, spring easing — literal hexes, the docs/design/README.md
 * art-direction exemption). The entrance choreographies come from
 * ../previews/shared so the spotlights and these panels move alike.
 */

/** Replays whenever the band scrolls back into view, like the /about art. */
export const ENTER = { once: false, amount: 0.35 } as const;

/** The white list-row every story builds its cards from. */
export const CARD = "rounded-xl border-[3px] border-[#17202a] bg-white shadow-[3px_3px_0_#17202a]";

/** The small outlined pill used for chips, verdicts and legend swatches. */
export const PILL =
  "inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1 text-sm font-bold shadow-[2px_2px_0_#17202a]";

/*
 * One fixed-height stage for every story, so switching tabs swaps the artwork
 * without the frame growing or shrinking under the reader's cursor — the copy
 * below it would otherwise jump a hundred pixels on every click.
 */
export function ArtStage({ children }: { children: ReactNode }) {
  return <div className="grid h-[500px] w-full grid-cols-[minmax(0,1fr)] place-items-center overflow-hidden sm:h-[382px]">{children}</div>;
}

/**
 * A looping keyframe track, or its resting frame under reduced motion.
 *
 * Every element in a story shares one `duration`, so they all start together on
 * mount and stay in lockstep for the whole loop without a timeline object —
 * `times` are fractions of that same duration, which is what keeps the stamp
 * landing exactly when the barrier lifts.
 */
export function cycle(
  reduceMotion: boolean | null,
  duration: number,
  frames: TargetAndTransition,
  times: number[],
  still: TargetAndTransition
) {
  if (reduceMotion) return { animate: still, transition: { duration: 0 } };
  return {
    whileInView: frames,
    viewport: ENTER,
    transition: { duration, times, repeat: Infinity, ease: "easeInOut" as const }
  };
}
