"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import {
  STAGE_ORDER,
  deriveProgressDisplay,
  headlineStageOf,
  type StageId,
  type StageStatus,
  type StageState,
} from "./analysis-progress-logic";

// Re-export the pure stage logic so existing `@/app/_components/AnalysisProgress`
// imports (useAnalyzeForm, runAnalysis, AnalyzeApi, AnalyzeTypes) keep resolving
// after it moved into the testable sibling module.
export {
  STAGE_ORDER,
  initialStageState,
  applyStageEvent,
  deriveProgressDisplay,
  headlineStageOf,
} from "./analysis-progress-logic";
export type { StageId, StageStatus, StageState, ProgressDisplay } from "./analysis-progress-logic";

// Literal-key maps (next-intl rejects template-literal keys, so we can't build
// `stages.${id}Title` inline) → the catalog lives under analyze.stages.*. Direction
// 3 — three HONEST, observable phases replace the six cosmetic Python-internal ones.
const STAGE_TITLE_KEY = {
  reading: "stages.readingTitle",
  analyzing: "stages.analyzingTitle",
  saving: "stages.savingTitle",
} as const;
const STAGE_SUB_KEY = {
  reading: "stages.readingSub",
  analyzing: "stages.analyzingSub",
  saving: "stages.savingSub",
} as const;

// A once-per-second elapsed clock for the run (mounts with the panel, i.e. at the
// run's start; the panel unmounts when the run ends). Shown beside the indeterminate
// engine span so a slow/stalled model call reads as genuinely in-progress — the
// number keeps climbing while the stage honestly stays "analyzing".
function useElapsedSeconds(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return elapsed;
}

