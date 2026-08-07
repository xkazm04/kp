// Pins promoteSubmission's advance/hold contract (case-sim round 2 — "make the
// dev-case promote path trustworthy"; harvested from the round's winning
// submission and extended for the two canary fixes). What this guards:
//   1. The candidate-facing comm and the reviewer-facing screening_review card
//      must AGREE — the orchestrator gates its "take it forward" comm on the
//      recommendation this function returns.
//   2. One threshold: the recommendation derives from the SAME calibrated floor
//      the orchestrator promotes on (passed in), never a second hardcoded bar.
//   3. Thin evidence never auto-advances: a low propagated evidence-confidence
//      on the evaluation (models.py confidence scale) forces "hold".
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by the transitive `@/app/_lib/db` import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPosting, createSubmission, getPipelineEntry, saveSubmissionEvaluation } from "./db.ts";
import { promoteSubmission } from "./devcase-run.ts";

after(() => cleanupUnitDb());

let seq = 0;
function makeSubmission(evaluation: Record<string, unknown>, transferScore: number): string {
  seq += 1;
  const posting = createPosting({
    caseId: `case-${seq}`,
    channel: "local",
    token: `tok-${seq}`,
    roleTitle: "Backend Engineer",
    caseTitle: "Test case",
  });
  const { submission } = createSubmission({
    postingId: posting.id,
    candidateRef: `Candidate ${seq}`,
    repoRef: `repo-${seq}`,
  });
  saveSubmissionEvaluation(submission.id, evaluation, transferScore);
  return submission.id;
}

function evalBundle(overrides: { band?: string; concerns?: string[]; confidence?: number } = {}) {
  return {
    evaluation: {
      summary: "Solid work.",
      strengths: ["testing"],
      concerns: overrides.concerns ?? [],
      confidence: overrides.confidence ?? 0.8,
    },
    transfer: { transferScore: 0, roleFitRationale: "Good fit." },
    authenticity: { band: overrides.band ?? "authentic", score: 90 },
  };
}

function approvalOf(entryId: string): { recommendation?: string; redFlags?: string[] } {
  const entry = getPipelineEntry(entryId);
  assert.ok(entry, "a pipeline entry is created");
  return JSON.parse(entry!.approvalDetail ?? "{}");
}

test("a clean floor-clearing score advises advance, and card + return value agree", () => {
  const subId = makeSubmission(evalBundle(), 85);
  const result = promoteSubmission(subId, 55);
  assert.ok(result);
  assert.equal(result!.recommendation, "advance");
  assert.equal(approvalOf(result!.entryId).recommendation, "advance", "the reviewer card matches the returned verdict");
  assert.ok(result!.reasons.some((r) => r.includes("floor 55")), "the verdict explains itself against the floor it used");
});

test("the recommendation follows the CALIBRATED floor, not a second hardcoded bar", () => {
  // 60 used to sit in the advice gap: promotable (floor 55) yet advised "hold"
  // (hardcoded 70) — the say/do divergence the round's case targeted (canary c1).
  const atFloor60 = promoteSubmission(makeSubmission(evalBundle(), 60), 55);
  assert.equal(atFloor60!.recommendation, "advance", "clearing the active floor advises advance — no phantom 70 bar");
  // The same score under a RAISED floor honestly holds.
  const underRaisedFloor = promoteSubmission(makeSubmission(evalBundle(), 60), 65);
  assert.equal(underRaisedFloor!.recommendation, "hold");
});

test("authenticity-suspect overrides a strong score down to hold, visibly", () => {
  const result = promoteSubmission(makeSubmission(evalBundle({ band: "suspect" }), 92), 55);
  assert.equal(result!.recommendation, "hold");
  const approval = approvalOf(result!.entryId);
  assert.equal(approval.recommendation, "hold");
  assert.ok(
    (approval.redFlags ?? []).some((f) => /authenticity/i.test(f)),
    "the suspect-authenticity reason is visible to the reviewer"
  );
});

test("low evaluation evidence-confidence never auto-advances (canary c2)", () => {
  // A deterministic-fallback evaluation self-reports confidence 0.2 — its scores
  // are hypotheses on thin evidence, so the advice must be hold, with the reason
  // on the card.
  const result = promoteSubmission(makeSubmission(evalBundle({ confidence: 0.2 }), 88), 55);
  assert.equal(result!.recommendation, "hold");
  const approval = approvalOf(result!.entryId);
  assert.ok(
    (approval.redFlags ?? []).some((f) => /confidence/i.test(f)),
    "the low-confidence reason is visible to the reviewer"
  );
  // An absent confidence (legacy bundles) is NOT treated as low — no signal, no penalty.
  const legacy = evalBundle();
  delete (legacy.evaluation as Record<string, unknown>).confidence;
  const legacyResult = promoteSubmission(makeSubmission(legacy, 88), 55);
  assert.equal(legacyResult!.recommendation, "advance");
});
