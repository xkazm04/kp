"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
// `import type` only — calibration.ts is pure (no server imports), erased at compile.
import type {
  CalibrationResult,
  CalibrationCohort,
  CalibrationLeakage,
  CalibrationOutcomeAxis,
  CalibrationSource,
  ThresholdRecommendation,
} from "@/app/_lib/calibration";
import {
  AnalyticsCalibrationHeader,
  CalibrationAccrualNote,
  CalibrationLeakageNote,
  calibrationSkill,
} from "./AnalyticsCalibrationHeader";
import { ReliabilityDiagram } from "./AnalyticsReliabilityDiagram";
import { DriftStrip } from "./AnalyticsDriftStrip";
import { ScoreBands } from "./AnalyticsScoreBands";
import { ThresholdSuggestion, ThresholdSuggestionAbsent } from "./AnalyticsThresholdSuggestion";
import { ThresholdHistoryStrip } from "./AnalyticsThresholdHistoryStrip";
import { AnalyticsFamilyFloorChips } from "./AnalyticsFamilyFloorChips";

import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { PANEL } from "@/app/_components/ui/recipes";
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
//
// UAT KAT-ANA-1 — three of the arm's honesty facts existed only in the payload:
// the `holdout` clean arm (no selector could reach it), the per-source `leakage`
// descriptor (no type declared it), and the fact that the Brier score is measured
// against the cohort BASE RATE, not a coin flip. All three are on screen now.
//
// UAT KAT-L1-003 — and the panel now carries the OUTCOME AXIS: „Advanced past
// screening" (the historical, interview/offer/hired-collapsing label) or „Reached
// Hired". A labelled, switchable choice, because a silent re-definition of success
// is the defect this closes, not the fix.

