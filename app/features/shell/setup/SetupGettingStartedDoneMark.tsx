"use client";

/**
 * The "this step is done" signal for the Getting-started briefing.
 *
 * It exists so completion is *reported* rather than *substituted*: the briefing
 * used to swap the focused step's title and body for a congratulation, which
 * erased the one thing the operator was reading and made a finished step
 * indistinguishable from a step that never existed. The step keeps its own words;
 * this mark sits under the progress meter and says the state changed.
 *
 * Motion follows the app-side idiom (framer + the shared reduced-motion gate),
 * not the glyph preset library — `pathLength` is one of the few SVG attributes
 * framer animates safely, and a two-segment tick is a stroke, so it genuinely
 * draws rather than fading. Under `prefers-reduced-motion` it renders already
 * drawn, with no initial state to animate from. `label` is the accessible name
 * only — the mark carries no visible text, so at the size it renders it has to
 * read as a tick and nothing else. The stroke reads
 * `var(--color-moss)` because SVG strokes can't take Tailwind colour utilities
 * and a literal hex is banned outside `app/landing/`.
 */

import { motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

export function SetupGettingStartedDoneMark({ label }: { label: string }) {
  const reduced = useReducedMotion();

  return (
    // Fills whatever height the briefing leaves beside it: the wrapper is the flex
    // child that grows, the square svg takes that height and derives its own width.
    <span className="flex min-h-0 flex-1 items-center justify-end text-moss">
      <svg viewBox="0 0 24 24" className="h-full w-auto" role="img" aria-label={label}>
        <motion.circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          stroke="var(--color-moss)"
          strokeOpacity={0.35}
          strokeWidth={1.25}
          initial={reduced ? false : { opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ transformOrigin: "center" }}
          transition={reduced ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
        />
        <motion.path
          d="M6.5 12.4 L10.4 16.2 L17.5 8.2"
          fill="none"
          stroke="var(--color-moss)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.45, ease: "easeOut", delay: 0.15 }}
        />
      </svg>
    </span>
  );
}
