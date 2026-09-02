"use client";

// Settings → Hiring — the workspace's pipeline, as ONE table plus its preview:
//
//   Steps   the board's COLUMNS and the policy at each of them
//           (PipelineStepsEditor) — add, rename, reorder, remove; and, per row,
//           what runs there and who approves it. Both halves used to not exist:
//           the five columns were a compile-time literal, and the policy was a
//           SECOND table (PipelineComposerMatrix, deleted) that listed the same
//           columns again in its own order with its own words.
//   Impact  the strip below, narrating the result against the REAL board.
//
// Merging the two tables needed the stage-keyed plan (decision-config-schema.ts):
// a row-per-column editor needs one policy per column, and the old wire shape had
// a single workspace-wide screening gate plus a flat round array bound to columns
// by an implicit rule. Now each row simply reads its own column's policy.
//
// PERSISTENCE, save-gated on purpose: edits accumulate as a local DRAFT and
// nothing is stored until Save — a stray click on a preset chip or a gate toggle
// can never silently override the workspace's live policy, and an axis edit can
// never silently strand a candidate. Save writes the axis first, then the plan
// (the plan's stations resolve against the axis). State lives in
// useHiringComposer.
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { PlanImpactStrip } from "./PipelineComposerBits";
import { PipelineStepsEditor } from "./PipelineStepsEditor";
import { useHiringComposer } from "./useHiringComposer";

export function HiringTab() {
  const t = useTranslations("hiringPlan");
  const c = useHiringComposer();

  return (
    <div className="stagger-children space-y-6">
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        <p className={`mt-1 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      {c.loadFailed ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {t("loadFailed")}
        </p>
      ) : c.plan == null || c.axis == null ? (
        <div className="reveal-quiet min-h-[28rem]" aria-hidden />
      ) : (
        <>
          {/* Somebody stored a newer plan while this draft was being edited. The save
              was refused BEFORE anything was written, so the honest move is to show
              what is stored — merging a draft onto a pipeline whose columns may not
              exist any more is how a lost update looks from the inside. */}
          {c.staleConflict ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
              {t("stale")}
              <button
                type="button"
                onClick={() => void c.reloadPlan()}
                className="focus-ring rounded-md px-2 py-0.5 text-sm font-semibold underline hover:bg-coral/10"
              >
                {t("staleReload")}
              </button>
            </p>
          ) : null}

          {/* The occupancy read failed. Said out loud, with the retry: it is what
              refuses a column removal, and a reader shown "fix the problems
              above" over a page with no problems on it cannot act on that. */}
          {c.countsFailed ? (
            <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t("occupancyUnknown")}
              <button
                type="button"
                onClick={() => void c.retryCounts()}
                className="focus-ring rounded-md px-2 py-0.5 text-sm font-semibold text-amber-900 underline hover:bg-amber-100"
              >
                {t("occupancyRetry")}
              </button>
            </p>
          ) : null}

          <PipelineStepsEditor
            draft={c.axis}
            onChange={c.setAxis}
            problems={c.problems}
            stranded={c.stranded}
            mapping={c.mapping}
            onMap={c.setMapping}
            plan={c.plan}
            onPlan={c.setPlan}
          />

          {/* Save bar — the plan is a DRAFT until saved. Disabled while the draft
              is invalid or would strand somebody, with the reason stated above
              rather than hidden behind a greyed-out button. */}
          <div
            className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
              c.dirty ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-paper/50"
            }`}
          >
            <span className={`text-sm ${c.dirty ? "font-semibold text-amber-800" : "text-steel"}`} role="status">
              {c.blockedReason === "occupancy"
                ? t("blockedOccupancy")
                : c.blockedReason === "unmapped"
                  ? t("blockedStranded")
                  : c.blockedReason === "problems"
                    ? t("blocked")
                    : c.dirty
                      ? t("unsaved")
                      : t("allSaved")}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {c.dirty ? (
                <button
                  type="button"
                  onClick={c.discard}
                  disabled={c.saving}
                  className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-steel hover:bg-stone-100 hover:text-ink disabled:opacity-50"
                >
                  <RotateCcw size={13} aria-hidden /> {t("discard")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void c.save()}
                disabled={!c.dirty || c.saving || c.blocked}
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {c.saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />}
                {c.saving ? t("saving") : t("save")}
              </button>
            </span>
          </div>

          {/* The writes landed; the re-read behind them did not. Its own line, not
              a "save failed" toast over a committed save — that lie invites a
              second save of a plan that is already stored. */}
          {c.refreshFailed ? (
            <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-paper px-3 py-2 text-sm text-steel">
              {t("refreshFailed")}
              <button
                type="button"
                onClick={() => void c.retryRefresh()}
                className="focus-ring rounded-md px-2 py-0.5 text-sm font-semibold text-ink underline hover:bg-stone-100"
              >
                {t("refreshRetry")}
              </button>
            </p>
          ) : null}

          {/* The live preview: the board these steps and this policy produce. */}
          <PlanImpactStrip plan={c.plan} axis={c.axis.stages} />
        </>
      )}
    </div>
  );
}
