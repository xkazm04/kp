// Server-side read of the workspace's hiring-pipeline plan (Settings → Hiring,
// stored as the "interviewPlan" phase of the tiered decision-config store).
// Thin on purpose: the shape, defaults and the pure routing helpers live in
// decision-config-schema.ts (client-safe); this module only binds them to the
// DB-backed store, so client code never imports it.
import { getDecisionConfig } from "./decision-config-store";
import { prunePlanToAxis, type InterviewPlanGate, type InterviewPlanRule } from "./decision-config-schema";
import { getPipelineAxis } from "./pipeline-axis-server";
import { stagesWithRole, type StageRole } from "./pipeline-stages";

/**
 * The plan in force for a workspace: its own team override, else the org
 * default, else the shipped team-hybrid default.
 *
 * Pruned against the workspace's REAL axis on every read. The store hands back
 * whatever was last saved (or a legacy blob the validator already converted
 * using the DEFAULT axis), and a workspace that has since dropped or re-roled a
 * column would otherwise keep a policy governing a column that no longer exists.
 * Pruning is a read-time projection, not a write: nothing is rewritten on disk
 * until the composer next saves.
 */
export function getInterviewPlan(workspaceId?: string): InterviewPlanRule {
  const stored = getDecisionConfig<InterviewPlanRule>("interviewPlan", workspaceId);
  return prunePlanToAxis(stored, getPipelineAxis(workspaceId).stages);
}

/**
 * The gate governing the FIRST column with this role, or "human" when the plan
 * says nothing about it.
 *
 * The role-level question the automation layer still asks ("is screening
 * auto-ratified here?"). It is answered from stage-keyed data now, but it is
 * deliberately still a role question: routing a specific candidate through the
 * gate of the specific column they are standing on needs a per-entry stage read
 * the automation path does not yet thread. "human" as the fallback is the
 * conservative direction — an unstated gate parks the decision for a person
 * rather than ratifying it unattended.
 */
export function getPlanGateForRole(role: StageRole, workspaceId?: string): InterviewPlanGate {
  const axis = getPipelineAxis(workspaceId).stages;
  const plan = getInterviewPlan(workspaceId);
  const first = stagesWithRole(role, axis)[0];
  if (!first) return "human";
  return plan.steps.find((s) => s.stageId === first)?.gate ?? "human";
}
