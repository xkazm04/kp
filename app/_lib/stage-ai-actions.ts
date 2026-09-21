// Which AI actions a board column offers — the ONE rule the candidate modal's footer,
// Settings → Hiring's per-step picker and the manual automation doors all read.
//
// Two layers:
//   1. The product DEFAULT, resolved from the column's ROLE on the workspace axis.
//      board-actions-survive-a-renamed-axis: this gating used to be literal stage
//      names ("Screened", "Interview", "Offer"), so a team that renamed its columns
//      matched nothing and silently lost six of the seven actions.
//   2. The workspace's OWN list for a column (`StageDef.actions`, stored in the
//      `pipelineStages` config only when set). It replaces the default outright;
//      an empty list is a real answer — nothing runs at that step.
//
// Pure and React-free, so the contract is unit-tested on its own and the server can
// enforce what the client renders.

import {
  DEFAULT_STAGE_AXIS,
  roleOf,
  screeningStageIds,
  STAGE_AI_ACTIONS,
  stagesWithRole,
  type StageAiAction,
  type StageDef,
} from "./pipeline-stages";

/** Which columns an action defaults to, as a question about MEANING. "all" is an
 *  action whose meaning does not depend on where the candidate stands. */
type StageScope = "all" | ((axis: readonly StageDef[]) => string[]);

/** Every column that is not the outcome-bearing terminal one. */
const nonTerminalStages = (axis: readonly StageDef[]): string[] =>
  axis.filter((s) => s.role !== "terminal").map((s) => s.id);

/** Columns where a conversation is what comes NEXT: every interview column, and
 *  whatever sits immediately before one. That is what "prep" means, and reading it
 *  off the axis's SHAPE rather than off "the last column before the screening gate"
 *  is what keeps it true on a funnel with a case step in the middle — there the
 *  last pre-gate column IS the case, and a candidate who has not sent the
 *  assignment back yet has nothing to prep from. A homework column is therefore
 *  excluded even when an interview follows it. */
const beforeAnInterview = (axis: readonly StageDef[]): string[] =>
  axis.filter((s, i) => axis[i + 1]?.role === "interview" && s.role !== "homework").map((s) => s.id);

const DEFAULT_SCOPE: Record<StageAiAction, StageScope> = {
  // Screening is the triage gate for every pre-gate column — at the entry column it
  // screens a fresh applicant in, at the last pre-gate column it advances or holds —
  // PLUS any column the workspace explicitly marked `screening`, wherever it sits.
  // The enterprise funnel puts its human triage AFTER the AI round, and a column
  // whose whole declared job is screening must still offer the screen; what changes
  // past the gate is only the EFFECT (screenStageOutcome answers "advisory" there,
  // so a late screen informs and moves nobody).
  //
  // `screeningStageIds` excludes homework columns, so a case step's default set comes
  // out as exactly outreach + rejection + rematch — you can chase the candidate, drop
  // them, or look elsewhere, but you cannot "screen" them past the assignment the
  // column exists to give them.
  screen: (axis) => [...new Set([...screeningStageIds(axis), ...stagesWithRole("screening", axis)])],
  prep: (axis) => [...beforeAnInterview(axis), ...stagesWithRole("interview", axis)],
  scorecard: (axis) => stagesWithRole("interview", axis),
  offer: (axis) => stagesWithRole("offer", axis),
  outreach: "all",
  // Rejection is still a decision somebody can take anywhere before the outcome.
  rejection: nonTerminalStages,
  // Alternatives are worth exploring once a candidate has actually been looked at.
  rematch: (axis) => nonTerminalStages(axis).filter((id) => roleOf(id, axis) !== "entry"),
};

/** The product default for a column, in canonical order. An OFF-AXIS stage (a
 *  retired column) resolves no role, so only the unconditional actions remain. */
export function defaultStageActions(stageId: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): StageAiAction[] {
  return STAGE_AI_ACTIONS.filter((id) => {
    const scope = DEFAULT_SCOPE[id];
    return scope === "all" || scope(axis).includes(stageId);
  });
}

/** What the column offers: the workspace's own list when it set one, else the default. */
export function stageActions(stageId: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): StageAiAction[] {
  const own = axis.find((s) => s.id === stageId)?.actions;
  return own ? STAGE_AI_ACTIONS.filter((id) => own.includes(id)) : defaultStageActions(stageId, axis);
}

/** The actions offered for an entry, in canonical order. A non-active entry keeps
 *  only `rematch` (when its column offers it) — the one action that reads a closed
 *  candidate. */
export function offeredStageActions(
  entry: { stage: string; status: string },
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS,
): StageAiAction[] {
  return stageActions(entry.stage, axis).filter((id) => entry.status === "active" || id === "rematch");
}

/** Whether `actions` is exactly the column's default — Settings stores nothing then,
 *  so a later change to the default still reaches the column. */
export function isDefaultStageActions(
  stageId: string,
  actions: readonly StageAiAction[],
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS,
): boolean {
  const defaults = defaultStageActions(stageId, axis);
  return defaults.length === actions.length && defaults.every((id) => actions.includes(id));
}
