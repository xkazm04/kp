// Behavioral coverage for the ACTING-score calibration producer (REC-02):
// pipelineCalibrationPairs must pair the entry match_score — the number the
// screen gate actually thresholds — with the screen-gate outcome, and the
// /api/analytics/calibration route must read THIS producer by default (the old
// analyses.score × disposition pairing stays as the labeled ?source=analysis).
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts stays the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  closeEntriesByJobId,
  createPipelineEntry,
  pipelineCalibrationPairs,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

// The unit DB is seeded with demo pipeline entries, so the assertions scope to a
// fixture-unique role family (roleFamily rides every pair for exactly this kind
// of filtering) instead of assuming an empty table.
const FIXTURE_FAMILY = "cal_test_family";

let seq = 0;
function addEntry(matchScore: number | null) {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `cal-c${seq}`,
    candidateLabel: `Calibration Tester ${seq}`,
    roleFamily: FIXTURE_FAMILY,
    jobId: `cal-job-${seq}`,
    jobTitle: "Calibration Test Role",
    matchScore,
  });
  assert.equal(created, true);
  assert.equal(entry.stage, "Screened", "fixture starts at the screen gate");
  return entry;
}

test("pipelineCalibrationPairs pairs the acting match_score with the screen-gate outcome", () => {
  // outcome 1 — advanced past the screen gate.
  const advanced = addEntry(80);
  assert.ok(actOnPipelineEntry(advanced.id, "accept")); // Screened → Interview

  // outcome 1 even though later rejected — the screen gate DID advance them;
  // the interview verdict is a different decision than the score predicted.
  const rejectedAtInterview = addEntry(62);
  assert.ok(actOnPipelineEntry(rejectedAtInterview.id, "accept"));
  assert.ok(actOnPipelineEntry(rejectedAtInterview.id, "reject"));

  // outcome 0 — rejected while still at the gate (the adverse decision the score fed).
  const rejectedAtGate = addEntry(30);
  assert.ok(actOnPipelineEntry(rejectedAtGate.id, "reject"));

  // excluded — still pending at the gate: no outcome yet.
  addEntry(55);

  // excluded — unscored: a never-measured candidate must not enter as a fabricated 0.
  const unscored = addEntry(null);
  assert.ok(actOnPipelineEntry(unscored.id, "accept"));

  // excluded — role closed at the gate: a timing close-out, not a screen verdict.
  const roleClosed = addEntry(45);
  assert.equal(closeEntriesByJobId(roleClosed.jobId!), 1);

  const pairs = pipelineCalibrationPairs().filter((p) => p.roleFamily === FIXTURE_FAMILY);
  const byScore = new Map(pairs.map((p) => [p.score, p]));

  assert.deepEqual(
    [...byScore.keys()].sort((a, b) => a - b),
    [30, 62, 80],
    "exactly the decided, scored entries enter — no pending, no unscored, no role_closed"
  );
  assert.equal(pairs.length, 3, "one pair per decided entry");
  assert.equal(byScore.get(80)?.outcome, 1);
  assert.equal(byScore.get(62)?.outcome, 1, "rejected AFTER advancing still counts as advanced past the gate");
  assert.equal(byScore.get(30)?.outcome, 0);
});

test("the calibration route reads the acting producer by default and labels what it measures", () => {
  const routeSrc = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api/analytics/calibration/route.ts"),
    "utf8"
  );
  assert.match(
    routeSrc,
    /pipelineCalibrationPairs\(\s*(ws|await currentWorkspace\(\))\s*\)/,
    "the route must read the pipeline (acting-score) producer, workspace-scoped (P1)"
  );
  assert.match(
    routeSrc,
    /params\.get\("source"\)\s*===\s*"analysis"\s*\?\s*"analysis"\s*:\s*"pipeline"/,
    "pipeline is the default; the analysis pairing is opt-in"
  );
  assert.ok(routeSrc.includes("measures: source"), "the response names which score the curve measures");
});