type CalibrationPayload = CalibrationResult & {
  families?: string[];
  measures?: string;
  /** The outcome axis the route ACTUALLY applied (it falls back for the analysis
   *  producer, which has no stages), so the labels below can never describe an
   *  axis the payload is not. */
  outcome?: CalibrationOutcomeAxis;
  cohorts?: CalibrationCohort[];
  recommendation?: ThresholdRecommendation | null;
  currentThreshold?: number | null;
  familyFloors?: Record<string, number>; // family-floors: role_family → override value
  // Where this source's outcome label comes from. Shipped on EVERY request since
  // the KAT-L1-001 fix; undeclared (and therefore unrenderable) until now.
  leakage?: CalibrationLeakage;
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
  // And `holdout`, the clean arm, which the route has always been able to serve.
  const [source, setSource] = useState<CalibrationSource>("pipeline");
  // KAT-L1-003 — WHAT COUNTS AS SUCCESS, the instrument's second axis. Defaults to
  // the historical label so nothing silently changes meaning for an existing reader.
  const [outcome, setOutcome] = useState<CalibrationOutcomeAxis>("advance");
  const url = `/api/analytics/calibration?source=${source}&outcome=${outcome}${family ? `&roleFamily=${encodeURIComponent(family)}` : ""}`;
  const { data, error, reload } = useJsonFetch<CalibrationPayload>(url);
  const families = data?.families ?? [];
  // threshold-story — bumped on every apply so the sealed floor-over-time strip
  // (its own fetch) re-reads the freshly-sealed record alongside the curve reload.
  const [applyNonce, setApplyNonce] = useState(0);

  // Direction 2 — reuse the board deep-link idiom (buildUrl + cleared tab-scoped
  // params) the funnel and by-role table use: open the board filtered to this
  // candidate via the free-text ?q filter.
  const boardHref = (q: string) => buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q }, search.toString());
  const useHoldout = () => {
    setSource("holdout");
    setFamily("");
  };

  // Label off the axis the payload REPORTS, never the one the control asks for:
  // between a switch and its response the two differ, and a hire curve captioned
  // „observed advance rate" for one frame is the same lie as never labelling it.
  const axis: CalibrationOutcomeAxis = data?.outcome ?? outcome;
  const { baseRate, baseBrier, skill } = calibrationSkill(data);
  // Signed on purpose: a skill score is read against zero, and "-33 %" versus
  // "+21 %" is the whole message. Built here rather than in ICU so the sign is
  // identical in all four locales.
  const skillDisplay = skill == null ? null : `${skill > 0 ? "+" : ""}${Math.round(skill * 100)}`;

  return (
    <section className={`${PANEL} p-5`}>
      <AnalyticsCalibrationHeader
        source={source}
        setSource={setSource}
        outcome={outcome}
        setOutcome={setOutcome}
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
        // Loading choreography (docs/design/loading-choreography.md, tier 2): a quiet
        // reserved box — invisible for 150ms — instead of a bare "loading" line.
        <LoadingGap className="mt-4 min-h-[15rem]" />
      ) : (
        <>
          {/* The disclosure rides ABOVE the number it qualifies, for the gated state
              as well as the drawn one — an uncalibrated circular arm is still circular. */}
          {data.leakage ? (
            <CalibrationLeakageNote
              source={source}
              leakage={data.leakage}
              onUseHoldout={source === "holdout" ? undefined : useHoldout}
            />
          ) : null}

          {!data.calibrated ? (
            // Honest uncalibrated state — the moonshot's whole point. Never draw a
            // curve on too few outcomes; say exactly how many more are needed, and
            // (KAT-ANA-1) when this arm becomes judgeable rather than only that it isn't.
            <div className="mt-4 rounded-md border border-dashed border-stone-300 bg-stone-50 p-4">
              <p className="text-sm font-medium text-ink">{t("uncalibratedTitle")}</p>
              <p className="mt-1 text-sm text-stone-500">
                {t(axis === "hired" ? "uncalibratedBodyHired" : "uncalibratedBody", { n: data.n, min: data.minOutcomes })}
              </p>
              <CalibrationAccrualNote
                source={source}
                n={data.n}
                minOutcomes={data.minOutcomes}
                className="mt-3 border-t border-stone-200 pt-3"
              />
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                <ReliabilityDiagram
                  result={data}
                  labels={{
                    x: t("axisPredicted"),
                    y: t(axis === "hired" ? "axisObservedHired" : "axisObserved"),
                    perfect: t("perfect"),
                  }}
                  threshold={source === "pipeline" ? data.currentThreshold ?? null : null}
                  baseRate={baseRate}
                />
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-3xl font-semibold text-ink">{data.brier!.toFixed(3)}</div>
                    <div className="text-stone-500">{t("brier")}</div>
                    <div className="mt-1 text-micro text-stone-400">{t("brierHint")}</div>
                  </div>
                  {/* LUC-ANA-2 — the comparison that makes the Brier score mean
                      something: this cohort's own constant predictor, and the skill
                      score against it (negative = worse than always guessing the
                      base rate, which is exactly what the seeded arm scores). */}
                  {baseBrier != null ? (
                    <div>
                      <div className="text-xl font-semibold text-ink nums">
                        {skillDisplay == null ? "—" : t("skillValue", { pct: skillDisplay })}
                      </div>
                      <div className="text-stone-500">{t("skill")}</div>
                      <div className="mt-1 text-micro text-stone-400">
                        {t(axis === "hired" ? "skillHintHired" : "skillHint", {
                          base: baseBrier.toFixed(3),
                          pct: Math.round((baseRate ?? 0) * 100),
                        })}
                      </div>
                    </div>
                  ) : null}
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
                    {baseRate != null ? (
                      <li className="flex items-center gap-2">
                        <span className="inline-block h-0 w-4 shrink-0 border-t-2 border-dotted border-moss align-middle" />
                        {t(axis === "hired" ? "baseRateLegendHired" : "baseRateLegend", {
                          pct: Math.round(baseRate * 100),
                        })}
                      </li>
                    ) : null}
                    {source === "pipeline" && data.currentThreshold ? (
                      <li className="flex items-center gap-2">
                        <span className="inline-block h-4 w-0 shrink-0 border-l-2 border-dashed border-coral align-middle" />
                        {t("thresholdLegend", { threshold: data.currentThreshold })}
                      </li>
                    ) : null}
                    <li className="text-stone-400">{t("samples", { n: data.n })}</li>
                  </ul>
                </div>
              </div>

              {/* Direction 3 — the recommendation (pipeline source, advance axis only;
                  null → an explicit "nothing defensible to suggest, and why"). Appliable
                  in BOTH scopes: all-families moves the global floor, a family filter
                  writes that family's bounded override. The route re-derives against the
                  shown scope, so the 409 staleness guard is honest either way.
                  On the hire axis the route returns no recommendation at all (moving a
                  screening gate on hire rates is a different instrument), so the panel
                  says which axis derives it rather than showing an absence that reads
                  as "no evidence". */}
              {data.recommendation ? (
                <ThresholdSuggestion
                  rec={data.recommendation}
                  roleFamily={family}
                  leakage={data.leakage}
                  onApplied={() => {
                    reload();
                    setApplyNonce((n) => n + 1);
                  }}
                />
              ) : source === "pipeline" && axis === "advance" ? (
                <ThresholdSuggestionAbsent currentThreshold={data.currentThreshold ?? null} roleFamily={family} />
              ) : null}

              {/* Direction 1 — drift cohorts. */}
              {data.cohorts && data.cohorts.length > 0 ? <DriftStrip cohorts={data.cohorts} /> : null}

              {/* Direction 2 — clickable score bands. Keyed on source|family so a
                  source switch remounts it fresh (no stale open band).
                  KAT-L1-003: the drilldown producer labels candidates on the ADVANCE
                  axis only (pipelineCalibrationBandCandidates), so it is offered only
                  there. Listing „advanced/rejected" pills under a hire curve would be
                  the same category error the axis exists to end. */}
              {axis === "advance" ? (
                <ScoreBands
                  key={`${source}|${family}`}
                  result={data}
                  source={source}
                  roleFamily={family}
                  boardHref={boardHref}
                />
              ) : (
                <p className="mt-5 max-w-prose border-t border-stone-200 pt-4 text-sm text-steel">
                  {t("outcomeHiredScopeNote")}
                </p>
              )}
            </>
          )}

          {/* UAT LUC-ANA-14 — CONFIGURATION IS EVIDENCE ABOUT THE POLICY; THE CURVE IS
              EVIDENCE ABOUT THE SAMPLE. ONLY THE SECOND NEEDS A SAMPLE.
              Both blocks used to sit inside the `calibrated` branch, so a workspace
              with a rich sealed policy history and 19 decided candidates showed none
              of it: the Art. 12 record of what the gate WAS vanished for a reason that
              has nothing to do with it. They read their own data and self-describe
              when empty, so they belong outside the measurement gate. DriftStrip and
              ScoreBands stay INSIDE it on purpose — both are claims about the sample.
              Still pipeline-source-only: `currentThreshold`/`familyFloors` ship only on
              the pipeline payload (the chips would otherwise print a global floor of 0
              nobody set) and the analysis arm measures a score the floor never acts on.
              Shown on both axes: the floor is a fact about the policy, not about which
              outcome the curve counts. */}
          {source === "pipeline" ? (
            <>
              <AnalyticsFamilyFloorChips
                familyFloors={data.familyFloors ?? {}}
                currentThreshold={data.currentThreshold ?? null}
                family={family}
                setFamily={setFamily}
              />
              <ThresholdHistoryStrip nonce={applyNonce} family={family} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
