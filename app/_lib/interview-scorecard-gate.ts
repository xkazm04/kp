import { DEFAULT_STAGE_AXIS, stageHasRole, type StageDef } from "./pipeline-stages";

// A leaf on purpose: automation-run.ts needs only this predicate, and importing it
// from interview-scorecard-commit.ts dragged the voice and interview-kit modules
// onto every route graph that reaches automation-run.

/**
 * Predicate governing the scorecard gate: active, interview role, approval null|calendar.
 * Matches the human scorecard door rule in app/api/interview-prep/scorecard/route.ts.
 */
export function scorecardGateOpen(
  entry: { status: string; stage: string; approvalKind?: string | null },
  stages: readonly StageDef[] = DEFAULT_STAGE_AXIS
): boolean {
  if (entry.status !== "active") return false;
  if (!stageHasRole(entry.stage, "interview", stages)) return false;
  return entry.approvalKind === null || entry.approvalKind === undefined || entry.approvalKind === "calendar";
}
