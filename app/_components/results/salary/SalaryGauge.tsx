"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { formatCzk } from "@/app/_lib/format";

interface SalaryGaugeProps {
  minimum: number;
  maximum: number;
  midpoint: number;
  confidence: string;
}

const CONFIDENCE_OPACITY: Record<string, number> = {
  low: 0.6,
  medium: 0.8,
  high: 1
};

export function SalaryGauge({ minimum, maximum, midpoint, confidence }: SalaryGaugeProps) {
  const target = midpoint * 1.3;
  const gaugeMin = minimum * 0.9;
  const gaugeMax = Math.max(maximum, target) * 1.08;
  const range = gaugeMax - gaugeMin;

  const pct = (value: number) => ((value - gaugeMin) / range) * 100;
  const minPct = pct(minimum);
  const maxPct = pct(maximum);
  const midPct = pct(midpoint);
  const targetPct = pct(target);

  const fillOpacity = CONFIDENCE_OPACITY[confidence.toLowerCase()] ?? 1;

  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number } | null>(null);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
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
          className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-sm font-medium text-paper shadow"
          style={{ left: hover.x, top: 0 }}
        >
          {formatCzk(hover.value)}
        </div>
      ) : null}

      <div
        ref={barRef}
        role="img"
        aria-label={`Salary range ${formatCzk(minimum)} to ${formatCzk(maximum)} CZK, midpoint ${formatCzk(midpoint)}, +30% target ${formatCzk(target)}`}
        className="relative h-3 w-full cursor-crosshair rounded-full bg-stone-200"
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
          initial={{ width: 0 }}
          animate={{ width: `${maxPct - minPct}%` }}
          transition={{ duration: 0.9, ease: "easeOut" }}
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
