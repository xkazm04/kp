// Resolve THE board axis a workspace actually renders.
//
// P1 gave a stage a role; this is where the axis stops being a compile-time
// constant and becomes per-workspace data. Everything that used to import
// PIPELINE_STAGES and be done now asks this module, so there is exactly one
// answer to "which columns does this team's board have" and one place a
// workspace override enters the system.
//
// Pure half (resolveStageAxis / resolvedAxisFor) lives here so `node --test` can
// exercise the fallbacks without the SQLite store; the DB read is a thin wrapper
// at the bottom, in the same shape as app/_lib/interview-plan.ts.
import { DEFAULT_STAGE_AXIS, type StageDef, type StageRole } from "./pipeline-stages";
import type { PipelineStagesRule, PipelineStageWire } from "./decision-config-schema";

export type ResolvedAxis = {
  /** The columns the board renders, in order. Never empty. */
  stages: StageDef[];
  /** Columns this workspace has dropped. NOT rendered, but still resolvable, so
   *  history and a stranded candidate can be named rather than shown a raw id. */
  retired: StageDef[];
};

const toStageDef = (wire: PipelineStageWire): StageDef => ({
  id: wire.id,
  label: wire.label,
  role: wire.role as StageRole,
});

/** The out-of-the-box axis as a ResolvedAxis — what a workspace with no override
 *  gets, and the fallback for a stored config that fails to resolve. */
export function defaultResolvedAxis(): ResolvedAxis {
  return { stages: DEFAULT_STAGE_AXIS.map((s) => ({ ...s })), retired: [] };
}

/**
 * Turn a stored `pipelineStages` config into the axis to render.
 *
 * A missing config is the common case (no workspace has overridden anything
 * yet) and resolves to the shipped default. A config that somehow stored an
 * EMPTY stage list also falls back rather than rendering a board with no
 * columns: the validator forbids it, but this module is the last thing standing
 * between a corrupt row and a blank board, and a blank board loses candidates
 * from view entirely.
 */
export function resolveStageAxis(rule: PipelineStagesRule | null | undefined): ResolvedAxis {
  if (!rule || !Array.isArray(rule.stages) || rule.stages.length === 0) return defaultResolvedAxis();
  return {
    stages: rule.stages.map(toStageDef),
    retired: (rule.retired ?? []).map(toStageDef),
  };
}

/** Every stage id the axis can resolve — live AND retired. This is the set a
 *  stored `pipeline_entries.stage` is allowed to hold: a retired stage is still
 *  a legitimate place for a candidate to be standing until they are migrated. */
export function knownStageIds(axis: ResolvedAxis): Set<string> {
  return new Set([...axis.stages, ...axis.retired].map((s) => s.id));
}

/** Look up a stage by id across live and retired, or null. Callers rendering a
 *  historical event use this so a dropped column still shows its label. */
export function findStage(axis: ResolvedAxis, id: string): StageDef | null {
  return axis.stages.find((s) => s.id === id) ?? axis.retired.find((s) => s.id === id) ?? null;
}

/** Ids sitting on NEITHER list — genuinely off-axis, e.g. a legacy stage that
 *  predates the workspace's config or a row written by an older build. These are
 *  what the board must surface rather than silently fold into column 0. */
export function offAxisStageIds(axis: ResolvedAxis, entryStages: readonly string[]): string[] {
  const known = knownStageIds(axis);
  return [...new Set(entryStages.filter((s) => !known.has(s)))].sort();
}

/** The wire shape the board consumes: the axis plus its tombstones. */
export type PipelineAxisPayload = { stages: StageDef[]; retired: StageDef[] };
