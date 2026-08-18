"use client";

// The board's columns, editable.
//
// Settings → Hiring could compose POLICY (who approves what) but not the funnel
// itself: the five columns were a compile-time literal, identical for every
// workspace forever. This is the surface that changes that — add a step, rename
// one, reorder them, drop one.
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
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import type { PipelineStageRoleWire } from "@/app/_lib/decision-config-schema";
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
}: {
  draft: AxisDraft;
  onChange: (next: AxisDraft) => void;
  problems: AxisProblem[];
  /** Saved columns this draft drops with candidates still on them. */
  stranded: StrandedStage[];
  /** removedStageId -> destination stage id. Save is refused until complete. */
  mapping: Record<string, string>;
  onMap: (fromStage: string, toStage: string) => void;
}) {
  const t = useTranslations("hiringPlan.steps");
  // Role names and problem sentences are shared with the first-run wizard's
  // Pipeline step (usePipelineAxisCopy.ts) — same rules, same words.
  const roleLabel = usePipelineStageRoleLabel();
  const problemText = usePipelineAxisProblemText();

  return (
    <section className={`${PANEL} p-5`} aria-label={t("title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
        <span className={META_LABEL}>{t("meta", { count: draft.stages.length, max: AXIS_MAX_STAGES })}</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-steel">{t("intro")}</p>

      <ol className="mt-3 space-y-2">
        {draft.stages.map((stage, i) => (
          <li key={stage.id} className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2">
            <span className="w-5 shrink-0 text-sm text-stone-400 nums">{i + 1}.</span>

            <TextInput
              type="text"
              value={stage.label}
              onChange={(e) => onChange(renameStage(draft, stage.id, e.target.value))}
              aria-label={t("labelAria", { position: i + 1 })}
              sizeVariant="sm"
              className="min-w-40 flex-1"
            />

            <Select
              value={stage.role}
              onChange={(role) => onChange(setStageRole(draft, stage.id, role as PipelineStageRoleWire))}
              ariaLabel={t("roleAria", { stage: stage.label })}
              size="sm"
              options={ASSIGNABLE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
            />

            {/* The stored key, for a step that has one. A draft-only step has no
                key yet — showing a provisional id would invite the reader to
                treat it as stable before it is. */}
            {stage.saved ? (
              <code className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-sm text-steel" title={t("idTitle")}>
                {stage.id}
              </code>
            ) : (
              <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-sm font-semibold text-moss">{t("new")}</span>
            )}

            <span className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onChange(moveStage(draft, stage.id, -1))}
                disabled={i === 0}
                aria-label={t("moveUpAria", { stage: stage.label })}
                className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
              >
                <ArrowUp size={13} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onChange(moveStage(draft, stage.id, 1))}
                disabled={i === draft.stages.length - 1}
                aria-label={t("moveDownAria", { stage: stage.label })}
                className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
              >
                <ArrowDown size={13} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onChange(removeStage(draft, stage.id))}
                aria-label={t("removeAria", { stage: stage.label })}
                className="focus-ring rounded-md p-1 text-steel hover:text-coral"
              >
                <X size={14} aria-hidden />
              </button>
            </span>
          </li>
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
