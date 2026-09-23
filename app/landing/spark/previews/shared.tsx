"use client";

/*
 * Shared vocabulary for the nine feature spotlights.
 *
 * Each preview is a small animated product mockup. They all share the same two
 * entrance choreographies and the same "row of cards" / "verdict chip" shapes,
 * so those live here once rather than being re-typed nine times — which is what
 * the single 615-line FeaturePreviews.tsx used to do.
 *
 * Fixed Spark art direction (literal hexes, the docs/design/README.md
 * exemption). Copy resolves through the `landing.previews.*` namespace; see
 * ./index.ts for why these mockups are translated at all.
 */
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { INK } from "../tokens";
import { useStillMotion } from "../useStillMotion";
import { entrance, pop, reveal, stamp } from "../motion-presets";

/*
 * Reduced motion, for entrances rather than for loops.
 *
 * AboutCurve.test.ts used to gate `repeat: Infinity` only, so every preview's
 * slam-and-stamp choreography — `scale: 2.2` dropping onto the page, cards
 * rotating in from ±10° — played in full for a reader who had asked the OS for
 * less. An entrance is not exempt just because it ends.
 *
 * The gate (the TRANSITION, never `initial`) and the `entrance`/`pop`/`stamp`
 * choreographies live in ../motion-presets.ts, shared with the /about step
 * illustrations and tested there; they are re-exported so the nine previews
 * import them from here unchanged. These mockups mount inside
 * FeatureSpotlight's dialog, i.e. client-side after a click, so
 * `useStillMotion` already knows the real preference at mount and a still
 * reader sees no motion at all.
 */
export { entrance, pop, stamp };

/** The white sticker card every preview list-row is built from. */
export const ROW =
  "rounded-xl border-[3px] border-[#17202a] bg-white shadow-[3px_3px_0_#17202a]";

/** A closing hand-written aside under a mockup. */
export function PreviewNote({
  children,
  delay = 1,
  color,
  tilt = false
}: {
  children: ReactNode;
  delay?: number;
  color: string;
  tilt?: boolean;
}) {
  const reduce = useStillMotion();
  return (
    <motion.p
      {...pop(delay, reduce)}
      className={`mt-4 text-[17px] font-bold ${tilt ? "-rotate-1" : ""}`}
      style={{ color }}
    >
      {children}
    </motion.p>
  );
}

/** The uppercase pill that stamps itself onto a mockup header. */
export function StampChip({ children, background, delay = 0.2 }: { children: ReactNode; background: string; delay?: number }) {
  const reduce = useStillMotion();
  return (
    <motion.span
      {...stamp(delay, reduce)}
      className="rounded-full border-[3px] border-[#17202a] px-3 py-1 text-sm font-extrabold uppercase tracking-wide text-white shadow-[2px_2px_0_#17202a]"
      style={{ background }}
    >
      {children}
    </motion.span>
  );
}

/** The full-width confirmation bar several previews end on. */
export function ConfirmBar({
  children,
  background,
  delay = 1.1,
  icon
}: {
  children: ReactNode;
  background: string;
  delay?: number;
  icon: ReactNode;
}) {
  const reduce = useStillMotion();
  return (
    <motion.div
      {...reveal("mount", reduce, { opacity: 1, y: 0, rotate: 0 }, { delay, type: "spring", bounce: 0.4 }, { opacity: 0, y: 16, rotate: -2 })}
      className="mt-4 flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] px-4 py-2.5 text-sm font-bold text-white shadow-[3px_3px_0_#17202a]"
      style={{ background }}
    >
      {icon}
      {children}
    </motion.div>
  );
}

/** A vertical connector, purely decorative. */
export function Stem({ delay = 0.75 }: { delay?: number }) {
  const reduce = useStillMotion();
  return (
    <motion.div
      {...reveal("mount", reduce, { opacity: 1, scaleY: 1 }, { delay, duration: 0.3 }, { opacity: 0, scaleY: 0 })}
      className="mx-auto mt-3 h-7 w-1.5 origin-top rounded-full"
      style={{ background: INK }}
      aria-hidden
    />
  );
}
