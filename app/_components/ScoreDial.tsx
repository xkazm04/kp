"use client";

import { useEffect, useState, type CSSProperties } from "react";

type ScoreDialProps = {
  score: number;
};

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 80;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_SPAN = 240;
const START_ANGLE = -120;
const TOTAL_MS = 700;
const GAP_DEG = 4;

type Band = {
  from: number;
  to: number;
  label: string;
};

const BANDS: Band[] = [
  { from: 0, to: 40, label: "Early" },
  { from: 40, to: 55, label: "Developing" },
  { from: 55, to: 70, label: "Solid" },
  { from: 70, to: 85, label: "Strong" },
  { from: 85, to: 100, label: "Excellent" }
];

function bandIndex(score: number): number {
  if (score <= 40) return 0;
  if (score <= 55) return 1;
  if (score <= 70) return 2;
  if (score <= 85) return 3;
  return 4;
}

// Score-meaningful band colors (poor -> coral, fair -> amber, good -> moss),
// consistent with the Fit-matrix scale, instead of a flat coral for every band.
function bandColor(i: number): string {
  if (i <= 0) return "var(--color-coral)";
  if (i <= 2) return "var(--color-dial-amber)";
  return "var(--color-moss)";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useCountUp(target: number, durationMs: number) {
  const [reducedMotion] = useState(() => prefersReducedMotion());
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reducedMotion]);

  return reducedMotion ? target : animatedValue;
}

export function ScoreDial({ score }: ScoreDialProps) {
  const clamped = Math.max(0, Math.min(score, 100));
  const displayed = useCountUp(clamped, TOTAL_MS);
  const activeIndex = bandIndex(clamped);
  const activeBand = BANDS[activeIndex];

  return (
    <div
      className="relative grid aspect-square w-44 place-items-center rounded-full bg-white shadow-panel"
      role="img"
      aria-label={`Score ${clamped} out of 100, ${activeBand.label}`}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="aspect-square w-full"
        aria-hidden="true"
      >
        {BANDS.map((band, i) => {
          const segSweep = ((band.to - band.from) / 100) * ARC_SPAN - GAP_DEG;
          const segStart = START_ANGLE + (band.from / 100) * ARC_SPAN + GAP_DEG / 2;
          const arcLen = (segSweep / 360) * CIRCUMFERENCE;
          const rotation = segStart - 90;
          const isFilled = i <= activeIndex;
          const isCurrent = i === activeIndex;
          const segStyle: CSSProperties = {
            transformOrigin: `${CENTER}px ${CENTER}px`,
            transform: `rotate(${rotation}deg)`,
            ["--seg-len" as string]: arcLen.toFixed(2),
            animation: `score-band-fill 360ms ease-out ${i * 70}ms both`,
            opacity: isFilled ? (isCurrent ? 1 : 0.55) : 1,
          };
          return (
            <circle
              key={band.label}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={isFilled ? bandColor(i) : "#e7e5e4"}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${arcLen.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
              style={segStyle}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl font-semibold leading-none tabular-nums text-ink">
          {displayed}
        </div>
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
          {activeBand.label}
        </div>
      </div>
    </div>
  );
}
