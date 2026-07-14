// Behavioral coverage for the calibration DRILLDOWN producer (Direction 2):
// pipelineCalibrationBandCandidates must return the candidates in one score band
// under the SAME inclusion rule as pipelineCalibrationPairs (advanced=1 /
// rejected-at-gate=0, pending & unscored excluded), workspace-scoped, with a
// `live` flag that is false for a terminal (rejected) entry. Also pins that every
// calibration pair now carries its `at` timestamp (Direction 1 drift cohorts).
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts stays first import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  pipelineCalibrationBandCandidates,
  pipelineCalibrationPairs,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

const FIXTURE_FAMILY = "cal_band_family";

let seq = 0;
function addEntry(matchScore: number | null) {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `cb-c${seq}`,
    candidateLabel: `Band Tester ${seq}`,
    roleFamily: FIXTURE_FAMILY,
    jobId: `cb-job-${seq}`,
    jobTitle: "Band Test Role",
    matchScore,
  });
  assert.equal(created, true);
  return entry;
}

test("band drilldown returns the [70,80) candidates under the calibration inclusion rule", () => {
  const advanced = addEntry(72); // outcome 1, live (advanced past the gate)
  assert.ok(actOnPipelineEntry(advanced.id, "accept"));

  const rejected = addEntry(74); // outcome 0, NOT live (terminal reject at the gate)
  assert.ok(actOnPipelineEntry(rejected.id, "reject"));

  addEntry(76); // pending at the gate — excluded (no outcome yet)
  addEntry(30); // different band — must not appear in [70,80)

  const rows = pipelineCalibrationBandCandidates(70, 80, false, FIXTURE_FAMILY).filter(
    (c) => c.roleFamily === FIXTURE_FAMILY
  );
  const byLabel = new Map(rows.map((c) => [c.label, c]));

  assert.equal(rows.length, 2, "only the decided [70,80) entries — no pending, no other band");
  assert.equal(byLabel.get("Band Tester 1")?.outcome, 1);
  assert.equal(byLabel.get("Band Tester 1")?.live, true, "an advanced entry is still openable");
  assert.equal(byLabel.get("Band Tester 2")?.outcome, 0);
  assert.equal(byLabel.get("Band Tester 2")?.live, false, "a rejected (terminal) entry is listed but not linkable");
});

test("the top band includes a perfect 100 only when inclusiveHi is set", () => {
  const perfect = addEntry(100);
  assert.ok(actOnPipelineEntry(perfect.id, "accept"));

  const exclusive = pipelineCalibrationBandCandidates(90, 100, false, FIXTURE_FAMILY).filter((c) => c.score === 100);
  assert.equal(exclusive.length, 0, "a half-open [90,100) band excludes exactly 100");

  const inclusive = pipelineCalibrationBandCandidates(90, 100, true, FIXTURE_FAMILY).filter((c) => c.score === 100);
  assert.equal(inclusive.length, 1, "the last bin includes 100");
});

test("every calibration pair carries its created_at timestamp (drift cohorts)", () => {
  const pairs = pipelineCalibrationPairs().filter((p) => p.roleFamily === FIXTURE_FAMILY);
  assert.ok(pairs.length > 0);
  assert.ok(
    pairs.every((p) => typeof p.at === "string" && !Number.isNaN(new Date(p.at).getTime())),
    "each pair's `at` is a valid ISO timestamp the cohort bucketer can read"
  );
});
