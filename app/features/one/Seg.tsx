"use client";

// /one's ONE quiet control language (round 3): a sunken segmented group whose active
// segment carries a raised pill that SLIDES between segments (framer shared layout,
// `layoutId` per group — the repo's segmented-control motion standard, AnalyzeWorkspace.tsx).
// The header's stats, the layout switcher and the side's view tabs all use it, so the
// screen has one control shape instead of an underline, a pill row and an outlined button.
//
// A group may have NO active segment (the header's stats before a stat's question is in
// view): then no pill is drawn.
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useOneMotion } from "./motion";

/** The sunken track. */
export const SEG_GROUP =
  "inline-flex min-w-0 items-center gap-0.5 rounded-md border border-stone-200 bg-stone-100 p-0.5 dark:rounded-lg dark:border-2";

/** One segment: the label sits above the sliding pill. Height comes from the group (h-8). */
export const SEG_BTN =
  "focus-ring relative flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-micro transition-colors dark:rounded-md";

/** The raised pill under the active segment. */
export const SEG_PILL = "absolute inset-0 z-0 rounded-sm border border-stone-200 bg-white shadow-panel dark:rounded-md dark:border-stone-300";

export function Seg({
  group,
  active,
  className = "",
  children,
  ...rest
}: { group: string; active: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const m = useOneMotion();
  return (
    <button type="button" className={`${SEG_BTN} ${active ? "text-ink" : "text-steel hover:text-ink"} ${className}`} data-active={active || undefined} {...rest}>
      {active ? <motion.span layoutId={`one-seg-${group}`} className={SEG_PILL} transition={m.tabIndicator} aria-hidden /> : null}
      <span className="relative z-10 flex min-w-0 items-center gap-1.5">{children}</span>
    </button>
  );
}

/** A figure that tweens to a new value (countTick); the still form jumps. */
export function CountTick({ value, format }: { value: number; format: (n: number) => string }) {
  const { countTick } = useOneMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => {
    if (countTick === 0) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: countTick, ease: "easeOut" });
    return () => c.stop();
  }, [value, countTick, mv]);
  return <motion.span>{text}</motion.span>;
}
