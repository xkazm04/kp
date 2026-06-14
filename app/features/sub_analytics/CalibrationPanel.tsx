"use client";

import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
// `import type` only — calibration.ts is pure (no server imports), erased at compile.
import type { CalibrationResult } from "@/app/_lib/calibration";

// Calibration Engine (moonshot A/C) — the "How accurate are we?" panel. Plots a
// reliability diagram (predicted probability vs. measured advance rate) against
// the perfect-calibration diagonal, plus the Brier score. The whole point is
// HONESTY: below the minimum-outcomes gate it shows an uncalibrated state, never
// a misleading curve drawn on a handful of points.

const SIZE = 240;
const PAD = 30;
const PLOT = SIZE - PAD * 2;

function px(prob: number): number {
  return PAD + Math.max(0, Math.min(1, prob)) * PLOT;
}
function py(prob: number): number {
  return PAD + (1 - Math.max(0, Math.min(1, prob))) * PLOT;
}

function ReliabilityDiagram({ result, labels }: { result: CalibrationResult; labels: { x: string; y: string; perfect: string } }) {
  const filled = result.bins.filter((b) => b.count > 0);
  const maxCount = filled.reduce((m, b) => Math.max(m, b.count), 1);
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-60 w-60 text-ink"
      role="img"
      aria-label={`${labels.x} / ${labels.y}`}
    >
      {/* plot frame */}
      <rect x={PAD} y={PAD} width={PLOT} height={PLOT} fill="none" stroke="#e7e5e4" strokeWidth={1} />
      {/* 0 / .5 / 1 gridlines */}
      {[0.5].map((g) => (
        <g key={g}>
          <line x1={px(g)} y1={PAD} x2={px(g)} y2={PAD + PLOT} stroke="#f5f5f4" strokeWidth={1} />
          <line x1={PAD} y1={py(g)} x2={PAD + PLOT} y2={py(g)} stroke="#f5f5f4" strokeWidth={1} />
        </g>
      ))}
      {/* perfect-calibration diagonal */}
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="#a8a29e" strokeWidth={1.5} strokeDasharray="4 4" />
      {/* measured points: one dot per non-empty bin, radius ~ sample count */}
      {filled.map((b, i) => {
        const r = 3 + 6 * Math.sqrt(b.count / maxCount);
        return (
          <circle
            key={i}
            cx={px(b.predicted)}
            cy={py(b.observed)}
            r={r}
            fill="#1c1917"
            fillOpacity={0.75}
            stroke="#ffffff"
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
  );
}

export function CalibrationPanel() {
  const t = useTranslations("analytics.calibration");
  const { data, error } = useJsonFetch<CalibrationResult>("/api/analytics/calibration");

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      <p className="mt-1 max-w-prose text-sm text-stone-500">{t("blurb")}</p>

      {error ? (
        <p className="mt-4 text-sm text-stone-500" role="status">
          {t("error")}
        </p>
      ) : !data ? (
        <p className="mt-4 text-sm text-stone-400" role="status">
          {t("loading")}
        </p>
      ) : !data.calibrated ? (
        // Honest uncalibrated state — the moonshot's whole point. Never draw a
        // curve on too few outcomes; say exactly how many more are needed.
        <div className="mt-4 rounded-md border border-dashed border-stone-300 bg-stone-50 p-4">
          <p className="text-sm font-medium text-ink">{t("uncalibratedTitle")}</p>
          <p className="mt-1 text-sm text-stone-500">
            {t("uncalibratedBody", { n: data.n, min: data.minOutcomes })}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
          <ReliabilityDiagram
            result={data}
            labels={{ x: t("axisPredicted"), y: t("axisObserved"), perfect: t("perfect") }}
          />
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-3xl font-semibold text-ink">{data.brier!.toFixed(3)}</div>
              <div className="text-stone-500">{t("brier")}</div>
              <div className="mt-1 text-xs text-stone-400">{t("brierHint")}</div>
            </div>
            <ul className="space-y-1 text-stone-600">
              <li>
                <span className="inline-block h-2 w-4 align-middle" style={{ borderTop: "1.5px dashed #a8a29e" }} />{" "}
                {t("perfect")}
              </li>
              <li>
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#1c1917" }} />
                {t("dotLegend")}
              </li>
              <li className="text-stone-400">{t("samples", { n: data.n })}</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
