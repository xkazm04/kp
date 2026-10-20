// A team's stage aging cadence: the pure half (challenge-r03 pipeline-board-ui/A).
//
// The cadence a board ages against is TEAM data: an optional `slaDays` on each stage
// of the workspace's `pipelineStages` axis, read through the one aging clock
// (aging-policy.ts `slaForStage`) by the board, the sidebar badge and the automation
// pass alike. It used to be a per-browser localStorage map, so two recruiters on one
// team aged the same board differently and the server-side surfaces contradicted the
// board the moment anyone tuned a column.
//
// Three pure pieces, no DB and no React, so both the route and the board import them:
//   - applyStageSla: the single-column edit PATCH /api/pipeline/stage-sla runs INSIDE
//     the store's IMMEDIATE read-modify-write (updateDecisionConfig), on the axis in
//     force at that moment, never on a client's snapshot of it;
//   - slaOverridesFromAxis: the per-column values a team has set, as a map;
//   - pendingLocalAdoption: which of a browser's leftover pre-migration cadences are
//     worth OFFERING to the team (never imported silently: one browser's taste is not
//     team policy until someone with the authority to set it says so).
import { isStageSlaDays, type PipelineStagesRule, type PipelineStageWire } from "./decision-config-schema";
import type { StageDef } from "./pipeline-stages";

export type ApplyStageSlaResult = { ok: true; rule: PipelineStagesRule } | { ok: false; error: string };

/** Set (`days`) or clear (`null`) one LIVE column's cadence on `rule`. Every other
 *  stage, and the retired list, is carried through untouched. Refused: a stage that
 *  is not on the live axis (a retired column is not drawn, so it has nothing to
 *  tune), the terminal column (a hire has no clock), and a value outside the
 *  schema's whole-day bounds. */
export function applyStageSla(rule: PipelineStagesRule, stageId: string, days: number | null): ApplyStageSlaResult {
  const stages = Array.isArray(rule?.stages) ? rule.stages : [];
  const target = stages.find((s) => s.id === stageId);
  if (!target) return { ok: false, error: `stage "${String(stageId)}" is not on this board.` };
  if (target.role === "terminal") return { ok: false, error: `stage "${stageId}" is the terminal stage and never ages.` };
  if (days !== null && !isStageSlaDays(days)) return { ok: false, error: "days must be a whole number from 1 to 365, or null." };
  const next = stages.map((s): PipelineStageWire => {
    if (s.id !== stageId) return s;
    const rest: PipelineStageWire = { ...s };
    delete rest.slaDays;
    return days === null ? rest : { ...rest, slaDays: days };
  });
  return { ok: true, rule: { stages: next, retired: rule.retired ?? [] } };
}

/** The cadences this team has set, keyed by column id. */
export function slaOverridesFromAxis(axis: readonly StageDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of axis) if (s.role !== "terminal" && isStageSlaDays(s.slaDays)) out[s.id] = s.slaDays;
  return out;
}

export type LocalSlaOffer = { stage: string; days: number };

/** Which leftover per-browser cadences to offer to the team, in board order. A value
 *  for a column this board no longer draws is dropped (it would be refused anyway),
 *  as is one for the terminal column, one out of bounds, and one that already equals
 *  the team's value (offering a no-op trains the reader to dismiss the offer). */
export function pendingLocalAdoption(local: Record<string, number>, axis: readonly StageDef[]): LocalSlaOffer[] {
  const team = slaOverridesFromAxis(axis);
  const offers: LocalSlaOffer[] = [];
  for (const s of axis) {
    const days = local[s.id];
    if (s.role === "terminal" || !isStageSlaDays(days) || team[s.id] === days) continue;
    offers.push({ stage: s.id, days });
  }
  return offers;
}
