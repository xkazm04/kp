"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { Select } from "@/app/_components/Select";
// `import type` only — calibration.ts is pure (no server imports), erased at compile.
import type { CalibrationLeakage, CalibrationOutcomeAxis, CalibrationSource } from "@/app/_lib/calibration";

// The calibration panel's title/blurb + source/family selectors, PLUS the two
// honesty primitives every consumer of a calibration curve needs beside the
// number: where the outcome label came from (leakage) and how far this arm is
// from being judgeable (accrual). They live here because they answer the same
// question the header asks — "what is this curve of?" — and because the section
// headline (QualityInstrument) must render the identical disclosure the panel
// does, from one source.
//
// UAT KAT-ANA-1 / KAT-L1-001 — the route has shipped a per-source `leakage`
// descriptor on every request since the L1 fix, and no surface read it: a
// reader saw a Brier score with no way to know the pipeline arm's outcomes were
// produced by the very score being validated. Disclosure that reaches nobody is
// not disclosure.

const SOURCE_KEY = { pipeline: "sourcePipeline", analysis: "sourceAnalysis", holdout: "sourceHoldout" } as const;

// UAT KAT-L1-003 — the copy is now per (source × outcome axis), because the axis
// changes what the sentence claims. A single `measuresPipeline` reading „against
// whether the candidate advanced past screening" printed over a hire curve would
// be exactly the silent re-definition of success this item exists to prevent.
// The analysis producer has no hire axis (see the route), so both of its slots
// resolve to the same, unchanged copy.
const MEASURES_KEY = {
  pipeline: { advance: "measuresPipeline", hired: "measuresPipelineHired" },
  analysis: { advance: "measuresAnalysis", hired: "measuresAnalysis" },
  holdout: { advance: "measuresHoldout", hired: "measuresHoldoutHired" },
} as const;
const EXCLUSION_KEY = {
  pipeline: { advance: "exclusionPipeline", hired: "exclusionPipelineHired" },
  analysis: { advance: "exclusionAnalysis", hired: "exclusionAnalysis" },
  holdout: { advance: "exclusionHoldout", hired: "exclusionHoldoutHired" },
} as const;

const OUTCOME_KEY = { advance: "outcomeAdvance", hired: "outcomeHired" } as const;

/** Narrow a Select value back to the closed source vocabulary (the route applies
 *  the same fallback, so an unknown value can never silently change the arm). */
export function asCalibrationSource(value: string): CalibrationSource {
  return value === "analysis" || value === "holdout" ? value : "pipeline";
}

