// Scorecard rubrics, read straight from the SAME source the Python scorer uses
// (pipeline/jobfit/interview-rubrics.json, consumed in automation.py). Because
// both sides import one file — exactly like archetypes.json / archetypes.ts —
// the TS<->Python drift a hand-mirror used to risk is structurally impossible: a
// reworded anchor or a new competency lands in one place and both languages see it.
//
// Rubrics are keyed by the archetype's scoringModel. `experienced` keeps the
// historical generic axes; `early_career` re-gears them for zero-/low-experience
// candidates with full behaviorally-anchored (BARS) descriptors per level.

import rubricData from "@/pipeline/jobfit/interview-rubrics.json";
import { isEarlyCareer } from "@/app/_lib/archetypes";

export type RubricCompetency = {
  competency: string;
  description: string;
  // Per-level behavioral anchors (BARS). Present on early-career competencies;
  // experienced ones omit them and fall back to the generic RATING_ANCHORS scale.
  anchors?: Record<string, string>;
};

export const RATING_ANCHORS: Record<number, string> = Object.fromEntries(
  Object.entries(rubricData.ratingAnchors).map(([k, v]) => [Number(k), v as string])
);

/** All rubrics, keyed by scoringModel ("experienced" | "early_career"). */
export const INTERVIEW_RUBRICS = rubricData.rubrics as unknown as Record<string, RubricCompetency[]>;

/** Backwards-compatible: the historical flat rubric IS the experienced one. The
 *  recruiter compare grid (api/interview/compare) renders this default. */
export const INTERVIEW_RUBRIC: RubricCompetency[] = INTERVIEW_RUBRICS.experienced;

/** The rubric for a candidate's archetype — early-career archetypes get the
 *  potential / mental-model BARS rubric, everyone else the experienced one.
 *  Mirrors automation.rubric_for_archetype; both resolve the early-career split
 *  from the shared archetypes.json, so selection can never desync from scoring. */
export function rubricForArchetype(archetype: string | null | undefined): RubricCompetency[] {
  return isEarlyCareer(archetype) ? INTERVIEW_RUBRICS.early_career : INTERVIEW_RUBRICS.experienced;
}

export const RUBRIC_ANCHOR_LINE = Object.entries(RATING_ANCHORS)
  .map(([k, v]) => `${k} = ${v}`)
  .join(" · ");
