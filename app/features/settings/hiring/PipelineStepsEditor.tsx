"use client";

// The board's columns AND what runs at each of them — one table.
//
// Settings → Hiring could compose POLICY (who approves what) but not the funnel
// itself: the five columns were a compile-time literal, identical for every
// workspace forever. This is the surface that changed that — add a step, rename
// one, reorder them, drop one.
//
// It now carries the policy too. Until the plan became stage-keyed there were TWO
// tables here: this one, and a Station / Mode / Approval / Cohort matrix that
// listed the same columns again, in its own order, with its own words. The
// recruiter had to hold "row 3 there is row 2 here" in their head, and neither
// table could say what the other knew. The matrix is deleted; each row now reads
// its own column's policy (PipelineStepPolicy).
//
// Two design rules earn their keep here:
//
//  1. ROLE is a first-class control, not a hidden attribute. It is what every
//     product rule resolves through (the fairness gate, the move menu's
//     terminal exclusion, org benchmarks), so leaving it implicit would mean
//     guessing — and guessing wrong silently changes what "advanced past
//     screening" measures. The reader picks it, and the row says what it buys.
//  2. The ID is shown, read-only, next to a SAVED step. It is the value stored
//     on every candidate and every history row; a recruiter renaming a column
//     should be able to see that the underlying key does not move.
//
// The ROW itself is shared with the first-run wizard's Pipeline step
// (features/shared/PipelineStepRow.tsx) — same control order, same type-cell
// width, so the two editors of one axis line up instead of drifting. What stays
// here is what only Settings has: the stored key / "new" badge in the meta slot,
// the full assignable role set, and removal without the wizard's guard rails
// (this surface CAN strand candidates, and answers for it below).
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Select } from "@/app/_components/Select";
import {
  PipelineStepRow,
  PIPELINE_STEP_CELL,
  PIPELINE_STEP_CELL_FIRST,
  PIPELINE_STEP_LABEL_WIDTH,
  PIPELINE_STEP_POLICY_WIDTH,
  PIPELINE_STEP_TYPE_WIDTH,
} from "@/app/features/shared/PipelineStepRow";
import { POLICY_SLOT } from "./PipelineComposerBits";
import { PipelineStepPolicy } from "./PipelineStepPolicy";
import { PRESETS, matchesPreset, type PipelinePlan, type PresetId } from "./pipelineComposerModel";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import {
  addStage,
  ASSIGNABLE_ROLES,
  AXIS_MAX_STAGES,
  moveStage,
  removeStage,
  renameStage,
  setStageRole,
  type AxisDraft,
  type AxisProblem,
  type StrandedStage,
} from "@/app/features/shared/pipelineAxisDraft";
import { usePipelineAxisProblemText, usePipelineStageRoleLabel } from "@/app/features/shared/usePipelineAxisCopy";

