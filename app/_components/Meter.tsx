"use client";

import { useEffect, useState } from "react";
import { clampPercent, type ScoreTone } from "@/app/_lib/format";

// One animated progress meter for every bar in the app: grows from 0 to `value`%
// on mount so the row reads as a live measurement, exposes proper progressbar
// a11y, and honors prefers-reduced-motion (the width snaps instead of animating).
// The fill resolves through the shared `--color-score-*` scale so a bar's hue
// always matches the badge/dial for the same tier; callers derive `tone` from
// scoreTone() (or pass a fixed tier for non-ranked bars like language share).
export function Meter({
  value,
  tone = "weak",
  className = "",
  trackClassName = "",
  "aria-label": ariaLabel,
}: {
  value: number;
  tone?: ScoreTone;
  className?: string;
  trackClassName?: string;
  "aria-label"?: string;
}) {
  const pct = clampPercent(Math.round(value));
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const toneClass =
    tone === "strong"
      ? "bg-score-strong"
      : tone === "mid"
        ? "bg-score-mid"
        : tone === "null"
          ? "bg-score-null"
          : "bg-score-weak";
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-stone-100 ${trackClassName} ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={`h-full rounded-full ${toneClass} transition-[width] duration-700 ease-out motion-reduce:transition-none`}
        style={{ width: `${filled ? pct : 0}%` }}
      />
    </div>
  );
}
