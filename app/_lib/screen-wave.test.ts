// Behavioral coverage for the screening wave's NULL-SCORE POLICY (SD-L1-002 /
// REC-03, backlog #31) against an ISOLATED throwaway DB (testing/unit-db.ts must
// stay the first project import).
//
// The bug this pins closed: `matchScore ?? 0` fabricated a genuine-looking
// "match 0" for a never-scored candidate, who then ranked worst, passed
// `0 < maxMatchToReject`, was auto-rejected by the wave, and had "match 0"
// SEALED permanently into the immutable Art. 22 decision chain (Lucie's L2 run
// reproduced this end-to-end). Fail-closed contract now under test:
//   - an unscored candidate is NEVER auto-rejected, at ANY threshold;
//   - they surface as an explicit "unscored" keep outcome (visible in preview
//     and committed views), eligible for scoring — not a phantom row;
//   - a committed wave writes NOTHING for them (no status flip, no sealed record);
//   - a sealed record for a genuinely-scored reject carries the TRUE score.
//
// The preview-first machinery (dry-run → approval token → commit) is exercised
// as-is — these tests ride through it, they do not bypass it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { runScreenWave, UNSCORED_KEEP_RATIONALE } from "./screen-wave.ts";
import { listDecisionRecords } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

let seq = 0;
/** Seed one Screened entry. `matchScore: null` = unscored; archetype defaults to
 *  "bau" (known + NOT fairness-protected) so ONLY the null-score policy — not the
 *  archetype shield — can save an unscored candidate, exactly the L2 repro. */