export function PipelineStepsEditor({
  draft,
  onChange,
  problems,
  stranded,
  mapping,
  onMap,
  plan,
  onPlan,
}: {
  draft: AxisDraft;
  onChange: (next: AxisDraft) => void;
  problems: AxisProblem[];
  /** Saved columns this draft drops with candidates still on them. */
  stranded: StrandedStage[];
  /** removedStageId -> destination stage id. Save is refused until complete. */
  mapping: Record<string, string>;
  onMap: (fromStage: string, toStage: string) => void;
  /** The policy half: what runs at each column and who approves it. */
  plan: PipelinePlan;
  onPlan: (next: PipelinePlan) => void;
}) {
  const t = useTranslations("hiringPlan.steps");
  const tp = useTranslations("hiringPlan");
  // Role names and problem sentences are shared with the first-run wizard's
  // Pipeline step (usePipelineAxisCopy.ts) — same rules, same words.
  const roleLabel = usePipelineStageRoleLabel();
  const problemText = usePipelineAxisProblemText();
  // The DRAFT axis, so a preset applied mid-edit keys onto the columns the
  // reader is looking at rather than the ones the server still has.
  const axis: StageDef[] = draft.stages.map((s) => ({ id: s.id, label: s.label, role: s.role }));
  const activePreset: PresetId | null = PRESETS.find((p) => matchesPreset(plan, p, axis))?.id ?? null;
  // Rounds are counted in BOARD order, so a column knows whether anything ran
  // before it — which is what decides if a cohort reducer means anything there.
  let seen = 0;
  const roundsBefore = new Map<string, number>();
  for (const stage of draft.stages) {
    roundsBefore.set(stage.id, seen);
    seen += plan.steps.find((s) => s.stageId === stage.id)?.rounds.length ?? 0;
  }

  return (
    <section className={`${PANEL} p-5`} aria-label={t("title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
        <span className={META_LABEL}>{t("meta", { count: draft.stages.length, max: AXIS_MAX_STAGES })}</span>
      </div>
      <p className="mt-1 text-sm text-steel">{t("intro")}</p>

      {/* Blueprints, above the table they rewrite. They set the WHOLE plan — every
          column's mode, approval and cohort at once — so they belong to the table
          as a header, not to any one row. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={META_LABEL}>{tp("startFrom")}</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={activePreset === p.id}
            onClick={() => onPlan(p.plan(axis))}
            className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold transition-colors ${
              activePreset === p.id
                ? "border-ink bg-ink text-white"
                : "border-stone-200 text-steel hover:border-coral/40 hover:text-ink"
            }`}
          >
            {tp(`preset${p.id === "lean" ? "Lean" : p.id === "hybrid" ? "Hybrid" : "Enterprise"}`)}
          </button>
        ))}
      </div>

      {/* Column headings, one per column — including the name field, which labels
          itself only until it sits in a grid of five. The policy buttons show a
          VALUE ("AI", "Auto"), so the dimension each answers has to be named above
          it; that is what lets a reader compare one decision straight down the
          table. Every heading wears the ROW's own cell class, so the dividers and
          the widths cannot drift between header and cells. */}
      <div className="mt-3 hidden items-stretch px-2.5 md:flex">
        <span className="w-5 shrink-0 pr-0.5" />
        <span className={`${PIPELINE_STEP_CELL_FIRST} ${META_LABEL} ${PIPELINE_STEP_TYPE_WIDTH} shrink-0`}>
          {tp("colStation")}
        </span>
        <span className={`${PIPELINE_STEP_CELL} ${META_LABEL} ${PIPELINE_STEP_LABEL_WIDTH}`}>{tp("colLabel")}</span>
        <span className={`${PIPELINE_STEP_POLICY_WIDTH} flex shrink-0 items-stretch`}>
          <span className={`${META_LABEL} ${POLICY_SLOT.cohort} shrink-0`}>{tp("colCohort")}</span>
          <span className={`${META_LABEL} ${POLICY_SLOT.executor} shrink-0`}>{tp("colExecutor")}</span>
          <span className={`${META_LABEL} ${POLICY_SLOT.guard} shrink-0`}>{tp("colGuard")}</span>
        </span>
      </div>

      <ol className="mt-1 space-y-2">
        {draft.stages.map((stage, i) => (
          <PipelineStepRow
            key={stage.id}
            index={i}
            label={stage.label}
            onLabel={(value) => onChange(renameStage(draft, stage.id, value))}
            role={stage.role}
            roleOptions={ASSIGNABLE_ROLES}
            roleLabel={roleLabel}
            onRole={(role) => onChange(setStageRole(draft, stage.id, role))}
            /* The stored key had a column of its own and mostly repeated the name
               beside it, because a column nobody has renamed IS its key. It is
               hover text on the name field now: the same promise (renaming moves
               nothing underneath) at none of the width. A draft-only step has no
               key yet, and says so rather than showing a provisional one. */
            labelTitle={stage.saved ? `${t("idTitle")} — ${stage.id}` : t("new")}
            tabular
            policy={
              <PipelineStepPolicy
                plan={plan}
                onPlan={onPlan}
                stageId={stage.id}
                role={stage.role}
                stageLabel={stage.label || stage.id}
                roundsBefore={roundsBefore.get(stage.id) ?? 0}
              />
            }
            onMove={(delta) => onChange(moveStage(draft, stage.id, delta))}
            canMoveUp={i > 0}
            canMoveDown={i < draft.stages.length - 1}
            onRemove={() => onChange(removeStage(draft, stage.id))}
            aria={{
              label: t("labelAria", { position: i + 1 }),
              role: t("roleAria", { stage: stage.label }),
              moveUp: t("moveUpAria", { stage: stage.label }),
              moveDown: t("moveDownAria", { stage: stage.label }),
              remove: t("removeAria", { stage: stage.label }),
            }}
          />
        ))}
      </ol>

      {draft.stages.length < AXIS_MAX_STAGES ? (
        <button
          type="button"
          onClick={() => onChange(addStage(draft, t("newStepLabel"), "custom"))}
          className={`${BTN_SECONDARY} mt-3 h-8 gap-1.5 px-2.5 text-sm font-semibold`}
        >
          <Plus size={13} className="text-coral" aria-hidden /> {t("addStep")}
        </button>
      ) : null}

      {/* Why this draft cannot be saved. Listed, not summarised: the reader has to
          fix each one, and "invalid pipeline" tells them nothing. */}
      {problems.length > 0 ? (
        <ul role="alert" className="mt-3 space-y-1 rounded-md border border-coral/40 bg-coral/5 px-3 py-2 text-sm text-coral">
          {problems.map((p, i) => (
            <li key={i}>{problemText(p)}</li>
          ))}
        </ul>
      ) : null}

      {/* Who this draft would leave off the board, and where they go instead.
          The one settings change that can strand real people does not merely
          warn: it refuses to save until each removed step has a destination, and
          the move is applied in the same operation as the removal. */}
      {stranded.length > 0 ? (
        <div className={`${PANEL_SUNKEN} mt-3 border-amber-300 bg-amber-50 p-3`}>
          <p className="text-sm font-semibold text-amber-900">{t("strandedTitle")}</p>
          <p className="mt-0.5 text-sm text-amber-800">{t("strandedHint")}</p>
          <ul className="mt-2 space-y-2">
            {stranded.map((s) => (
              <li key={s.stage.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-amber-900">
                  {t("strandedRow", { stage: s.stage.label, count: s.count })}
                </span>
                <span aria-hidden className="text-amber-700">
                  →
                </span>
                <Select
                  value={mapping[s.stage.id] ?? ""}
                  onChange={(target) => onMap(s.stage.id, target)}
                  ariaLabel={t("mapAria", { stage: s.stage.label })}
                  size="sm"
                  // Only steps that SURVIVE this edit are offered: mapping onto
                  // another column the same edit removes would move candidates
                  // out of one hole into another.
                  options={[
                    { value: "", label: t("mapChoose") },
                    ...draft.stages.map((target) => ({ value: target.id, label: target.label || target.id })),
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
