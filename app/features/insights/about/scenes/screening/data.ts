/*
 * Chapter 3 — THE COST LADDER, as data.
 *
 * The beat table `ScreeningLadder.tsx` renders from, and the constants
 * chapters.test.ts pins. Pure (imports only the stage ladder), so
 * scenes/beats.test.ts walks every phase against the clock contract.
 *
 * Beats (CYCLE = 14 @ 900ms): 0 outline · 1 cohort · 2 KO gates · 3 KO reasons
 * · 4 survivors to B · 5 scored · 6 ranked · 7 top few to C · 8 the model
 * reasons · 9 the cost line · 10-13 hold. STILL = 9 (was 10, one beat late).
 */
import { stageOf, type ModuleStage } from "../../stage/stages";

export const CYCLE = 14;
export const STILL = 9;

/** The beats the status line changes on; `about.screening.status.s<n>` for each. */
export const STATUS_BEATS = [0, 2, 3, 4, 7, 9] as const;
export type StatusBeat = (typeof STATUS_BEATS)[number];

/*
 * ILLUSTRATIVE, and said out loud in the copy (`about.screening.figuresNote`).
 *
 * Unlike every other number in this deck, these three are NOT quoted from a
 * constant: there is no cohort size, no survival rate and no shortlist width in
 * pipeline/jobfit/matching.py — the shortlist is whatever the caller asks
 * `match_reasoning` for, and the survival rate is whatever the gates say about
 * the actual applicants. They are a worked example of the SHAPE (wide → narrow
 * → narrower), which is the claim the chapter makes.
 *
 * So they get a disclaimer instead of a drift guard, and chapters.test.ts pins
 * the parts that ARE coupled: the three layer function names, and the KO reason
 * keys. If one of these ever becomes a real default, guard it and delete the
 * note.
 */
export const COHORT = 120;
export const SURVIVORS = 74;
export const TOP_N = 8;

/** Real KoReasonKey values, with the clause the product actually prints. */
export const KO_REASONS = [
  { key: "language", n: 19 },
  { key: "seniority", n: 14 },
  { key: "education", n: 8 },
  { key: "workMode", n: 5 },
] as const;

export type ScreeningFrame = {
  layerA: ModuleStage;
  layerB: ModuleStage;
  layerC: ModuleStage;
  reasons: ModuleStage;
  cost: ModuleStage;
  cohort: boolean;
  gated: boolean;
  koListed: boolean;
  survivors: boolean;
  scored: boolean;
  ranked: boolean;
  shortlisted: boolean;
  reasoned: boolean;
  costLine: boolean;
};

export function sceneAt(phase: number): ScreeningFrame {
  const at = (n: number) => phase >= n;
  return {
    layerA: stageOf({ shell: 1, body: 1, detail: 2, chosen: 2 }, phase),
    layerB: stageOf({ shell: 4, body: 4, detail: 5, chosen: 6 }, phase),
    layerC: stageOf({ shell: 7, body: 7, detail: 8, chosen: 8 }, phase),
    reasons: stageOf({ shell: 3, body: 3, detail: 3, chosen: null }, phase),
    cost: stageOf({ shell: 9, body: 9, detail: 9, chosen: null }, phase),
    cohort: at(1),
    gated: at(2),
    koListed: at(3),
    survivors: at(4),
    scored: at(5),
    ranked: at(6),
    shortlisted: at(7),
    reasoned: at(8),
    costLine: at(9),
  };
}
