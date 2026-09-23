// blast-radius-computation — what a stage move SETS OFF, decided in ONE place
// (challenge-r06 pipeline-move-bulk-operations/B).
//
// A committed move schedules the arrival hook (stage-hooks.ts): a homework column mails
// a work-sample assignment (designing one first when the job has none), an interview
// column whose first round is run by the AI mints a voice-screen link and emails it
// (`auto`) or parks it for a human (`human`). The move itself also erases whatever
// approval the row carried (`setPipelineEntryStage` clears approval_kind/detail), and a
// drafted offer's terms live ONLY in that approval until it is extended.
//
// The board's bulk "Move N" used to fire all of that on one click with nothing said
// first. Its preview now comes from THIS module, and so does the hook's decision:
// `runStageEnteredHook` reads `arrivalBranch` for its homework / interview / AI-round /
// gate branch, so a preview cannot describe a hook that no longer exists — the preview
// and the execution share one implementation.
//
// Pure (no DB, no React): the caller hands in the workspace's axis, its interview plan
// and whether that plan was ever saved (the `effectiveInterviewGate` discriminator).

import { planStep, type InterviewPlanRule } from "./decision-config-schema";
import { stageHasRole, type StageDef } from "./pipeline-stages";
import { isTerminalEntryStatus } from "./pipeline-status";

/** What ARRIVING on a column sets off, independent of who arrives. */
export type ArrivalEffect =
  /** An AI interview link is minted and emailed now. */
  | "ai_invite"
  /** An AI interview round, gated for a human: the candidate is parked on the Schedule docket. */
  | "ai_invite_held"
  /** A work-sample assignment is sent (designed first when the job has none). */
  | "homework"
  /** Nothing leaves the building. */
  | "plain"
  /** The terminal column is outcome-bearing: set_stage refuses it (422). */
  | "refused_terminal";

/** The hook's own branch, one level finer than the effect: `plain` splits into the two
 *  skip reasons the hook reports. */
export type ArrivalBranch =
  | "refused_terminal"
  | "homework"
  | "not_interview_role"
  | "no_ai_round"
  | "ai_invite"
  | "ai_invite_held";

const EFFECT_OF_BRANCH: Record<ArrivalBranch, ArrivalEffect> = {
  refused_terminal: "refused_terminal",
  homework: "homework",
  not_interview_role: "plain",
  no_ai_round: "plain",
  ai_invite: "ai_invite",
  ai_invite_held: "ai_invite_held",
};

/** The gate an AI interview column runs under: a SAVED plan's gate as saved; a
 *  workspace that never saved a plan runs its AI round unattended. The rule
 *  `effectiveInterviewGate` (stage-hooks.ts) states and delegates to. */
export function resolveInterviewGate(step: { gate: "auto" | "human" }, planSaved: boolean): "auto" | "human" {
  return planSaved ? step.gate : "auto";
}

/** Which branch of the arrival hook a move onto `toStage` takes. Asked by ROLE, never by
 *  a column's name, in the hook's own order: terminal, homework, interview, AI round, gate. */
export function arrivalBranch(
  toStage: string,
  axis: readonly StageDef[],
  plan: InterviewPlanRule,
  planSaved: boolean
): ArrivalBranch {
  if (stageHasRole(toStage, "terminal", axis)) return "refused_terminal";
  if (stageHasRole(toStage, "homework", axis)) return "homework";
  if (!stageHasRole(toStage, "interview", axis)) return "not_interview_role";
  const step = planStep(plan, toStage);
  if (!step || step.rounds[0]?.kind !== "ai") return "no_ai_round";
  return resolveInterviewGate(step, planSaved) === "human" ? "ai_invite_held" : "ai_invite";
}

export function arrivalEffect(
  toStage: string,
  axis: readonly StageDef[],
  plan: InterviewPlanRule,
  planSaved: boolean
): ArrivalEffect {
  return EFFECT_OF_BRANCH[arrivalBranch(toStage, axis, plan, planSaved)];
}

/** One entry's arrival: the effect, plus the two states only an ENTRY can be in. */
export type ArrivalPreviewEffect = ArrivalEffect | "noop" | "closed";

export type ArrivalPlan = {
  effect: ArrivalPreviewEffect;
  /** The pending approval the move would erase, or null. */
  clears: string | null;
  /** The move would destroy something that exists nowhere else (a drafted offer):
   *  a bulk move keeps this row back rather than committing it. */
  holdBack: boolean;
};

/** The approval kinds whose DETAIL is the only copy of what a human prepared: a drafted
 *  offer's terms live in approval_detail until it is extended. Every other kind is
 *  disclosed as cleared, not blocked. */
const HOLD_BACK_KINDS = new Set(["offer_review"]);

/** What moving THIS entry onto `toStage` would do, in set_stage's own order: the terminal
 *  refusal (checked before the row is read), then a closed row (a 409), then a no-op. */
export function planArrival(
  entry: { stage: string; status: string; approvalKind: string | null },
  toStage: string,
  axis: readonly StageDef[],
  plan: InterviewPlanRule,
  planSaved: boolean
): ArrivalPlan {
  const effect = arrivalEffect(toStage, axis, plan, planSaved);
  const still = (e: ArrivalPreviewEffect): ArrivalPlan => ({ effect: e, clears: null, holdBack: false });
  if (effect === "refused_terminal") return still(effect);
  if (isTerminalEntryStatus(entry.status)) return still("closed");
  if (entry.stage === toStage) return still("noop");
  const clears = entry.approvalKind ?? null;
  return { effect, clears, holdBack: clears !== null && HOLD_BACK_KINDS.has(clears) };
}
