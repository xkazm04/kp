// Behavioral coverage for the screening wave's IRREVERSIBILITY GUARDS — the four
// craft-scan findings that all sit on the same commit path (docs/harness/
// craft-scan-2026-08-20/FINDINGS.md):
//
//   1. a REINSTATED candidate is not re-rejected (and re-emailed) by the next run;
//   2. an approval token has a STALENESS WINDOW — a review is of a moment;
//   3. the Art. 22 SEAL is a PRECONDITION of the rejection, not a side effect;
//   4. the sealed inputs carry the SCORE-STALENESS caveat the preview showed.
//
// Runner: npm run test:unit  (testing/unit-db.ts must stay the first project import)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { openStore } from "./db-path.ts";
import { createPipelineEntry, getPipelineEntry, reinstatePipelineEntry } from "./db/pipeline.ts";
import { saveJd, updateJd } from "./db/jobs.ts";
import { saveAnalysis } from "./db/analyses.ts";
import { runScreenWave, ScreenWaveApprovalError } from "./screen-wave.ts";
import { screenWaveApprovalToken, SCREEN_WAVE_APPROVAL_MAX_AGE_MS } from "./screen-wave-approval.ts";
import { listDecisionRecords } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

let seq = 0;
/** One Screened entry. archetype "bau" is known AND not fairness-protected, so only
 *  the guard under test can save the candidate. */
