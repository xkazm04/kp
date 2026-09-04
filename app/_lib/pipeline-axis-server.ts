// Server-side read of the workspace's board axis (stored as the "pipelineStages"
// phase of the tiered decision-config store).
//
// Thin on purpose, and split from pipeline-axis.ts for a reason that matters: the
// resolution rules are needed in the BROWSER too — the board resolves labels for
// retired stages and detects off-axis entries client-side — so they live in the
// pure module. This file is the only thing that touches the DB, and client code
// never imports it. Same split as interview-plan.ts ↔ decision-config-schema.ts.
import { getDecisionConfig } from "./decision-config-store";
import type { PipelineStagesRule } from "./decision-config-schema";
import { resolveStageAxis, type ResolvedAxis } from "./pipeline-axis";
import { stageWithRole, type StageRole } from "./pipeline-stages";

/** The axis in force for a workspace: its own team override, else the org
 *  default, else the shipped board (DEFAULT_STAGE_AXIS). */
export function getPipelineAxis(workspaceId?: string): ResolvedAxis {
  return resolveStageAxis(getDecisionConfig<PipelineStagesRule>("pipelineStages", workspaceId));
}

/** The LIVE stage a workspace's board gives a unique role (`entry` / `offer` /
 *  `terminal`), or null when this axis carries none.
 *
 *  Exists so a server-side writer that has to land a candidate somewhere reads
 *  the workspace's own column rather than the shipped literal: a team that
 *  renamed "Hired" to "Signed" was getting rows written onto a stage its board
 *  does not render, which the off-axis detector then had to surface as a
 *  stranded candidate. Retired columns are deliberately excluded — a tombstone
 *  is a legitimate place to be STANDING, never a place to be MOVED TO. */
export function stageForRole(role: StageRole, workspaceId?: string): string | null {
  return stageWithRole(role, getPipelineAxis(workspaceId).stages);
}
