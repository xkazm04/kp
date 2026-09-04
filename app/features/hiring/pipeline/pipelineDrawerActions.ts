// Which AI actions the candidate drawer offers, and at which column.
//
// board-actions-survive-a-renamed-axis: this gating used to be LITERAL stage names
// ("Screened", "Interview", "Offer") inside PipelineAiActionsGrid.tsx, while every
// other board consumer — moveTargetStages, the SLA editor, the fairness metric, the
// set_stage guard — resolves the same questions through stage ROLES. The board axis
// is workspace-editable, so a team that renamed its columns matched NOTHING here and
// silently lost Screen, Prep, Scorecard, Offer, Rejection and Rematch: the grid
// rendered "Draft outreach" alone, with no error and nothing to notice.
//
// Pure and React-free (no JSX, no lucide import) so the contract is unit-testable in
// isolation; the grid component owns the icon per action and the catalog label.

import {
  DEFAULT_STAGE_AXIS,
  roleOf,
  screenedLandingStage,
  screeningStageIds,
  stagesWithRole,
  type StageDef,
} from "@/app/_lib/pipeline-stages";
import type { TaskId } from "./PipelineCandidateDrawerTypes";

/** Which columns an action is offered on, resolved from the WORKSPACE's axis.
 *  "all" is the unconditional set — an action whose meaning does not depend on
 *  where the candidate stands. */
type StageScope = "all" | ((axis: readonly StageDef[]) => string[]);

/** Every column that is not the outcome-bearing terminal one — where a rejection is
 *  still a decision somebody can take. */
const nonTerminalStages = (axis: readonly StageDef[]): string[] =>
  axis.filter((s) => s.role !== "terminal").map((s) => s.id);

/** The actions in the order the grid renders them, each with the columns it applies
 *  to expressed as a question about MEANING. */
export const DRAWER_ACTIONS: { id: TaskId; stages: StageScope }[] = [
  // Screening is the triage gate for every pre-gate column (screeningStageIds): at
  // the entry column it screens a fresh applicant into the screened one (or into it
  // held for review); at the last pre-gate column it advances toward the interview
  // round or holds. So the top of the funnel — where triage volume is highest — is
  // individually actionable, whatever the columns are called.
  { id: "screen", stages: (axis) => screeningStageIds(axis) },
  // Prep is meaningful once they are through screening and while they interview: the
  // last pre-gate column (where the interview is being set up) plus every interview
  // round.
  { id: "prep", stages: (axis) => [screenedLandingStage(axis), ...stagesWithRole("interview", axis)].filter(Boolean) },
  { id: "scorecard", stages: (axis) => stagesWithRole("interview", axis) },
  { id: "offer", stages: (axis) => stagesWithRole("offer", axis) },
  { id: "outreach", stages: "all" },
  { id: "rejection", stages: nonTerminalStages },
  // Alternatives are worth exploring once a candidate has actually been looked at —
  // every non-terminal column except the funnel entry.
  { id: "rematch", stages: (axis) => nonTerminalStages(axis).filter((id) => roleOf(id, axis) !== "entry") },
];

/** The ids offered for an entry at `stage` with `status`, in grid order.
 *
 *  `axis` defaults to the shipped board so a caller that has not threaded the
 *  workspace axis through behaves exactly as before. An OFF-AXIS stage (a retired
 *  column) resolves no role, so only the "all" actions are offered — the honest
 *  answer: nobody has said what that column means any more. A non-active entry keeps
 *  only `rematch`, which is the one action that reads a closed candidate. */
export function pipelineDrawerActionIds(
  entry: { stage: string; status: string },
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): TaskId[] {
  return DRAWER_ACTIONS.filter((act) => act.stages === "all" || act.stages(axis).includes(entry.stage))
    .filter((act) => entry.status === "active" || act.id === "rematch")
    .map((act) => act.id);
}