export function AnalysisProgress({
  stages,
  complete,
  fileName,
  variantCount,
  variantsDone,
  variantsTotal,
  onCancel
}: {
  stages: StageState;
  complete: boolean;
  fileName?: string;
  variantCount?: number;
  // bug-ui-scan-2026-07-09 (cv-analysis-workspace #5): the REAL per-variant
  // completion the server persists (task.progressDone/progressTotal). When a
  // multi-variant run reports these, the bar reflects them instead of the faked
  // stage timeline.
  variantsDone?: number;
  variantsTotal?: number;
  onCancel?: () => void;
}) {
  const t = useTranslations("analyze");
  // #5 — honest bar: real per-variant progress when available, else the stage
  // strip but indeterminate (not a frozen percent) while the engine span runs.
  const { percent, indeterminate } = deriveProgressDisplay({ stages, complete, variantsDone, variantsTotal });
  const headlineStage = headlineStageOf(stages, complete);
  // Show the genuine "X / N variants" count the server reports for a comparison.
  const showVariantCount = !complete && Boolean(variantsTotal && variantsTotal > 1);
  // Direction 3 — a ticking elapsed clock for the run, shown while the bar is
  // indeterminate so a slow/stalled engine call visibly keeps counting rather than
  // sitting on a lie. The number below (progress readout) reads it out verbally.
  const elapsedSeconds = useElapsedSeconds();

  return (
    // `aria-label` needs a role to survive: on a bare <div> (an implicit
    // `generic`) the accessible name is DROPPED by the AAM, so the panel was
    // effectively unnamed. `role="group"` exposes it without claiming a
    // landmark this transient card doesn't deserve.
    <div
      role="group"
      aria-label={t("progressAria")}
      className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        {/* bug-ui-scan-2026-07-09 (cv-analysis-workspace #4): scope the live
            region to just the headline + percent text so a screen reader
            re-announces only the current phase, not the whole card (incl. the
            stage rows) on every poll — and so the interactive Cancel button no
            longer sits inside a passive status container. */}
        <div role="status" aria-live="polite">
          <p className="text-meta uppercase text-coral">
            {complete ? t("compilingResult") : t("livePipeline")}
          </p>
          <h2 className="mt-1 font-serif text-h2 text-ink">
            {complete
              ? t("almostThere")
              : headlineStage
                ? t(STAGE_TITLE_KEY[headlineStage])
                : t("startingAnalysis")}
          </h2>
          <p className="mt-1 text-base text-steel">
            {variantCount && variantCount > 1
              ? t("comparingVariants", { count: variantCount })
              : fileName
                ? t("workingOnFile", { fileName })
                : t("workingOnProfile")}
          </p>
          {showVariantCount ? (
            <p className="mt-1 text-sm font-medium text-steel">
              {t("variantsDone", { done: Math.min(variantsDone ?? 0, variantsTotal!), total: variantsTotal! })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-col items-start sm:items-end" role="status" aria-live="polite">
            <span className="text-meta uppercase tracking-wide text-steel">{t("progressLabel")}</span>
            {/* When indeterminate we have no honest number to read out, so show a
                verbal state rather than a fabricated percentage. */}
            <span className="font-serif text-h2 text-ink">{indeterminate ? t("progressWorking") : `${percent}%`}</span>
            {/* Elapsed keeps ticking through the un-instrumented engine span so a
                stall reads as "still working, N s", never a frozen bar. */}
            {!complete ? (
              // aria-hidden: the per-second tick must not spam a screen reader —
              // the verbal "Working" / percent above is the announced state.
              <span aria-hidden className="text-sm tabular-nums text-steel">
                {t("elapsedSeconds", { seconds: elapsedSeconds })}
              </span>
            ) : null}
          </div>
          {onCancel && !complete && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-stone-300 px-2.5 py-1 text-sm font-medium text-steel transition-colors hover:border-coral hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            >
              {t("cancelScan")}
            </button>
          )}
        </div>
      </div>

      {/* #5 — indeterminate: an animated sweep (no fabricated width) while a long,
          un-instrumented step runs; determinate: the honest fill otherwise. */}
      {/* A progressbar MUST carry its own accessible name — the card's label does
          not descend to it. Indeterminate deliberately omits aria-valuenow (that IS
          the ARIA signal for "unknown"), so it also needs aria-valuetext, or a
          screen reader announces a named bar with no value at all. */}
      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(indeterminate
          ? { "aria-valuetext": t("progressWorking") }
          : { "aria-valuenow": percent })}
      >
        {indeterminate ? (
          // Reuse the existing pulse utility (same idiom as GithubAnalysisPanel's
          // loading bar) so no custom keyframe is added; motion-reduce falls back
          // to a static two-thirds fill rather than a jump to a fake 100%.
          <div className="h-full w-2/3 animate-pulse rounded-full bg-coral motion-reduce:animate-none" />
        ) : (
          <div
            className="h-full rounded-full bg-coral transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-2">
        {STAGE_ORDER.map((stage) => (
          <StageRow
            key={stage}
            id={stage}
            status={complete && stages[stage] !== "done" ? "done" : stages[stage]}
          />
        ))}
      </ol>
    </div>
  );
}

function StageRow({ id, status }: { id: StageId; status: StageStatus }) {
  const t = useTranslations("analyze");
  return (
    <li
      className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
        status === "active"
          ? "border-coral bg-coral/5"
          : status === "done"
            ? "border-stone-200 bg-paper"
            : "border-stone-200 bg-white"
      }`}
    >
      <StageIndicator status={status} />
      <div className="min-w-0 flex-1">
        <p
          className={`text-base font-semibold ${
            status === "pending" ? "text-steel" : "text-ink"
          }`}
        >
          {t(STAGE_TITLE_KEY[id])}
        </p>
        <p className="mt-0.5 text-sm leading-5 text-steel">{t(STAGE_SUB_KEY[id])}</p>
      </div>
    </li>
  );
}

function StageIndicator({ status }: { status: StageStatus }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-moss text-white">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-coral bg-white text-coral">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-300" aria-hidden />
    </span>
  );
}
