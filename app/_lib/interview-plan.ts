// Server-side read of the workspace's hiring-pipeline plan (Settings → Hiring,
// stored as the "interviewPlan" phase of the tiered decision-config store).
// Thin on purpose: the shape, defaults and the pure routing helpers live in
// decision-config-schema.ts (client-safe); this module only binds them to the
// DB-backed store, so client code never imports it.
import { getDecisionConfig } from "./decision-config-store";
import type { InterviewPlanRule } from "./decision-config-schema";

/** The plan in force for a workspace: its own team override, else the org
 *  default, else the shipped team-hybrid default. */
export function getInterviewPlan(workspaceId?: string): InterviewPlanRule {
  return getDecisionConfig<InterviewPlanRule>("interviewPlan", workspaceId);
}
