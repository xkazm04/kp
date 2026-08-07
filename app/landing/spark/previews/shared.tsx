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

/** Pop in with a spring — the default entrance for a line of copy or a chip. */
export const pop = (delay: number) => ({
  initial: { opacity: 0, scale: 0.6, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0 },
  transition: { delay, type: "spring" as const, bounce: 0.45 }
});

/** Slam down oversized and settle askew — for anything that reads as a stamp. */
export const stamp = (delay: number) => ({
  initial: { opacity: 0, scale: 2.2, rotate: 10 },
  animate: { opacity: 1, scale: 1, rotate: -6 },
  transition: { delay, type: "spring" as const, bounce: 0.45 }
});

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
  return (
    <motion.p
      {...pop(delay)}
      className={`mt-4 text-[17px] font-bold ${tilt ? "-rotate-1" : ""}`}
      style={{ color }}
    >
      {children}
    </motion.p>
  );
}

/** The uppercase pill that stamps itself onto a mockup header. */
export function StampChip({ children, background, delay = 0.2 }: { children: ReactNode; background: string; delay?: number }) {
  return (
    <motion.span
      {...stamp(delay)}
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ delay, type: "spring", bounce: 0.4 }}
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
  return (
    <motion.div
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{ delay, duration: 0.3 }}
      className="mx-auto mt-3 h-7 w-1.5 origin-top rounded-full"
      style={{ background: INK }}
      aria-hidden
    />
  );
}
