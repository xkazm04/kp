import test from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { MatchResultView } from "@/app/features/shared/matchTypes";
import { boardDiffersOf, candidateDetailModel } from "./candidateDetailModel";

// The board card reads the stored/analysis score (canonicalScoreOf); the candidate
// modal leads with the live rule-based ranking. When the two disagree the modal must
// say what the card shows and where it came from — never two unexplained numbers.

const entry = (over: Partial<Entry> = {}): Entry =>
  ({ id: "e1", candidateLabel: "Jana", stage: "Screened", status: "active", matchScore: null, ...over }) as Entry;
const live = (total: number) => ({ total }) as MatchResultView;

test("a differing card number is reported with the card's own provenance", () => {
  const e = entry({
    matchScore: 62,
    canonicalScore: 62,
    scoreProvenance: { source: "scored", at: "2026-10-22T09:00:00.000Z" },
  });
  assert.deepEqual(boardDiffersOf(e, live(71), 71), {
    score: 62,
    provenance: { source: "scored", at: "2026-10-22T09:00:00.000Z" },
  });
});

test("equal numbers (after rounding) say nothing extra", () => {
  const e = entry({ matchScore: 71 });
  assert.equal(boardDiffersOf(e, live(70.6), 70.6), null);
});

test("no live ranking means the drawer already shows the card's number", () => {
  assert.equal(boardDiffersOf(entry({ matchScore: 40 }), undefined, 40), null);
});

test("an unscored card is not a second number — no line", () => {
  assert.equal(boardDiffersOf(entry(), live(55), 55), null);
});

test("a work-sample transfer score is not what the card shows as a match — no line", () => {
  // The card ranks on match only (canonicalScoreOf); a transfer score never reaches it.
  assert.equal(boardDiffersOf(entry({ transferScore: 30 } as Partial<Entry>), live(55), 55), null);
});

test("the model carries the comparison", () => {
  const m = candidateDetailModel(entry({ matchScore: 50 }), live(64), [], null);
  assert.equal(m.score, 64);
  assert.equal(m.hasAnalysis, true);
  assert.deepEqual(m.boardDiffers, { score: 50, provenance: { source: "snapshot" } });
});
