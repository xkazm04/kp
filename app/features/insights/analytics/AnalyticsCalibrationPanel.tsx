"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
// `import type` only — calibration.ts is pure (no server imports), erased at compile.
import type { CalibrationResult, CalibrationCohort, ThresholdRecommendation } from "@/app/_lib/calibration";
import { AnalyticsCalibrationHeader } from "./AnalyticsCalibrationHeader";
import { ReliabilityDiagram } from "./AnalyticsReliabilityDiagram";
import { DriftStrip } from "./AnalyticsDriftStrip";
import { ScoreBands } from "./AnalyticsScoreBands";
import { ThresholdSuggestion } from "./AnalyticsThresholdSuggestion";
import { ThresholdHistoryStrip } from "./AnalyticsThresholdHistoryStrip";
import { AnalyticsFamilyFloorChips } from "./AnalyticsFamilyFloorChips";

// Calibration Engine (moonshot A/C) — the "How accurate are we?" panel. Plots a
// reliability diagram (predicted probability vs. measured advance rate) against
// the perfect-calibration diagonal, plus the Brier score. The whole point is
// HONESTY: below the minimum-outcomes gate it shows an uncalibrated state, never
// a misleading curve drawn on a handful of points.
//
// Three loop-closing additions: drift cohorts (a good year can hide a bad
// quarter), clickable score bands (open the candidates behind any dot), and a
// deterministic threshold suggestion (calibration that recommends, not just
// reports) — all still honesty-gated, all in both themes. Split into
// AnalyticsReliabilityDiagram / AnalyticsDriftStrip / AnalyticsScoreBands /
// AnalyticsThresholdSuggestion / AnalyticsThresholdHistoryStrip so this file
// (the orchestrating panel) stays under the 200-line cap.

type CalibrationPayload = CalibrationResult & {
  families?: string[];
  measures?: string;
  cohorts?: CalibrationCohort[];
  recommendation?: ThresholdRecommendation | null;
  currentThreshold?: number | null;
  familyFloors?: Record<string, number>; // family-floors: role_family → override value
};

export function CalibrationPanel() {
  const t = useTranslations("analytics.calibration");
  const search = useSearchParams();
  // Per-role-family reliability (the route's headline use case: "how accurate are you
  // for backend roles?") — was computed-capable (?roleFamily) but had no UI selector.
  const [family, setFamily] = useState("");
  // REC-02 — the curve names WHICH score it measures. Default: the pipeline
  // match score, i.e. the number screening auto-decisions actually act on
  // (see pipelineCalibrationPairs). The CV-analysis × disposition pairing —
  // a score that never gates pipeline decisions — stays available, labeled.
  const [source, setSource] = useState<"pipeline" | "analysis">("pipeline");
  const url = `/api/analytics/calibration?source=${source}${family ? `&roleFamily=${encodeURIComponent(family)}` : ""}`;
  const { data, error, reload } = useJsonFetch<CalibrationPayload>(url);
  const families = data?.families ?? [];
  // threshold-story — bumped on every apply so the sealed floor-over-time strip
  // (its own fetch) re-reads the freshly-sealed record alongside the curve reload.
  const [applyNonce, setApplyNonce] = useState(0);

  // Direction 2 — reuse the board deep-link idiom (buildUrl + cleared tab-scoped
  // params) the funnel and by-role table use: open the board filtered to this
  // candidate via the free-text ?q filter.
  const boardHref = (q: string) => buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q }, search.toString());

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <AnalyticsCalibrationHeader
        source={source}
        setSource={setSource}
        family={family}
        setFamily={setFamily}
        families={families}
      />

      {error ? (
        // bug-ui-scan-2026-07-09 (analytics-calibration-dashboards #4): a transient fetch
        // failure is recoverable — offer the same retry the sibling panels use, and
        // announce it assertively (role="alert", not the polite role="status").
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-stone-500" role="alert">
          <span>{t("error")}</span>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {t("retry")}
          </button>
        </div>
      ) : !data ? (
        // Loading choreography (docs/LOADING_CHOREOGRAPHY.md, tier 2): a quiet
        // reserved box — invisible for 150ms — instead of a bare "loading" line.
        <div className="reveal-quiet mt-4 min-h-[15rem]" aria-hidden />
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
        <>
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
                <li className="flex items-center gap-2">
                  {/* Tokenized legend swatches — resolve through the same theme vars
                      as the SVG, so the legend can't drift from the plot. */}
                  <span className="inline-block h-0 w-4 shrink-0 border-t-2 border-dashed border-steel align-middle" />
                  {t("perfect")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-ink align-middle" />
                  {t("dotLegend")}
                </li>
                <li className="text-stone-400">{t("samples", { n: data.n })}</li>
              </ul>
            </div>
          </div>

          {/* Direction 3 + family-floors — the recommendation (pipeline source only;
              null → no UI). Appliable in BOTH scopes now: all-families moves the global
              floor, a family filter writes that family's bounded override. The route
              re-derives against the shown scope, so the 409 staleness guard is honest
              either way. */}
          {data.recommendation ? (
            <ThresholdSuggestion
              rec={data.recommendation}
              roleFamily={family}
              onApplied={() => {
                reload();
                setApplyNonce((n) => n + 1);
              }}
            />
          ) : null}

          {/* family-floors — which families carry their own floor. Pipeline source only. */}
          {source === "pipeline" && data.familyFloors && Object.keys(data.familyFloors).length > 0 ? (
            <AnalyticsFamilyFloorChips
              familyFloors={data.familyFloors}
              currentThreshold={data.currentThreshold ?? null}
              family={family}
              setFamily={setFamily}
            />
          ) : null}

          {/* threshold-story — the sealed floor-over-time strip + since-last-change
              effect. Pipeline source only (the floor acts on the pipeline match
              score); renders nothing until an apply has been sealed. */}
          {source === "pipeline" ? <ThresholdHistoryStrip nonce={applyNonce} family={family} /> : null}

          {/* Direction 1 — drift cohorts. */}
          {data.cohorts && data.cohorts.length > 0 ? <DriftStrip cohorts={data.cohorts} /> : null}

          {/* Direction 2 — clickable score bands. Keyed on source|family so a
              source switch remounts it fresh (no stale open band). */}
          <ScoreBands key={`${source}|${family}`} result={data} source={source} roleFamily={family} boardHref={boardHref} />
        </>
      )}
    </section>
  );
}
