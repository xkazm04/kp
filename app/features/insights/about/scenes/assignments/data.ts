/*
 * Chapter 5 — THE FROZEN BASELINE, as data.
 *
 * The beat table `CaseBaseline.tsx` renders from, and the constants
 * chapters.test.ts pins. Pure (imports only the stage ladder), so
 * scenes/beats.test.ts walks every phase against the clock contract.
 *
 * Beats (CYCLE = 15 @ 900ms): 0 outline · 1 seed · 2 bare model runs · 3 frozen
 * · 4 candidate submits · 5-6 both deltas · 7 overlap · 8 the reading · 9 the
 * refusal to penalise · 10-14 hold. STILL = 9 (was 10, one beat late).
 */
import { stageOf, type ModuleStage } from "../../stage/stages";

export const CYCLE = 15;
export const STILL = 9;

/** The beats the status line changes on; `about.assignments.status.s<n>` for each. */
export const STATUS_BEATS = [0, 2, 3, 4, 5, 7, 8, 9] as const;
export type StatusBeat = (typeof STATUS_BEATS)[number];

/** The worked example's delta-to-delta overlap. Must sit below AIM. */
export const OVERLAP = 0.31;
/** `if sim >= 0.85` in artifact_checks.py — the interview prompt, not a penalty. */
export const AIM = 0.85;

export type AssignmentsFrame = {
  seed: ModuleStage;
  baseline: ModuleStage;
  submission: ModuleStage;
  deltaBaseline: ModuleStage;
  deltaSubmission: ModuleStage;
  result: ModuleStage;
  seeded: boolean;
  baselineRun: boolean;
  frozen: boolean;
  submitted: boolean;
  baselineDelta: boolean;
  submissionDelta: boolean;
  compared: boolean;
  reading: boolean;
  refusal: boolean;
};

export function sceneAt(phase: number): AssignmentsFrame {
  const at = (n: number) => phase >= n;
  return {
    seed: stageOf({ shell: 1, body: 1, detail: 1, chosen: null }, phase),
    baseline: stageOf({ shell: 2, body: 2, detail: 3, chosen: 3 }, phase),
    submission: stageOf({ shell: 4, body: 4, detail: 4, chosen: null }, phase),
    deltaBaseline: stageOf({ shell: 5, body: 5, detail: 5, chosen: null }, phase),
    deltaSubmission: stageOf({ shell: 6, body: 6, detail: 6, chosen: null }, phase),
    result: stageOf({ shell: 7, body: 7, detail: 8, chosen: null }, phase),
    seeded: at(1),
    baselineRun: at(2),
    frozen: at(3),
    submitted: at(4),
    baselineDelta: at(5),
    submissionDelta: at(6),
    compared: at(7),
    reading: at(8),
    refusal: at(9),
  };
}
