"use client";

// Settings → Hiring — the workspace's pipeline, in two coordinated halves:
//
//   Steps   the board's COLUMNS (PipelineStepsEditor) — add, rename, reorder,
//           remove. This is the half that used to not exist: the five columns
//           were a compile-time literal, identical for every workspace forever.
//   Policy  how AI and human rounds combine on those columns and where humans
//           approve (PipelineComposerMatrix), with the impact strip narrating
//           the result against the REAL board.
//
// Both edit the same draft axis, so renaming a column updates the policy rows and
// the preview as you type — the two tables are visibly one pipeline, which is
// the whole point of the synchronization work.
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
import { PipelineComposerMatrix } from "./PipelineComposerMatrix";
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
          <PipelineStepsEditor
            draft={c.axis}
            onChange={c.setAxis}
            problems={c.problems}
            stranded={c.stranded}
            mapping={c.mapping}
            onMap={c.setMapping}
          />

          <PipelineComposerMatrix plan={c.plan} onChange={c.setPlan} axis={c.axis.stages} />

          {/* Save bar — the plan is a DRAFT until saved. Disabled while the draft
              is invalid or would strand somebody, with the reason stated above
              rather than hidden behind a greyed-out button. */}
          <div
            className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
              c.dirty ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-paper/50"
            }`}
          >
            <span className={`text-sm ${c.dirty ? "font-semibold text-amber-800" : "text-steel"}`} role="status">
              {c.blocked ? t("blocked") : c.dirty ? t("unsaved") : t("allSaved")}
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

          {/* The live preview: the board these steps and this policy produce. */}
          <PlanImpactStrip plan={c.plan} axis={c.axis.stages} />
        </>
      )}
    </div>
  );
}
