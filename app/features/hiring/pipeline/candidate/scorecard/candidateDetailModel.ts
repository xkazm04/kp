// What the candidate modal's Overview reads: one model, derived once from the
// entry, the role ranking and the axis, so the Scorecard renders and never
// re-derives.

import { clampPercent, scoreTone, type ScoreTone } from "@/app/_lib/format";
import {
  canonicalScoreOf,
  displayScoreOf,
  provenanceOf,
  type DisplayScore,
  type MatchScoreProvenance,
} from "@/app/_lib/match-score";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Confidence, MatchResultView, ScoreDimension } from "@/app/features/shared/matchTypes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { salaryPointOf, type SalaryPoint } from "@/app/features/hiring/pipeline/map/mapSalary";

export type CandidateDetailModel = {
  entry: Entry;
  /** The ranker's fresh total when it answered, else the board's display score. */
  raw: number | null;
  /** Rounded 0–100 for display, null = not scored. */
  score: number | null;
  tone: ScoreTone;
  /** The board's own number and its kind/provenance — the caption when the ranking
   *  has not answered (a work-sample TRANSFER score must name itself). */
  display: DisplayScore | null;
  fitTier: MatchResultView["fitTier"];
  confidence: Confidence | null;
  dims: ScoreDimension[];
  matched: string[];
  unproven: string[];
  missing: string[];
  /** True when the role ranking carried this candidate (bars + skills exist). The
   *  ranking is the keyless rule-based ranker, so `score` is then a rule-based total. */
  hasAnalysis: boolean;
  /** The board card's own number and where it came from, ONLY when the drawer shows a
   *  different (live-ranking) number — so two numbers are never left unexplained. */
  boardDiffers: { score: number; provenance: MatchScoreProvenance } | null;
  /** Stand-in expectation (mapSalary.ts) — always labelled as an estimate. */
  salary: SalaryPoint;
  stage: StageDef | null;
  /** The next column, when there is one and this is not the terminal stage. */
  nextStage: StageDef | null;
};

export function candidateDetailModel(
  entry: Entry,
  match: MatchResultView | undefined,
  axis: readonly StageDef[],
  roleBand: [number, number] | null,
): CandidateDetailModel {
  const display = displayScoreOf(entry);
  const raw = match?.total ?? display?.score ?? null;
  const at = axis.findIndex((s) => s.id === entry.stage);
  const stage = at >= 0 ? axis[at] : null;
  const nextStage = stage && stage.role !== "terminal" && at + 1 < axis.length ? axis[at + 1] : null;
  return {
    entry,
    raw,
    score: raw != null ? Math.round(clampPercent(raw)) : null,
    tone: scoreTone(raw),
    display,
    fitTier: match?.fitTier,
    confidence: match?.confidence ?? null,
    dims: (match?.scoreBreakdown ?? []).slice(0, 5),
    matched: match?.matchedSkills ?? [],
    unproven: match?.unprovenSkills ?? [],
    missing: match?.missingSkills ?? [],
    hasAnalysis: match !== undefined,
    boardDiffers: boardDiffersOf(entry, match, raw),
    salary: salaryPointOf(entry, roleBand),
    stage,
    nextStage,
  };
}

/** The card reads canonicalScoreOf (match-only: analysis fit, else the stored score);
 *  the drawer leads with the live ranking's total. Returns the card's number when the
 *  two round to different values; null when they agree, when the ranking did not
 *  answer (the drawer then shows the card's own number), or when the card is unscored. */
export function boardDiffersOf(
  entry: Entry,
  match: MatchResultView | undefined,
  raw: number | null,
): CandidateDetailModel["boardDiffers"] {
  if (match === undefined || raw == null) return null;
  const card = canonicalScoreOf(entry);
  if (card == null || !Number.isFinite(card)) return null;
  const cardShown = Math.round(clampPercent(card));
  if (cardShown === Math.round(clampPercent(raw))) return null;
  return { score: cardShown, provenance: provenanceOf(entry) ?? { source: "snapshot" } };
}