export function AnalyticsCalibrationHeader({
  source,
  setSource,
  outcome,
  setOutcome,
  family,
  setFamily,
  families,
}: {
  source: CalibrationSource;
  setSource: (s: CalibrationSource) => void;
  outcome: CalibrationOutcomeAxis;
  setOutcome: (o: CalibrationOutcomeAxis) => void;
  family: string;
  setFamily: (f: string) => void;
  families: string[];
}) {
  const t = useTranslations("analytics.calibration");
  // The hire axis reads pipeline STAGES; the CV-analysis producer pairs a recruiter
  // disposition and has none. Rather than offer a control that silently does
  // nothing, the arm says why the choice is not there.
  const outcomeAvailable = source !== "analysis";
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
        <p className="mt-1 max-w-prose text-sm text-stone-500">{t("blurb")}</p>
        {/* What this curve measures — the score + the outcome, explicit. */}
        <p className="mt-1 max-w-prose text-sm font-medium text-stone-600">{t(MEASURES_KEY[source][outcome])}</p>
        {/* Direction 1 — the label-exclusion note: what counts as an outcome and
            what is silently excluded, so the curve never over-claims its base. */}
        <p className="mt-1 max-w-prose text-sm text-steel">
          <span className="font-medium text-steel">{t("exclusionTitle")}</span> {t(EXCLUSION_KEY[source][outcome])}
        </p>
        {!outcomeAvailable ? (
          <p className="mt-1 max-w-prose text-sm text-steel">{t("outcomeAnalysisUnavailable")}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select
          value={source}
          onChange={(v) => {
            const next = asCalibrationSource(v);
            setSource(next);
            setFamily(""); // families differ per source — a stale filter would silently empty the curve
            // The analysis producer cannot answer the hire question at all, so the
            // axis returns to the one it CAN answer instead of being ignored.
            if (next === "analysis") setOutcome("advance");
          }}
          ariaLabel={t("sourceLabel")}
          size="sm"
          className="shrink-0"
          options={[
            { value: "pipeline", label: t(SOURCE_KEY.pipeline) },
            { value: "analysis", label: t(SOURCE_KEY.analysis) },
            // UAT KAT-ANA-1 — the clean arm was computable and unreachable. It is
            // the only source whose outcome the score did not mechanically produce,
            // so it is the only one a calibration claim can be falsified against.
            { value: "holdout", label: t(SOURCE_KEY.holdout) },
          ]}
        />
        {/* UAT KAT-L1-003 — the second axis, offered exactly like the three
            producers are. „Advanced past screening" and „Reached Hired" are
            different instruments, and the reader picks which one is on screen. */}
        {outcomeAvailable ? (
          <Select
            value={outcome}
            onChange={(v) => setOutcome(v === "hired" ? "hired" : "advance")}
            ariaLabel={t("outcomeLabel")}
            size="sm"
            className="shrink-0"
            options={[
              { value: "advance", label: t(OUTCOME_KEY.advance) },
              { value: "hired", label: t(OUTCOME_KEY.hired) },
            ]}
          />
        ) : null}
        {families.length > 1 ? (
          <Select
            value={family}
            onChange={setFamily}
            ariaLabel={t("familyLabel")}
            size="sm"
            className="shrink-0"
            options={[{ value: "", label: t("familyAll") }, ...families.map((f) => ({ value: f, label: labelize(f) }))]}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Leakage disclosure ───────────────────────────────────────────────────────

// The route ships `note` + `ceiling` in English; the app runs in four locales, so
// the UI keys its own copy off the STABLE `code` (which exists for exactly this —
// see calibration.ts) rather than printing a server string into a Czech screen.
//
// `badge` is keyed off the CODE rather than the level (they are 1:1 in
// calibrationLeakage) because two arms can share a level and still not share a
// claim: on the hire axis it is the REJECTIONS the score produced, not the whole
// outcome, and a badge reading „outcome caused by the score" over a hire curve
// would overstate the coupling in the opposite direction from the original defect.
const LEAKAGE_COPY = {
  "score-caused-label": {
    note: "leakageScoreCausedNote",
    ceiling: "leakageScoreCausedCeiling",
    badge: "leakageLevelHigh",
  },
  // UAT KAT-L1-003 — the hire axis: the positive label is a chain of human
  // decisions, the negative one still is not.
  "score-caused-rejects": {
    note: "leakageScoreCausedHiredNote",
    ceiling: "leakageScoreCausedHiredCeiling",
    badge: "leakageLevelHighRejects",
  },
  "reviewer-saw-score": {
    note: "leakageReviewerSawNote",
    ceiling: "leakageReviewerSawCeiling",
    badge: "leakageLevelMedium",
  },
  "no-automated-leakage": {
    note: "leakageCleanArmNote",
    ceiling: "leakageCleanArmCeiling",
    badge: "leakageLevelLow",
  },
} as const;

const LEVEL_SURFACE = {
  high: "border-coral/40 bg-coral/10",
  medium: "border-dial-amber/40 bg-dial-amber/10",
  low: "border-moss/40 bg-moss/10",
} as const;

/** Where this arm's outcome label came from, and the honest limit that remains.
 *  Rendered ABOVE the curve it qualifies — never a tooltip, never below the fold. */
export function CalibrationLeakageNote({
  source,
  leakage,
  onUseHoldout,
}: {
  source: CalibrationSource;
  leakage: CalibrationLeakage;
  /** Optional escape hatch to the clean arm; omitted where there is no selector. */
  onUseHoldout?: () => void;
}) {
  const t = useTranslations("analytics.calibration");
  const copy = LEAKAGE_COPY[leakage.code];
  return (
    <div className={`mt-4 rounded-md border p-3 ${LEVEL_SURFACE[leakage.level]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta font-semibold uppercase tracking-wide text-ink">{t("leakageTitle")}</span>
        <span className="rounded-full border border-stone-300 bg-white px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-ink">
          {t(copy.badge)}
        </span>
      </div>
      <p className="mt-1.5 max-w-prose text-sm text-ink">{t(copy.note)}</p>
      <p className="mt-1 max-w-prose text-sm text-steel">
        <span className="font-medium text-steel">{t("leakageCeilingLabel")}</span> {t(copy.ceiling)}
      </p>
      {onUseHoldout && source !== "holdout" ? (
        <button
          type="button"
          onClick={onUseHoldout}
          className="focus-ring mt-2 inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40"
        >
          {t("leakageUseHoldout")}
        </button>
      ) : null}
    </div>
  );
}

// ─── Accrual horizon ──────────────────────────────────────────────────────────

/** UAT KAT-ANA-1 — an arm that cannot yet be judged states WHEN it can be, not
 *  just that it cannot. Kateřina's own wording: "the honest curve needs ≈N more
 *  decisions", never an empty chart. Renders bare blocks so each call site owns
 *  its container. */
export function CalibrationAccrualNote({
  source,
  n,
  minOutcomes,
  className = "",
}: {
  source: CalibrationSource;
  n: number;
  minOutcomes: number;
  className?: string;
}) {
  const t = useTranslations("analytics.calibration");
  const remaining = Math.max(0, minOutcomes - n);
  return (
    <div className={className}>
      <p className="text-sm font-medium text-ink">{t("accrualTitle")}</p>
      <p className="mt-1 max-w-prose text-sm text-steel">{t("accrualBody", { remaining, n, min: minOutcomes })}</p>
      {source === "holdout" ? <p className="mt-1 max-w-prose text-sm text-steel">{t("accrualHoldout")}</p> : null}
    </div>
  );
}

// ─── The honest yardstick ─────────────────────────────────────────────────────

// `calibrationSkill` moved to `./calibrationVerdict.ts` so node:test can execute
// it (this file is a `.tsx`, which the unit runner cannot import). Re-exported
// here because several panels already import it from this module.
export { calibrationSkill, type CalibrationSkill } from "./calibrationVerdict";
