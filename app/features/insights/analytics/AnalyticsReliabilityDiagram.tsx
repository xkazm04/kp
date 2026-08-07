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

export function ReliabilityDiagram({ result, labels }: { result: CalibrationResult; labels: { x: string; y: string; perfect: string } }) {
  const t = useTranslations("analytics.calibration");
  const filled = result.bins.filter((b) => b.count > 0);
  const maxCount = filled.reduce((m, b) => Math.max(m, b.count), 1);
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
