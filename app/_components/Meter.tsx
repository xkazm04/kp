"use client";

import { useEffect, useState } from "react";

// One animated progress meter for every bar in the app: grows from 0 to `value`%
// on mount so the row reads as a live measurement, exposes proper progressbar
// a11y, and honors prefers-reduced-motion (the width snaps instead of animating).
export function Meter({
  value,
  tone = "coral",
  className = "",
  trackClassName = "",
  "aria-label": ariaLabel,
}: {
  value: number;
  tone?: "coral" | "moss" | "amber";
  className?: string;
  trackClassName?: string;
  "aria-label"?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const toneClass = tone === "moss" ? "bg-moss" : tone === "amber" ? "bg-dial-amber" : "bg-coral";
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