function seed(jobId: string, label: string, matchScore: number | null, archetype = "bau") {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `swg-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "Guard Test Role",
    stage: "Screened",
    matchScore,
    archetype,
    contact: `swg-c${seq}@example.com`,
  });
  return entry;
}

// holdoutPercent: 0 keeps the reject set exactly "everyone below the floor" (no
// calibration sparing) AND keeps the policyVersion below reproducible in the test.
const RULE = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 50, holdoutPercent: 0 };
// The policyVersion runScreenWave derives for RULE (no family floors, holdout off,
// so no suffixes) — needed to forge an out-of-window token below.
const RULE_POLICY = "screen-wave/bottom100/maxMatch50";

const commit = async (jobId: string, token: string) =>
  runScreenWave(jobId, RULE, { dryRun: false, approval: { approvedBy: "Unit Test Approver", token } });

// --- 1. reinstatement shield -------------------------------------------------

test("a reinstated candidate is spared by the next wave, with the 'reinstated' keep-reason", async () => {
  const jobId = "swg-job-reinstate";
  const rescued = seed(jobId, "Rescued Candidate", 12);
  const other = seed(jobId, "Other Low Scorer", 14);

  // Wave 1 rejects both.
  const first = await runScreenWave(jobId, RULE, { dryRun: true });
  assert.deepEqual(first.decisions.filter((d) => d.action === "reject").map((d) => d.entryId).sort(), [other.id, rescued.id].sort());
  const committed = await commit(jobId, first.approvalToken);
  assert.equal(committed.rejected, 2);
  assert.equal(getPipelineEntry(rescued.id)!.status, "rejected");

  // A recruiter overrules the machine: back to active/Screened — the wave's cohort.
  assert.ok(reinstatePipelineEntry(rescued.id, undefined, "human:Unit Test Recruiter"));
  const back = getPipelineEntry(rescued.id)!;
  assert.equal(back.status, "active");
  assert.equal(back.stage, "Screened");

  // Wave 2, same unchanged rule and unchanged score: they are NOT re-rejected.
  const second = await runScreenWave(jobId, RULE, { dryRun: true });
  const row = second.decisions.find((d) => d.entryId === rescued.id)!;
  assert.equal(row.action, "keep", "a rescued candidate must not be re-rejected on the same evidence");
  assert.equal(row.reasonCode, "reinstated");
  assert.match(row.rationale, /^reinstated — /, "byte-pinned keep-reason register");
  assert.equal(second.rejected, 0, "nobody else is left to reject");

  // …and committing wave 2 leaves them active with no SECOND sealed rejection and
  // no second rejection email (the auto_rejected record count does not grow).
  const sealedBefore = listDecisionRecords({ candidateRef: rescued.id }).filter((r) => r.kind === "auto_rejected").length;
  const secondCommit = await commit(jobId, second.approvalToken);
  assert.equal(secondCommit.rejected, 0);
  assert.equal(getPipelineEntry(rescued.id)!.status, "active");
  assert.equal(listDecisionRecords({ candidateRef: rescued.id }).filter((r) => r.kind === "auto_rejected").length, sealedBefore);
});

// --- 2. approval staleness window --------------------------------------------

test("an approval token older than the window is refused (409 path), and the cohort is untouched", async () => {
  const jobId = "swg-job-stale-token";
  const low = seed(jobId, "Stale Token Low", 10);

  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  assert.equal(preview.rejected, 1);

  // Same job, same policy, same reject set — only the issue time is old.
  const expired = screenWaveApprovalToken(jobId, RULE_POLICY, [low.id], Date.now() - SCREEN_WAVE_APPROVAL_MAX_AGE_MS - 60_000);
  await assert.rejects(() => commit(jobId, expired), (err: unknown) => {
    assert.ok(err instanceof ScreenWaveApprovalError);
    assert.match((err as Error).message, /expired/i);
    return true;
  });
  assert.equal(getPipelineEntry(low.id)!.status, "active", "a stale approval must not commit an irreversible rejection");

  // A fresh preview token from a moment ago still commits.
  const ok = await commit(jobId, preview.approvalToken);
  assert.equal(ok.rejected, 1);
  assert.equal(getPipelineEntry(low.id)!.status, "rejected");
});

// --- 3. seal is a precondition of the rejection ------------------------------

test("a candidate whose Art. 22 record cannot be sealed is KEPT and counted, never rejected unrecorded", async () => {
  const jobId = "swg-job-sealfail";
  const low = seed(jobId, "Seal Fail Low", 11);

  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  assert.equal(preview.rejected, 1);
  assert.equal(preview.sealFailures, 0, "a dry run seals nothing");

  // Simulate an unwritable decision chain (missing key / schema drift / lock) the
  // only way that reaches the real code path: take the table out from under the
  // store's cached connection. sealDecisionSafe swallows the error and returns null,
  // which is precisely the condition the wave must now refuse to reject through.
  const side = openStore();
  side.exec(`ALTER TABLE decision_records RENAME TO decision_records_offline`);
  let committed;
  try {
    committed = await commit(jobId, preview.approvalToken);
  } finally {
    side.exec(`ALTER TABLE decision_records_offline RENAME TO decision_records`);
    side.close();
  }

  assert.equal(committed.rejected, 0, "no rejection may be applied without its sealed record");
  assert.equal(committed.sealFailures, 1, "the gap is counted into the wave summary, not swallowed into a console.warn");
  assert.equal(getPipelineEntry(low.id)!.status, "active", "status is not flipped");
  const row = committed.decisions.find((d) => d.entryId === low.id)!;
  assert.equal(row.action, "keep");
  assert.equal(row.reasonCode, "sealFailed");
  assert.equal(
    listDecisionRecords({ candidateRef: low.id }).length,
    0,
    "and nothing was sealed for them either — the record is the precondition, not a side effect"
  );

  // The chain is writable again → the same wave commits normally.
  const retryPreview = await runScreenWave(jobId, RULE, { dryRun: true });
  const retry = await commit(jobId, retryPreview.approvalToken);
  assert.equal(retry.rejected, 1);
  assert.equal(retry.sealFailures, 0);
  assert.equal(listDecisionRecords({ candidateRef: low.id }).filter((r) => r.kind === "auto_rejected").length, 1);
});

// --- 4. the sealed record carries the staleness caveat ------------------------

type SealedInputs = { stale?: unknown; staleSince?: unknown; score?: unknown };
const sealedInputs = (entryId: string): SealedInputs => {
  const rec = listDecisionRecords({ candidateRef: entryId }).find((r) => r.kind === "auto_rejected")!;
  return (JSON.parse(rec.payloadJson) as { inputs: SealedInputs }).inputs;
};

test("a fresh score seals an explicit stale:false — the record affirms freshness rather than staying silent", async () => {
  const jobId = "swg-job-fresh";
  const low = seed(jobId, "Fresh Score Low", 13);
  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  await commit(jobId, preview.approvalToken);
  const inputs = sealedInputs(low.id);
  assert.equal(inputs.stale, false);
  assert.equal(inputs.staleSince, undefined);
  assert.equal(inputs.score, 13);
});

test("a score computed before the JD's last edit seals the staleness caveat the preview showed", async () => {
  // A JD-backed job whose candidate has an analysis fit, then the JD is edited —
  // exactly the isScoreStale rule the preview chip renders.
  const { slug } = saveJd({ title: "Guard Stale Role", body: "original body" });
  const jobId = `jd-${slug}`;
  const low = seed(jobId, "Stale Score Low", 15);
  saveAnalysis({ candidateLabel: "Stale Score Low", jdSlug: slug, score: 15, roleFamily: null, seniority: null, payload: {} });
  // The revision snapshot must be strictly LATER than the analysis timestamp;
  // both are ISO-millisecond stamps, so wait for the clock to tick over.
  const t = Date.now();
  while (Date.now() === t) {
    /* spin one millisecond */
  }
  assert.deepEqual(updateJd(slug, { title: "Guard Stale Role", body: "edited body" }), { ok: true });

  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  const previewRow = preview.decisions.find((d) => d.entryId === low.id)!;
  assert.equal(previewRow.stale, true, "precondition: the preview shows the staleness chip");

  await commit(jobId, preview.approvalToken);
  const inputs = sealedInputs(low.id);
  assert.equal(inputs.stale, true, "the immutable record carries the caveat, not just the preview");
  assert.equal(inputs.staleSince, previewRow.staleSince);
});
