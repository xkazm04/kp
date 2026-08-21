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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// ─── The clean arm reaches the RECOMMENDER, on both paths ─────────────────────
// craft-scan 2026-08-20 — the arm existed and was wired into the display curve, but
// `recommendScreeningThreshold` was still fed the contaminated pairs for its
// below-floor band, where every entry is a reject the score itself produced. The
// unit behaviour is pinned in calibration.test.ts; what a source guard adds is that
// BOTH call sites — the display route and the one-click apply — pass the clean arm,
// and pass it identically, so the applied value can never differ from the shown one.
function routeSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("both recommender call sites feed it the clean arm, derived the same way", () => {
  for (const [name, rel] of [
    ["display", "../api/analytics/calibration/route.ts"],
    ["apply", "../api/analytics/calibration/apply-threshold/route.ts"],
  ] as const) {
    const src = routeSource(rel);
    assert.match(
      src,
      /recommendScreeningThreshold\(pairs, holdoutPairs, currentThreshold\)/,
      `the ${name} route must pass the holdout arm as the below-floor band`
    );
    assert.match(
      src,
      /pipelineCalibrationPairs\(ws, \{ onlyEntryIds: heldOutEntryIds\(ws\), outcome: "advance" \}\)/,
      `the ${name} route must build that arm from the spared entries on the advance axis`
    );
  }
});

test("the threshold-apply seal names the real approver, not a role or an env constant", () => {
  // A change to the live auto-reject floor is the policy deciding who the machine may
  // reject. The sibling screen-wave route was fixed for exactly this reason.
  const src = routeSource("../api/analytics/calibration/apply-threshold/route.ts");
  assert.match(src, /const approvedBy = await resolveApprover\(\)/, "the approver must be resolved from the session");
  assert.match(src, /const actor = await humanActor\(\)/, "the chain actor must name the person when there is one");
  assert.doesNotMatch(src, /operatorApprover\(\)/, "operatorApprover is the fallback INSIDE resolveApprover, not the call site");
  assert.doesNotMatch(src, /"human:operator"/, "the seal must not hardcode a role token");
});
