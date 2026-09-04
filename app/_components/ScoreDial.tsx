"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { clampPercent, scoreTone, scoreToneColor } from "@/app/_lib/format";
import { VERDICT_BANDS, scoreBandIndex } from "./scoreDial.logic";

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

// Score-meaningful band colors (poor -> weak, fair -> mid, good -> strong),
// drawn from the shared --color-score-* scale (via scoreToneColor) so the dial's
// hues are guaranteed to match the badge and factor bars, not just approximate
// them — re-toning the scale recolors the arc with no edit here.
function bandColor(i: number): string {
  if (i <= 0) return scoreToneColor("weak");
  if (i <= 2) return scoreToneColor("mid");
  return scoreToneColor("strong");
}

function useCountUp(target: number, durationMs: number) {
  const reducedMotion = useReducedMotion();
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
  // bug-ui-scan-2026-07-09 (analysis-result-panels #3): the band word and the
  // aria-label were hardcoded English on a bilingual report — localize both.
  const t = useTranslations("report");
  // clampPercent deliberately passes NaN through (callers guard separately). A
  // non-finite score (a garbled pipeline total, a parseFloat of an absent field, a
  // divide-by-zero average) otherwise fell through bandIndex to "Excellent" AND
  // rendered the literal "NaN" — actively misleading on the hero verdict, upgrading a
  // junk score to the top band. Treat non-finite as 0 (the "Early"/null floor,
  // consistent with scoreTone's null tier) so a bad payload reads as a floor score.
  const clamped = Number.isFinite(score) ? clampPercent(score) : 0;
  const displayed = useCountUp(clamped, TOTAL_MS);
  const activeIndex = scoreBandIndex(clamped);
  const activeBand = VERDICT_BANDS[activeIndex];
  const bandLabel = t(activeBand.key);
  // Color the central number + label from the app-wide scoreTone (cutoffs 50/75) so the
  // most prominent score reads the SAME tone as ScoreBadge / Meter / FactorChart for a given
  // number. The arc keeps its five aesthetic bands (bandColor); only the readout was crossing
  // tones (e.g. 45 read amber on the dial but coral on the badge — the dial's 40/70 split
  // disagreed with 50/75). Now they agree.
  const readoutColor = scoreToneColor(scoreTone(clamped));

  return (
    <div
      className="relative grid aspect-square w-44 place-items-center rounded-full bg-white shadow-panel"
      role="img"
      aria-label={t("scoreAria", { score: clamped, band: bandLabel })}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="aspect-square w-full"
        aria-hidden="true"
      >
        {VERDICT_BANDS.map((band, i) => {
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
              key={band.key}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={isFilled ? bandColor(i) : "var(--color-stone-200)"}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${arcLen.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
              style={segStyle}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        {/* Spark Dark: the readout speaks in the display face (font-serif
            resolves to Bricolage there) — the dial becomes the landing's
            score stamp writ large. */}
        <div
          className="text-5xl font-semibold leading-none nums dark:font-serif dark:font-bold"
          style={{ color: readoutColor }}
        >
          {displayed}
        </div>
        <div
          className="mt-2 text-sm font-semibold uppercase tracking-[0.18em]"
          style={{ color: readoutColor }}
        >
          {bandLabel}
        </div>
      </div>
    </div>
  );
}
