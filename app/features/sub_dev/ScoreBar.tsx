"use client";

import { useEffect, useState } from "react";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";

// A single capability bar that grows from 0 to its value on mount, so the row
// reads as a live measurement rather than a static printout. Rows stagger by
// ~60ms; prefers-reduced-motion users skip the transition and see the final
// width immediately (motion-reduce honors globals.css's reduced-motion intent).
// `label` is a pre-cased human label (from the self-describing rubric); `weight`
// (0..1) renders a muted % so the reviewer can see how each capability is weighted,
// and `title` carries the rubric description as a hover tooltip.
export function ScoreBar({ label, value, index, weight, title }: { label: string; value: number; index: number; weight?: number; title?: string }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const pct = typeof weight === "number" && weight > 0 ? Math.round(weight * 100) : null;
  return (
    <div className="flex items-center gap-2" title={title || undefined}>
      <span className="flex w-28 shrink-0 items-baseline gap-1 text-micro text-steel">
        <span className="truncate">{label}</span>
        {pct != null ? <span className="shrink-0 text-stone-400" aria-hidden>{pct}%</span> : null}
      </span>
      <span
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} score ${value} of 100${pct != null ? `, weighted ${pct}%` : ""}`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200"
      >
        <span
          className="block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{
            // Fill resolves through the canonical score scale (scoreTone owns the
            // 75/50 cutoffs) so a capability bar shares the badge/dial hue for the
            // same tier — the bar already styles via inline width, so the raw
            // --color-score-* var slots in beside it.
            backgroundColor: scoreToneColor(scoreTone(value)),
            width: filled ? `${value}%` : "0%",
            transitionDelay: `${index * 60}ms`,
          }}
        />
      </span>
      <span className="w-6 shrink-0 text-right text-micro text-ink">{value}</span>
    </div>
  );
}
