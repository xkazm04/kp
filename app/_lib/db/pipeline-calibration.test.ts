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
// UAT KAT-L1-003 — a second family so the hire-axis fixtures cannot perturb the
// advance-axis assertions above (and vice versa).
const HIRED_FAMILY = "cal_hired_family";

let seq = 0;
function addEntry(matchScore: number | null, family: string = FIXTURE_FAMILY) {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `cal-c${seq}`,
    candidateLabel: `Calibration Tester ${seq}`,
    roleFamily: family,
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

// ─── The hire axis (UAT KAT-L1-003, recurrence 2) ─────────────────────────────
// The defect: `outcome 1 = stage past the screen gate` made Interview, Offer and
// Hired ONE success label, so „did the 90 %-match candidates actually get HIRED,
// or just get an interview?" had no answer. These pin that the second axis really
// separates them, and that it stays honest about who it excludes.

test("the hire axis scores ONLY a reached-Hired entry as a success", () => {
  // Reaches Hired: Screened → Interview → Offer → Hired.
  const hired = addEntry(88, HIRED_FAMILY);
  for (let step = 0; step < 3; step += 1) assert.ok(actOnPipelineEntry(hired.id, "accept"));

  // Interviewed and still there: a SUCCESS on the advance axis, and on the hire
  // axis not an outcome at all — they may yet be hired. This single entry is the
  // whole finding.
  const interviewing = addEntry(90, HIRED_FAMILY);
  assert.ok(actOnPipelineEntry(interviewing.id, "accept"));

  // Rejected AT interview: advance axis says 1 (the screen gate did advance them),
  // hire axis says 0 (they were not hired). The two axes must disagree here.
  const rejectedAtInterview = addEntry(70, HIRED_FAMILY);
  assert.ok(actOnPipelineEntry(rejectedAtInterview.id, "accept"));
  assert.ok(actOnPipelineEntry(rejectedAtInterview.id, "reject"));

  // Rejected at the gate: 0 on both axes.
  const rejectedAtGate = addEntry(32, HIRED_FAMILY);
  assert.ok(actOnPipelineEntry(rejectedAtGate.id, "reject"));

  const advance = new Map(
    pipelineCalibrationPairs()
      .filter((p) => p.roleFamily === HIRED_FAMILY)
      .map((p) => [p.score, p.outcome])
  );
  const hire = new Map(
    pipelineCalibrationPairs(undefined, { outcome: "hired" })
      .filter((p) => p.roleFamily === HIRED_FAMILY)
      .map((p) => [p.score, p.outcome])
  );

  assert.deepEqual([...advance.entries()].sort((a, b) => a[0] - b[0]), [
    [32, 0],
    [70, 1],
    [88, 1],
    [90, 1],
  ]);
  assert.deepEqual(
    [...hire.entries()].sort((a, b) => a[0] - b[0]),
    [
      [32, 0],
      [70, 0],
      [88, 1],
    ],
    "only the reached-Hired entry is a success; the interview reject flips to 0; the still-interviewing candidate has no outcome yet"
  );
  assert.ok(!hire.has(90), "still in the process is EXCLUDED, never a fabricated 0 — they may still be hired");
});

test("the hire axis reads the terminal ROLE, not the string 'Hired' (G8)", () => {
  // The producer derives its positive set from the workspace axis' terminal role,
  // so a renamed or re-ordered column still counts the same people. Pinned at the
  // source because the axis is per-workspace data the unit DB does not vary.
  const src = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./pipeline.ts"),
    "utf8"
  );
  assert.match(src, /stagesWithRole\("terminal", axis\)/, "the hire label must be role-derived");
  assert.doesNotMatch(
    src,
    /calibrationHiredStages[\s\S]{0,200}"Hired"/,
    "the hire label must never be a literal stage name"
  );
});

