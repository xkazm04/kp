"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { clampPercent, formatCzk } from "@/app/_lib/format";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

interface SalaryGaugeProps {
  minimum: number;
  maximum: number;
  midpoint: number;
  confidence: string;
  // The +30% growth target, rounded once by the caller. Passed in so the dashed marker and
  // the aria-label use the SAME figure the card text shows, instead of a third unrounded one.
  target?: number;
}

const CONFIDENCE_OPACITY: Record<string, number> = {
  low: 0.6,
  medium: 0.8,
  high: 1
};

export function SalaryGauge({ minimum, maximum, midpoint, confidence, target: targetProp }: SalaryGaugeProps) {
  const target = targetProp ?? midpoint * 1.3;
  const gaugeMin = minimum * 0.9;
  const gaugeMax = Math.max(maximum, target) * 1.08;
  const range = gaugeMax - gaugeMin;
  // A zero/flat/inverted model estimate makes range <= 0, which would turn
  // every percent into NaN (and clamping can't rescue NaN). Center the markers
  // so the bar degrades gracefully instead of collapsing with React warnings.
  const degenerate = !(range > 0);

  const pct = (value: number) => (degenerate ? 50 : clampPercent(((value - gaugeMin) / range) * 100));
  const minPct = pct(minimum);
  const maxPct = pct(maximum);
  const midPct = pct(midpoint);
  const targetPct = pct(target);

  const fillOpacity = CONFIDENCE_OPACITY[confidence.toLowerCase()] ?? 1;

  const reducedMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number } | null>(null);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (degenerate) return;
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const ratio = rect.width === 0 ? 0 : x / rect.width;
    setHover({ x, value: gaugeMin + ratio * range });
  };

  return (
    <div className="relative pt-7 pb-6">
      {hover ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-sm font-medium text-paper shadow nums"
          style={{ left: hover.x, top: 0 }}
        >
          {formatCzk(hover.value)}
        </div>
      ) : null}

      <div
        ref={barRef}
        role="img"
        aria-label={`Salary range ${formatCzk(minimum)} to ${formatCzk(maximum)} CZK, midpoint ${formatCzk(midpoint)}, +30% target ${formatCzk(target)}`}
        className={`relative h-3 w-full rounded-full bg-stone-200 ${degenerate ? "cursor-default" : "cursor-crosshair"}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <motion.div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${minPct}%`,
            background: "linear-gradient(to right, var(--color-coral), var(--color-moss))",
            opacity: fillOpacity
          }}
          initial={reducedMotion ? false : { width: 0 }}
          animate={{ width: `${maxPct - minPct}%` }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.9, ease: "easeOut" }}
        />

        <div
          className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-ink"
          style={{ left: `calc(${midPct}% - 1px)` }}
          aria-hidden
        />

        <div
          className="absolute top-1/2 h-6 -translate-y-1/2 border-l-2 border-dashed border-coral"
          style={{ left: `${targetPct}%` }}
          aria-hidden
        />
      </div>

      <div className="relative mt-1 h-4 text-sm font-medium uppercase tracking-wide">
        <span
          className="absolute -translate-x-1/2 text-ink"
          style={{ left: `${midPct}%` }}
        >
          Mid
        </span>
        <span
          className="absolute -translate-x-1/2 text-coral"
          style={{ left: `${targetPct}%` }}
        >
          +30%
        </span>
      </div>
    </div>
  );
}
