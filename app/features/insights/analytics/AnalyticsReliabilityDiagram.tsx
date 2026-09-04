"use client";

import { useTranslations } from "next-intl";
import type { CalibrationResult } from "@/app/_lib/calibration";

// Calibration Engine (moonshot A/C) — the reliability diagram SVG (predicted
// probability vs. measured advance rate) against the perfect-calibration
// diagonal. Split out of CalibrationPanel.tsx (now AnalyticsCalibrationPanel.tsx)
// to keep that file under the 200-line cap.

const SIZE = 240;
const PAD = 30;
const PLOT = SIZE - PAD * 2;

function px(prob: number): number {
  return PAD + Math.max(0, Math.min(1, prob)) * PLOT;
}
function py(prob: number): number {
  return PAD + (1 - Math.max(0, Math.min(1, prob))) * PLOT;
}

export function ReliabilityDiagram({
  result,
  labels,
  threshold,
  thresholdEnforced,
  baseRate,
}: {
  result: CalibrationResult;
  labels: { x: string; y: string; perfect: string };
  /** UAT KAT-ANA-1 — the live auto-reject floor (0..100), drawn as a vertical
   *  marker on the arms that have one. A reliability curve that jumps from
   *  observed 0.00 to 1.00 EXACTLY at the floor is not a well-calibrated score,
   *  it is the signature of a label the score produced; the reader can only see
   *  that if the floor is on the plot. */
  threshold?: number | null;
  /** Whether that floor is ACTUALLY enforced — `screening.autoRejectEnabled`, which
   *  the route ships beside the number and whose shipped default is FALSE. The
   *  marker's whole job is to show where a score-caused step would sit; with the
   *  wave off there is no step, and drawing the line anyway narrates a gate that
   *  rejects nobody. `null`/undefined = the arm carries no screening rule at all
   *  (the analysis producer), which is not the same as "off" and is handled by the
   *  caller passing no threshold either. */
  thresholdEnforced?: boolean | null;
  /** Cohort base rate (0..1) — the constant predictor the Brier score is really
   *  competing with, drawn as the horizontal reference the diagonal never was. */
  baseRate?: number | null;
}) {
  const t = useTranslations("analytics.calibration");
  const filled = result.bins.filter((b) => b.count > 0);
  const maxCount = filled.reduce((m, b) => Math.max(m, b.count), 1);
  // The floor as a NUMBER (0..100) — announced either way, because a recorded floor
  // is a fact about the policy — and separately the plot coordinate, which exists
  // only when the floor is enforced.
  const floorValue = typeof threshold === "number" && threshold > 0 && threshold < 100 ? threshold : null;
  const enforced = thresholdEnforced !== false;
  const floorProb = floorValue != null && enforced ? floorValue / 100 : null;
  const base = typeof baseRate === "number" && baseRate >= 0 && baseRate <= 1 ? baseRate : null;
  return (
    <>
      {/* The SVG is a pure visual encoding (the dots ARE the signal but have no text
          equivalent) — mark it decorative and expose the bins as a visually-hidden list
          so the calibration is actually readable by screen readers (WCAG 1.1.1). */}
      <ul className="sr-only">
        {filled.map((b, i) => (
          <li key={i}>
            {t("srBin", {
              x: labels.x,
              predicted: b.predicted.toFixed(2),
              y: labels.y,
              observed: b.observed.toFixed(2),
              count: b.count,
            })}
          </li>
        ))}
        {/* Announced on BOTH branches, from the raw floor rather than the plot
            coordinate: a floor that is recorded but not enforced is still a fact
            about the policy, and its absence from the plot is the thing a reader
            who cannot see the plot most needs told. */}
        {floorValue != null ? (
          <li>{enforced ? t("srThreshold", { threshold: floorValue }) : t("srThresholdOff", { threshold: floorValue })}</li>
        ) : null}
        {base != null ? <li>{t("srBaseRate", { pct: Math.round(base * 100) })}</li> : null}
      </ul>
      {/* Fully tokenized: every stroke/fill resolves through a design-system token
          that remaps under [data-theme="dark"] — legible in Studio Light AND Spark
          Dark (the old hardcoded stone/ink/#fff hex went near-invisible on dark). */}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-60 w-60 text-ink" aria-hidden="true">
      {/* plot frame */}
      <rect x={PAD} y={PAD} width={PLOT} height={PLOT} fill="none" className="stroke-stone-300" strokeWidth={1} />
      {/* 0 / .5 / 1 gridlines */}
      {[0.5].map((g) => (
        <g key={g}>
          <line x1={px(g)} y1={PAD} x2={px(g)} y2={PAD + PLOT} className="stroke-stone-200" strokeWidth={1} />
          <line x1={PAD} y1={py(g)} x2={PAD + PLOT} y2={py(g)} className="stroke-stone-200" strokeWidth={1} />
        </g>
      ))}
      {/* perfect-calibration diagonal */}
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="stroke-steel" strokeWidth={1.5} strokeDasharray="4 4" />
      {/* the constant predictor: "always say the cohort base rate" */}
      {base != null ? (
        <line x1={PAD} y1={py(base)} x2={PAD + PLOT} y2={py(base)} className="stroke-moss" strokeWidth={1.5} strokeDasharray="2 3" />
      ) : null}
      {/* the live auto-reject floor — where a score-caused step would sit */}
      {floorProb != null ? (
        <line x1={px(floorProb)} y1={PAD} x2={px(floorProb)} y2={PAD + PLOT} className="stroke-coral" strokeWidth={1.5} strokeDasharray="3 3" />
      ) : null}
      {/* measured points: one dot per non-empty bin, radius ~ sample count */}
      {filled.map((b, i) => {
        const r = 3 + 6 * Math.sqrt(b.count / maxCount);
        return (
          <circle
            key={i}
            cx={px(b.predicted)}
            cy={py(b.observed)}
            r={r}
            className="fill-ink stroke-white"
            fillOpacity={0.75}
            strokeWidth={1}
          />
        );
      })}
      {/* axis ticks */}
      {[0, 0.5, 1].map((g) => (
        <text key={`xt${g}`} x={px(g)} y={SIZE - 8} textAnchor="middle" className="fill-stone-400" fontSize={9}>
          {g}
        </text>
      ))}
      {[0, 0.5, 1].map((g) => (
        <text key={`yt${g}`} x={10} y={py(g) + 3} textAnchor="start" className="fill-stone-400" fontSize={9}>
          {g}
        </text>
      ))}
      </svg>
    </>
  );
}