test("a non-merit exit is excluded from BOTH axes, never counted as 'not hired'", () => {
  // A closed role is a timing event, not a verdict on the candidate — counting it
  // as a hire-axis 0 would blame the score for a decision nobody made about them.
  const roleClosed = addEntry(64, HIRED_FAMILY);
  assert.equal(closeEntriesByJobId(roleClosed.jobId!), 1);
  for (const outcome of ["advance", "hired"] as const) {
    const scores = pipelineCalibrationPairs(undefined, { outcome })
      .filter((p) => p.roleFamily === HIRED_FAMILY)
      .map((p) => p.score);
    assert.ok(!scores.includes(64), `${outcome}: a role-closed entry must not enter`);
  }
});

test("the hire axis has a much lower base rate, and the honesty gate is per arm", () => {
  // The arithmetic guardrail: a hire cohort is small and mostly negative, so its
  // base rate p(1−p) is small too. Nothing here may manufacture a flattering
  // number out of it — the gate is `n >= minOutcomes` on THIS arm's own count.
  const hire = pipelineCalibrationPairs(undefined, { outcome: "hired" }).filter(
    (p) => p.roleFamily === HIRED_FAMILY
  );
  const advance = pipelineCalibrationPairs().filter((p) => p.roleFamily === HIRED_FAMILY);
  const rate = (ps: { outcome: number }[]) => ps.reduce((s, p) => s + p.outcome, 0) / ps.length;
  assert.ok(hire.length < advance.length, "the hire arm is a strictly smaller cohort");
  assert.ok(rate(hire) < rate(advance), "and a strictly lower base rate");
});

test("the calibration route reads the acting producer by default and labels what it measures", () => {
  const routeSrc = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../api/analytics/calibration/route.ts"),
    "utf8"
  );
  // Arity-tolerant on purpose: the producer now also takes the outcome axis
  // (UAT KAT-L1-003). What this assertion is about is the WORKSPACE SCOPE (P1) —
  // that the route never lets the producer fall back to its default workspace.
  assert.match(
    routeSrc,
    /pipelineCalibrationPairs\(\s*(ws|await currentWorkspace\(\))\s*[,)]/,
    "the route must read the pipeline (acting-score) producer, workspace-scoped (P1)"
  );
  // Source resolution is now three-way (UAT KAT-L1-001): pipeline is still the
  // default, analysis stays opt-in, and holdout — the calibration clean arm — is the
  // added opt-in. The default must remain pipeline for anything that isn't an
  // explicit analysis/holdout request.
  assert.match(routeSrc, /rawSource\s*===\s*"analysis"\s*\?\s*"analysis"/, "analysis stays opt-in");
  assert.match(routeSrc, /rawSource\s*===\s*"holdout"\s*\?\s*"holdout"\s*:\s*"pipeline"/, "holdout is opt-in; pipeline is the default");
  assert.ok(routeSrc.includes("measures: source"), "the response names which score the curve measures");
  // The clean arm must actually be wired: the holdout source reads only the spared
  // entries, and every source's label leakage is disclosed in the payload.
  assert.ok(routeSrc.includes("heldOutEntryIds(ws)"), "the holdout source restricts to spared entries");
  // UAT KAT-L1-003 — leakage is now per ARM (source × outcome axis): the hire axis
  // has its own causal story and must not inherit the screening one.
  assert.ok(
    routeSrc.includes("leakage: calibrationLeakage(source, outcome)"),
    "the response discloses label leakage for the arm actually computed"
  );
  // The axis must be echoed, or a fallback (the analysis producer has no stages)
  // would be rendered under the label the caller asked for rather than the one served.
  assert.match(routeSrc, /^\s*outcome,\s*$/m, "the response must echo the axis actually applied");
  assert.match(
    routeSrc,
    /source === "analysis" \? "advance"/,
    "the analysis producer pairs a disposition, not a stage: it can only answer the advance question"
  );
  // The memo must not serve an advance payload for a hire request.
  assert.match(
    routeSrc,
    /calibrationCacheKey\(ws, `\$\{source\}:\$\{outcome\}`, family\)/,
    "the cache key must carry the outcome axis"
  );
  // The screening-floor suggestion is derived from advance rates; deriving it from
  // hire rates would silently change what a floor move is defended by.
  assert.match(
    routeSrc,
    /outcome === "advance" \? recommendScreeningThreshold/,
    "the threshold recommendation stays on the advance axis"
  );
});
