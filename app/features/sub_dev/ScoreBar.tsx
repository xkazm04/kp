"use client";

import { useEffect, useState } from "react";
import { scoreColor } from "./DevHelpers";

// A single capability bar that grows from 0 to its value on mount, so the row
// reads as a live measurement rather than a static printout. Rows stagger by
// ~60ms; prefers-reduced-motion users skip the transition and see the final
// width immediately (motion-reduce honors globals.css's reduced-motion intent).
export function ScoreBar({ label, value, index }: { label: string; value: number; index: number }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-micro capitalize text-steel">{label}</span>
      <span
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} score ${value} of 100`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200"
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${scoreColor(value)}`}
          style={{ width: filled ? `${value}%` : "0%", transitionDelay: `${index * 60}ms` }}
        />
      </span>
      <span className="w-6 shrink-0 text-right text-micro text-ink">{value}</span>
    </div>
  );
}
