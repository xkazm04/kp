"use client";

// The Pipeline step's editing surface, shared by both variants.
//
// Every mutation goes through the SHARED axis model (features/shared/
// pipelineAxisDraft.ts) — the same functions Settings → Hiring calls, so the
// wizard cannot invent a legal-looking edit the composer or the server would
// reject. What this hook adds is the wizard's narrower contract:
//
//   • the two structural columns (entry, terminal) are not removable here and
//     their role is not editable — every axis needs exactly one of each, so
//     leaving those two edits out means the step cannot produce an invalid
//     shape by any single click. The full composer keeps the freedom.
//   • a column with candidates standing on it is not removable either: the
//     server refuses that without a destination (409 migration_required) and the
//     wizard has no place to ask where they go. Settings → Hiring does.
import { useTranslations } from "next-intl";
import {
  addStage,
  axisProblems,
  AXIS_MAX_STAGES,
  moveStage,
  removeStage,
  renameStage,
  setStageRole,
  type AxisDraft,
  type AxisProblem,
  type DraftStage,
} from "@/app/features/shared/pipelineAxisDraft";
import type { PipelineStageRoleWire } from "@/app/_lib/decision-config-schema";
import type { OnboardingCtrl, SetupPipeline } from "./setupSteps";

/** Roles the wizard offers for a middle column. `entry`/`terminal` are omitted
 *  deliberately (see the header): they are already taken and stay put. */
export const SETUP_STAGE_ROLES: readonly PipelineStageRoleWire[] = ["screening", "interview", "offer", "custom"];

export type SetupPipelineEdit = {
  pipeline: SetupPipeline;
  draft: AxisDraft;
  stages: DraftStage[];
  problems: AxisProblem[];
  /** Candidates standing on this column right now (0 on a fresh workspace). */
  occupants: (stage: DraftStage) => number;
  /** Structural columns keep their place: no remove, no role change. */
  isFixed: (stage: DraftStage) => boolean;
  canRemove: (stage: DraftStage) => boolean;
  /** Whether this column may take one step earlier (-1) / later (+1). */
  canMove: (stage: DraftStage, delta: -1 | 1) => boolean;
  atMax: boolean;
  max: number;
  rename: (stage: DraftStage, label: string) => void;
  setRole: (stage: DraftStage, role: PipelineStageRoleWire) => void;
  move: (stage: DraftStage, delta: -1 | 1) => void;
  remove: (stage: DraftStage) => void;
  add: () => void;
  apply: (next: AxisDraft) => void;
};

export function useSetupPipelineEdit(ctrl: OnboardingCtrl, pipeline: SetupPipeline): SetupPipelineEdit {
  const t = useTranslations("setup.pipeline");
  const draft = pipeline.draft;
  const apply = (next: AxisDraft) => ctrl.setPipelineDraft(next);
  const occupants = (stage: DraftStage) => pipeline.counts[stage.id] ?? 0;
  const isFixed = (stage: DraftStage) => stage.role === "entry" || stage.role === "terminal";

  return {
    pipeline,
    draft,
    stages: draft.stages,
    problems: axisProblems(draft),
    occupants,
    isFixed,
    canRemove: (stage) => !isFixed(stage) && occupants(stage) === 0,
    // A middle column may swap with another MIDDLE column and nothing else. That
    // one rule is what keeps "entry first, terminal last" true by construction
    // here — no reachable click in this step can produce an ordering problem.
    canMove: (stage, delta) => {
      if (isFixed(stage)) return false;
      const from = draft.stages.findIndex((s) => s.id === stage.id);
      const target = from < 0 ? undefined : draft.stages[from + delta];
      return target !== undefined && !isFixed(target);
    },
    atMax: draft.stages.length >= AXIS_MAX_STAGES,
    max: AXIS_MAX_STAGES,
    rename: (stage, label) => apply(renameStage(draft, stage.id, label)),
    setRole: (stage, role) => apply(setStageRole(draft, stage.id, role)),
    // Moving a structural column is allowed as far as the model allows it, but the
    // two ends can't swap past each other: entry never moves left of position 0
    // and terminal never moves right of the last slot (moveStage no-ops there),
    // and the callers hide the button that would break the order.
    move: (stage, delta) => apply(moveStage(draft, stage.id, delta)),
    remove: (stage) => apply(removeStage(draft, stage.id)),
    // `custom` — a step the wizard adds means nothing to the product's semantics
    // until someone says otherwise, and guessing "screening" would silently
    // change what "advanced past screening" measures.
    add: () => apply(addStage(draft, t("newStepLabel"), "custom")),
    apply,
  };
}