function seed(jobId: string, label: string, matchScore: number | null, archetype = "bau") {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `sw-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "Screen Wave Test Role",
    stage: "Screened",
    matchScore,
    archetype,
    contact: `sw-c${seq}@example.com`,
  });
  return entry;
}

const AGGRESSIVE = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 100 };

test("an unscored candidate is never auto-rejected — even at bottom 100% / threshold 100 — and gets an explicit 'unscored' outcome", async () => {
  const jobId = "sw-job-nullsafe";
  seed(jobId, "Low Scorer", 12);
  seed(jobId, "Mid Scorer", 40);
  const unscored = seed(jobId, "Never Scored", null);

  const wave = await runScreenWave(jobId, AGGRESSIVE, { dryRun: true });

  // The full cohort is reported and listed — the unscored row is named, not hidden.
  assert.equal(wave.cohort, 3);
  assert.equal(wave.decisions.length, 3);

  // Both genuinely-scored BAU candidates are reject-eligible at these settings…
  const rejects = wave.decisions.filter((d) => d.action === "reject");
  assert.deepEqual(rejects.map((d) => d.label).sort(), ["Low Scorer", "Mid Scorer"]);

  // …but the unscored candidate is an explicit keep with the unscored outcome —
  // never "match 0" (the fabricated number a human gate could not tell apart
  // from a genuine zero).
  const row = wave.decisions.find((d) => d.entryId === unscored.id);
  assert.ok(row, "the unscored candidate must appear in the wave's decisions");
  assert.equal(row.action, "keep");
  assert.equal(row.reasonCode, "unscored");
  assert.equal(row.matchScore, null, "no fabricated score on the row");
  assert.equal(row.rationale, UNSCORED_KEEP_RATIONALE);
  assert.ok(!/match 0/.test(row.rationale), "the rationale must not claim a measurement");
});

test("a committed wave rejects only measured candidates; the unscored entry stays active with no sealed record", async () => {
  const jobId = "sw-job-commit";
  const low = seed(jobId, "Commit Low", 12);
  seed(jobId, "Commit High", 90);
  const unscored = seed(jobId, "Commit Unscored", null);

  // Preview-first: the commit must carry the token of the exact previewed set.
  const preview = await runScreenWave(jobId, { autoRejectEnabled: true, rejectBottomPercent: 50, maxMatchToReject: 45 }, { dryRun: true });
  assert.deepEqual(
    preview.decisions.filter((d) => d.action === "reject").map((d) => d.entryId),
    [low.id],
    "bottom 50% of the SCORED pair (n=2 → 1) below 45 is exactly the low scorer"
  );

  const committed = await runScreenWave(
    jobId,
    { autoRejectEnabled: true, rejectBottomPercent: 50, maxMatchToReject: 45 },
    { dryRun: false, approval: { approvedBy: "Unit Test Approver", token: preview.approvalToken } }
  );
  assert.equal(committed.rejected, 1);

  // The measured low scorer is out; the unscored candidate is untouched and
  // still visible as an explicit unscored keep in the committed view.
  assert.equal(getPipelineEntry(low.id)!.status, "rejected");
  const still = getPipelineEntry(unscored.id)!;
  assert.equal(still.status, "active");
  assert.equal(still.stage, "Screened");
  const keptRow = committed.decisions.find((d) => d.entryId === unscored.id)!;
  assert.equal(keptRow.reasonCode, "unscored");

  // Sealed record honesty: the reject's record carries the TRUE score (12), and
  // the never-measured candidate has NO adverse record at all.
  const sealed = listDecisionRecords({ candidateRef: low.id });
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0].kind, "auto_rejected");
  assert.match(sealed[0].rationale, /match 12 < 45/);
  const payload = JSON.parse(sealed[0].payloadJson) as { inputs?: { score?: unknown } };
  assert.equal(payload.inputs?.score, 12, "the sealed inputs carry the genuine measurement");
  assert.equal(listDecisionRecords({ candidateRef: unscored.id }).length, 0, "nothing is ever sealed for an unscored candidate");
});

test("an all-unscored cohort commits to zero rejections — no fabricated-0 fallback when nobody was measured", async () => {
  const jobId = "sw-job-allnull";
  const a = seed(jobId, "Nobody Scored A", null);
  const b = seed(jobId, "Nobody Scored B", null);

  const preview = await runScreenWave(jobId, AGGRESSIVE, { dryRun: true });
  assert.equal(preview.rejected, 0);
  assert.ok(preview.decisions.every((d) => d.action === "keep" && d.reasonCode === "unscored" && d.matchScore === null));

  const committed = await runScreenWave(jobId, AGGRESSIVE, {
    dryRun: false,
    approval: { approvedBy: "Unit Test Approver", token: preview.approvalToken },
  });
  assert.equal(committed.rejected, 0);
  assert.equal(committed.cohort, 2);
  for (const e of [a, b]) {
    assert.equal(getPipelineEntry(e.id)!.status, "active");
    assert.equal(listDecisionRecords({ candidateRef: e.id }).length, 0);
  }
});

test("the bottom-% math runs over the scored cohort only — an unscored entry neither pads the pool nor occupies a bottom rank", async () => {
  const jobId = "sw-job-basis";
  // Scored: 10, 20, 30, 90. Unscored: one. Old behavior: n=5 → bottom 40% = 2,
  // with the unscored ranked WORST as "0" — it would take a reject slot. New:
  // n=4 scored → bottom 40% floor = 1 → exactly the genuine worst (10).
  seed(jobId, "Basis 10", 10);
  seed(jobId, "Basis 20", 20);
  seed(jobId, "Basis 30", 30);
  seed(jobId, "Basis 90", 90);
  seed(jobId, "Basis Unscored", null);

  const wave = await runScreenWave(jobId, { autoRejectEnabled: true, rejectBottomPercent: 40, maxMatchToReject: 45 }, { dryRun: true });
  const rejects = wave.decisions.filter((d) => d.action === "reject");
  assert.deepEqual(rejects.map((d) => d.label), ["Basis 10"]);
  // The reject rationale names the scored basis (of 4), not a padded 5.
  assert.match(rejects[0].rationale, /of 4/);
  assert.equal(wave.cohort, 5, "the reported cohort still counts everyone listed");
});
