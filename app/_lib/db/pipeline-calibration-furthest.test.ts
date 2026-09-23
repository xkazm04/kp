// Calibration labels from the FURTHEST stage reached (challenge-r06 db-pipeline-store/B).
// The registry's selection-score-calibration standard: "When a candidate reached a
// later stage and then returned to screening, use the furthest role reached, not the
// current one." The product copy already promises it ("advanced (reached interview,
// offer, or hired)"). These pin that the curve AND its band drill read the ledger,
// that a board-edit migration is not evidence, and that the hire axis is unchanged.
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts stays the first import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  calibrationOutcome,
  createPipelineEntry,
  migratePipelineStages,
  pipelineCalibrationBandCandidates,
  pipelineCalibrationPairs,
  setPipelineEntryStage,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

// A workspace of its own: the migration case moves EVERY active occupant of a
// column, so the demo corpus in the default workspace must not be in reach.
const WS = "ws-cal-furthest";
const FAMILY = "cal_furthest_family";

let seq = 0;
function addEntry(matchScore: number) {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `cf-c${seq}`,
    candidateLabel: `Furthest Tester ${seq}`,
    roleFamily: FAMILY,
    jobId: `cf-job-${seq}`,
    jobTitle: "Furthest Test Role",
    matchScore,
    workspaceId: WS,
  });
  assert.equal(created, true);
  assert.equal(entry.stage, "Screened", "fixture starts at the screen gate");
  return entry;
}

const act = (id: string, action: "accept" | "reject") => actOnPipelineEntry(id, action, undefined, undefined, WS);

function outcomeOf(score: number, opts?: Parameters<typeof pipelineCalibrationPairs>[1]) {
  const hits = pipelineCalibrationPairs(WS, opts).filter((p) => p.roleFamily === FAMILY && p.score === score);
  assert.ok(hits.length <= 1, `at most one pair for score ${score}`);
  return hits.length ? hits[0].outcome : null;
}

test("advanced to Interview, moved back after a no-show, then rejected -> outcome 1 in the curve and the drill", () => {
  const e = addEntry(80);
  assert.ok(act(e.id, "accept")); // Screened -> Interview ('advanced')
  assert.ok(setPipelineEntryStage(e.id, "Screened", undefined, WS)); // no-show
  assert.ok(act(e.id, "reject"));
  assert.equal(outcomeOf(80), 1, "the score did advance this candidate past the gate");

  const band = pipelineCalibrationBandCandidates(80, 90, false, null, WS).filter((c) => c.entryId === e.id);
  assert.equal(band.length, 1, "the drill lists the same entry the curve counts");
  assert.equal(band[0].outcome, 1, "one rule: the drill agrees with the curve");
});

test("rejected at the gate having never stood on a positive column -> outcome 0 (unchanged)", () => {
  const e = addEntry(40);
  assert.ok(act(e.id, "reject"));
  assert.equal(outcomeOf(40), 0);
});

test("reached Interview ONLY via a board-edit migration, moved back and rejected -> outcome 0", () => {
  const e = addEntry(41);
  // The board edit moves every active Screened occupant of WS; the other fixtures
  // in this file are terminal or added later, so only e is moved.
  assert.ok(migratePipelineStages([{ fromStage: "Screened", toStage: "Interview" }], WS) >= 1);
  assert.ok(setPipelineEntryStage(e.id, "Screened", undefined, WS));
  assert.ok(act(e.id, "reject"));
  assert.equal(outcomeOf(41), 0, "a board-shape move is not evidence the score advanced anyone");
});

test("active entry that reached Interview and was moved back (not rejected) -> outcome 1 on the advance axis", () => {
  const e = addEntry(66);
  assert.ok(act(e.id, "accept"));
  assert.ok(setPipelineEntryStage(e.id, "Screened", undefined, WS));
  assert.equal(outcomeOf(66), 1, "decided at screening: advanced");
});

test("hire axis is unchanged: an undone hire stays excluded, a reject at interview stays 0", () => {
  const undone = addEntry(91);
  for (let i = 0; i < 3; i += 1) assert.ok(act(undone.id, "accept")); // -> Hired
  assert.ok(setPipelineEntryStage(undone.id, "Offer", undefined, WS)); // hire undone, still active
  assert.equal(outcomeOf(91, { outcome: "hired" }), null, "an undone hire is not counted as a hire");

  const rejectedAtInterview = addEntry(72);
  assert.ok(act(rejectedAtInterview.id, "accept"));
  assert.ok(act(rejectedAtInterview.id, "reject"));
  assert.equal(outcomeOf(72, { outcome: "hired" }), 0);
});

test("the holdout filter composes: only the named entry gets a pair, under the furthest-reached rule", () => {
  const e1 = addEntry(83);
  assert.ok(act(e1.id, "accept"));
  assert.ok(setPipelineEntryStage(e1.id, "Screened", undefined, WS));
  assert.ok(act(e1.id, "reject"));
  const other = addEntry(84);
  assert.ok(act(other.id, "reject"));

  const pairs = pipelineCalibrationPairs(WS, { onlyEntryIds: new Set([e1.id]) });
  assert.equal(pairs.length, 1, "no pair for any other entry");
  assert.equal(pairs[0].score, 83);
  assert.equal(pairs[0].outcome, 1);
});

// ─── The pure rule (no DB read): the curve and the drill both call it ────────
// On a positive column now or ever = 1; else a merit `rejected` = 0; else null
// (pending, or a non-merit terminal that never reached a positive column).
const POSITIVE: ReadonlySet<string> = new Set(["Interview", "Offer", "Hired"]);
const NONE: ReadonlySet<string> = new Set();
const REACHED: ReadonlySet<string> = new Set(["Interview"]);
const REACHED_NON_POSITIVE: ReadonlySet<string> = new Set(["Screened", "Accepted"]);

type Row = { status: string; currentStage: string; reachedStages: ReadonlySet<string> };
const cases: [string, Row, 0 | 1 | null][] = [
  ["active, current positive", { status: "active", currentStage: "Interview", reachedStages: NONE }, 1],
  ["active, reached positive, back at screen", { status: "active", currentStage: "Screened", reachedStages: REACHED }, 1],
  ["active, never positive", { status: "active", currentStage: "Screened", reachedStages: REACHED_NON_POSITIVE }, null],
  ["rejected, current positive", { status: "rejected", currentStage: "Interview", reachedStages: NONE }, 1],
  ["rejected, reached positive, back at screen", { status: "rejected", currentStage: "Screened", reachedStages: REACHED }, 1],
  ["rejected, never positive", { status: "rejected", currentStage: "Screened", reachedStages: NONE }, 0],
  ["non-merit terminal, reached positive", { status: "declined", currentStage: "Screened", reachedStages: REACHED }, 1],
  ["non-merit terminal, never positive", { status: "role_closed", currentStage: "Screened", reachedStages: NONE }, null],
];

for (const [name, row, want] of cases) {
  test(`calibrationOutcome: ${name} -> ${want}`, () => {
    assert.equal(calibrationOutcome(row, POSITIVE), want);
  });
}
