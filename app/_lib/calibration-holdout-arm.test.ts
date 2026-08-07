// The calibration CLEAN ARM, end to end (UAT 2026-07-20, KAT-L1-001/002).
//
// The default calibration curve is circular: the screening wave rejects on
// match_score, and `pipelineCalibrationPairs` then labels a rejected entry
// outcome=0 — so the predictor produced its own negative label. The holdout spares
// a random sample of would-be rejects; this test proves the plumbing that lets the
// calibration read ONLY those spared candidates, whose outcome the score did not
// mechanically produce.
//
// It exercises the real seam: seal a `screen_wave_holdout` record (what the wave
// does when it spares someone), then assert heldOutEntryIds surfaces exactly the
// spared entries and pipelineCalibrationPairs({onlyEntryIds}) restricts the curve
// to them using the SAME inclusion rule as the contaminated curve.
//
// unit-db.ts MUST be the first project import (sets an isolated KP_DB_PATH).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  sealDecisionRecord,
  heldOutEntryIds,
  SCREEN_WAVE_HOLDOUT_KIND,
  AUTO_REJECTED_KIND,
} from "./decision-record-store.ts";
import { actOnPipelineEntry, createPipelineEntry, pipelineCalibrationPairs } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

const FAMILY = "holdout_arm_family";
let seq = 0;

function addEntry(matchScore: number | null) {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `ho-c${seq}`,
    candidateLabel: `Holdout Tester ${seq}`,
    roleFamily: FAMILY,
    jobId: `ho-job-${seq}`,
    jobTitle: "Holdout Test Role",
    matchScore,
  });
  assert.equal(created, true);
  return entry;
}

function sealHoldout(entryId: string): void {
  sealDecisionRecord({
    kind: SCREEN_WAVE_HOLDOUT_KIND,
    actor: "auto:screen-wave",
    policyVersion: "screen-wave/test/holdout5",
    candidateRef: entryId,
    rationale: "spared for the calibration clean arm",
    reasonCode: "holdout",
    inputs: { holdoutPercent: 5 },
  });
}

test("heldOutEntryIds returns exactly the spared entries", () => {
  const spared1 = addEntry(30);
  const spared2 = addEntry(40);
  addEntry(35); // NOT spared — no holdout record
  sealHoldout(spared1.id);
  sealHoldout(spared2.id);

  const ids = heldOutEntryIds();
  assert.ok(ids.has(spared1.id));
  assert.ok(ids.has(spared2.id));
  assert.equal(ids.size, 2, "only the entries with a holdout record are in the clean arm");
});

test("a spared candidate later auto-rejected leaves the clean arm (leakage returns)", () => {
  const flipFlop = addEntry(28);
  sealHoldout(flipFlop.id);
  assert.ok(heldOutEntryIds().has(flipFlop.id), "spared → in the arm");

  // A later wave at a lower rate auto-rejects them: the reject is score-caused again.
  sealDecisionRecord({
    kind: AUTO_REJECTED_KIND,
    actor: "auto:screen-wave",
    policyVersion: "screen-wave/test/holdout0",
    candidateRef: flipFlop.id,
    rationale: "auto-rejected on a later wave",
    reasonCode: "reject",
    inputs: {},
  });
  assert.ok(!heldOutEntryIds().has(flipFlop.id), "auto-rejected → removed from the clean arm");
});

test("the clean-arm curve restricts to spared entries with the SAME inclusion rule", () => {
  // Fresh trio of spared candidates with distinct outcomes.
  const advanced = addEntry(33); // spared, then a HUMAN advances them → a caught false-negative (outcome 1)
  const humanReject = addEntry(31); // spared, then a HUMAN rejects them → the score was right (outcome 0)
  const pending = addEntry(29); // spared, still at the gate → no outcome yet
  const notSpared = addEntry(32); // never spared — must NOT appear in the arm even though rejected
  [advanced, humanReject, pending].forEach((e) => sealHoldout(e.id));

  assert.ok(actOnPipelineEntry(advanced.id, "accept")); // Screened → Interview
  assert.ok(actOnPipelineEntry(humanReject.id, "reject"));
  assert.ok(actOnPipelineEntry(notSpared.id, "reject"));

  const ids = heldOutEntryIds();
  const armPairs = pipelineCalibrationPairs(undefined, { onlyEntryIds: ids }).filter((p) => p.roleFamily === FAMILY);
  const byScore = new Map(armPairs.map((p) => [p.score, p.outcome]));

  assert.equal(byScore.get(33), 1, "spared + human-advanced = a caught false-negative (outcome 1)");
  assert.equal(byScore.get(31), 0, "spared + human-rejected = the reject was right (outcome 0)");
  assert.ok(!byScore.has(29), "still pending at the gate = no outcome yet");
  assert.ok(!byScore.has(32), "a never-spared entry is excluded from the clean arm");
  // Sanity: the SAME entries appear in the full curve (the arm is a strict subset).
  const full = pipelineCalibrationPairs().filter((p) => p.roleFamily === FAMILY);
  assert.ok(full.some((p) => p.score === 32), "the never-spared reject IS in the contaminated curve");
  assert.ok(!byScore.has(32), "…but not in the clean arm");
});

test("no holdout records → an empty clean arm, never a crash", () => {
  // A workspace that has never run a holdout wave.
  const ids = heldOutEntryIds("workspace-with-no-holdout");
  assert.equal(ids.size, 0);
  assert.deepEqual(pipelineCalibrationPairs("workspace-with-no-holdout", { onlyEntryIds: ids }), []);
});
