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
import {
  screenWaveApprovalToken,
  verifyScreenWaveApprovalToken,
  isScreenWaveApprovalSpent,
  resetScreenWaveApprovalSpendForTests,
  SCREEN_WAVE_APPROVAL_MAX_AGE_MS,
} from "./screen-wave-approval.ts";
import { listDecisionRecords, heldOutEntryIds } from "./decision-record-store.ts";
import { PLACEHOLDER_APPROVER } from "./auth/operator-approver.ts";

after(() => cleanupUnitDb());

let seq = 0;
/** One Screened entry. archetype "bau" is known AND not fairness-protected, so only
 *  the guard under test can save the candidate. */
function seed(jobId: string, label: string, matchScore: number | null, archetype = "bau", roleFamily?: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `swg-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "Guard Test Role",
    stage: "Screened",
    matchScore,
    archetype,
    roleFamily,
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

// --- 5. the approval has to be SOMEBODY'S (gap G5) ---------------------------
//
// The four guards above prove an approval covers this cohort and is recent. None
// of them proves it was anyone's. With no signed-in user and no KP_OPERATOR_NAME,
// `approvedBy` falls back to the posture string and the wave used to seal the
// adverse record to it — 66 such records on the 08-17 host — under a /trust page
// claiming each record carries a named human. The commit is now refused instead.

test("a commit whose approver cannot be named is refused, and the cohort is untouched", async () => {
  // The unnamed deployment is the CASE UNDER TEST, so it is established here
  // rather than inherited: a developer with KP_OPERATOR_NAME exported would
  // otherwise watch this pass for the wrong reason.
  delete process.env.KP_OPERATOR_NAME;
  const jobId = "swg-job-unnamed";
  const low = seed(jobId, "Unattributed Reject", 11);
  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  assert.equal(preview.decisions.find((d) => d.entryId === low.id)!.action, "reject", "precondition: the wave would reject");

  // Exactly what the route sends from an unattributed deployment: `resolveApprover()`
  // finds no signed-in user and no KP_OPERATOR_NAME, so it returns the posture string.
  // The token itself is valid, which isolates attribution from every other guard.
  await assert.rejects(
    () =>
      runScreenWave(jobId, RULE, {
        dryRun: false,
        approval: { approvedBy: PLACEHOLDER_APPROVER, token: preview.approvalToken },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ScreenWaveApprovalError, `expected the 409 path, got ${String(err)}`);
      // Actionable, and it names BOTH doors — a reader must not have to read the
      // source to learn how to make the seal attributable.
      assert.match(err.message, /KP_OPERATOR_NAME/, "the refusal must name the deployment setting to fill");
      assert.match(err.message, /sign in/i, "and the identity that makes it unnecessary");
      return true;
    }
  );
  assert.equal(getPipelineEntry(low.id)!.status, "active", "an unattributable rejection must not be committed");
  assert.equal(listDecisionRecords({ candidateRef: low.id }).length, 0, "and nothing may be sealed");

  // The same cohort commits once the approver has a name — the guard is about
  // attribution, not about blocking the wave.
  const named = await runScreenWave(jobId, RULE, {
    dryRun: false,
    approval: { approvedBy: "Petra Nováková", token: preview.approvalToken },
  });
  assert.equal(named.rejected, 1);
  assert.equal(getPipelineEntry(low.id)!.status, "rejected");
});

test("a PREVIEW still runs for an operator who cannot be named", async () => {
  // A dry run writes nothing, so refusing it would only hide from an operator the
  // very list they are being asked to take responsibility for.
  const jobId = "swg-job-unnamed-preview";
  const low = seed(jobId, "Preview Only", 9);
  const preview = await runScreenWave(jobId, RULE, { dryRun: true });
  assert.equal(preview.decisions.find((d) => d.entryId === low.id)!.action, "reject");
  assert.equal(getPipelineEntry(low.id)!.status, "active");
});

// --- 6. THE SEAL ATTESTS THE POLICY THE APPROVAL BOUND ------------------------
//
// The wave signs its approval token over a policyVersion that carries the family-floor
// map and the holdout rate — "the holdout rate rides the policyVersion so the sealed
// record attests to the rate in force" is the wave's own comment. But the auto-reject
// seal REBUILT a shorter string, bottom<pct>/maxMatch<this candidate's floor>, dropping
// both suffixes and substituting a per-candidate number for the global one. So a reject
// record could not be joined back to the approval that authorized it, nor to the holdout
// seals of the same wave — the two arms of one audit trail attested to two policies.
//
// The join is the assertion: the record's own policyVersion, fed back to the approval
// verifier with the record's own subject, must re-derive the token the recruiter approved.

test("an auto-reject record joins back to its approval — the sealed policyVersion IS the one the token bound", async () => {
  resetScreenWaveApprovalSpendForTests();
  const jobId = "swg-job-policy-join";
  const low = seed(jobId, "Policy Join Low", 12, "bau", "software_engineering");
  // A family floor makes the wave policy carry a suffix the old seal dropped, so the two
  // strings are genuinely different and the join is a real test rather than a tautology.
  const rule = {
    autoRejectEnabled: true,
    rejectBottomPercent: 100,
    maxMatchToReject: 50,
    holdoutPercent: 0,
    familyFloors: { software_engineering: 70 },
  };
  const preview = await runScreenWave(jobId, rule, { dryRun: true });
  assert.equal(preview.rejected, 1, "precondition: the wave would reject exactly this candidate");

  const committed = await runScreenWave(jobId, rule, {
    dryRun: false,
    approval: { approvedBy: "Unit Test Approver", token: preview.approvalToken },
  });
  assert.equal(committed.rejected, 1);

  const sealed = listDecisionRecords({ candidateRef: low.id }).find((r) => r.kind === "auto_rejected")!;
  assert.ok(sealed, "the rejection is sealed");
  // THE JOIN: re-derive the approval signature from the RECORD's policy string. Pre-fix
  // this failed with reason "mismatch" — the record named a policy no token ever signed.
  const check = verifyScreenWaveApprovalToken(preview.approvalToken, jobId, sealed.policyVersion, [low.id]);
  assert.deepEqual(
    check,
    { ok: true },
    `the sealed policyVersion must re-derive the approval; got ${JSON.stringify(check)} for "${sealed.policyVersion}"`
  );
  assert.match(sealed.policyVersion, /\/fam:software_engineering=70/, "the family-floor map the approval covered is attested, not dropped");

  // The per-candidate EFFECTIVE floor is not lost — it moved to where a per-record number
  // belongs. policyVersion identifies the POLICY; inputs identify this run of it.
  const inputs = (JSON.parse(sealed.payloadJson) as { inputs: { threshold?: unknown } }).inputs;
  assert.equal(inputs.threshold, 70, "the floor this candidate was actually judged against rides the sealed inputs");
});

// --- 7. AN APPROVAL IS SPENT ONCE --------------------------------------------
//
// The token is a pure function of (job, policy, set, issuedAt), so re-POSTing a commit
// inside the 15-minute window re-derives the same signature and passes verify, freshness
// and attribution a second time. The only thing that stopped a replay was the first commit
// having emptied the cohort — an accident of the wave's own side effect, asserted by
// nothing, and absent from every wave that leaves part of its set standing.

test("a re-posted commit is refused with reason 'spent' - one review authorizes one wave", async () => {
  resetScreenWaveApprovalSpendForTests();
  const jobId = "swg-job-replay";
  // A wave whose set SURVIVES its own commit is what exposes the hole. holdoutPercent 100
  // spares every would-be reject for the calibration arm: the commit seals a holdout record
  // each and leaves the cohort exactly as the preview found it (active, Screened), so the
  // re-derived reject set - and therefore the token - still matches on a re-post. This is
  // not a contrived shape: a seal failure and a mid-wave stage drift leave part of a
  // reviewed set standing the same way. The reason the old double-commit "failed" was that
  // the ordinary wave happened to empty its own cohort; nothing asserted it, and here it
  // does not happen.
  const rule = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 50, holdoutPercent: 100 };
  const low = seed(jobId, "Replay Low", 10);
  const preview = await runScreenWave(jobId, rule, { dryRun: true });
  assert.equal(preview.decisions.find((d) => d.entryId === low.id)!.reasonCode, "holdout", "precondition: spared, not rejected");

  const commitOnce = (token: string) =>
    runScreenWave(jobId, rule, { dryRun: false, approval: { approvedBy: "Unit Test Approver", token } });
  await commitOnce(preview.approvalToken);
  assert.equal(listDecisionRecords({ candidateRef: low.id }).length, 1, "the reviewed wave sealed once");

  // Re-post the SAME body. Nothing about the token has changed and it is still inside its
  // window - only the fact that it has already been committed stands in the way.
  await assert.rejects(
    () => commitOnce(preview.approvalToken),
    (err: unknown) => {
      assert.ok(err instanceof ScreenWaveApprovalError, `expected the 409 path, got ${String(err)}`);
      assert.equal(err.reason, "spent", "the refusal names WHICH refusal it is, so a client can branch on it");
      assert.match(err.message, /already been committed/i);
      return true;
    }
  );
  // NON-VACUITY: pre-fix the replay ran the whole wave a second time and sealed a duplicate
  // record for the same decision - one human review, two entries in an append-only chain.
  assert.equal(listDecisionRecords({ candidateRef: low.id }).length, 1, "the replay sealed nothing further");
  assert.equal(getPipelineEntry(low.id)!.status, "active");
});

test("a commit refused for an unnamed approver leaves the review UNSPENT (a fixable refusal costs no re-preview)", async () => {
  resetScreenWaveApprovalSpendForTests();
  delete process.env.KP_OPERATOR_NAME;
  const jobId = "swg-job-unspent";
  const low = seed(jobId, "Unspent Low", 9);
  const preview = await runScreenWave(jobId, RULE, { dryRun: true });

  await assert.rejects(() =>
    runScreenWave(jobId, RULE, { dryRun: false, approval: { approvedBy: PLACEHOLDER_APPROVER, token: preview.approvalToken } })
  );
  assert.equal(isScreenWaveApprovalSpent(preview.approvalToken), false, "the token was never burned by a refusal");

  const named = await commit(jobId, preview.approvalToken);
  assert.equal(named.rejected, 1, "the same review commits once the approver has a name");
  assert.equal(getPipelineEntry(low.id)!.status, "rejected");
  assert.equal(isScreenWaveApprovalSpent(preview.approvalToken), true, "and is spent by the commit that used it");
});

// --- 8. A FAILED HOLDOUT SEAL DOES NOT CLAIM THE ARM -------------------------
//
// heldOutEntryIds derives the calibration clean arm from the sealed holdout rows and from
// nothing else. The holdout seal ran through sealDecisionSafe with NO failure branch, so an
// unwritable chain dropped the candidate from the arm while the wave still handed the
// recruiter a row reading "kept as a calibration holdout" — silent contamination of the one
// arm whose entire purpose is to be uncontaminated, reported as if it had worked.

test("a holdout whose record cannot be sealed is counted in sealFailures and the row does not claim the arm", async () => {
  resetScreenWaveApprovalSpendForTests();
  const jobId = "swg-job-holdout-sealfail";
  // holdoutPercent 100 spares the whole would-be reject set (selectHoldout is a pure
  // function of (jobId, entryId), so this is the one rate with a deterministic membership).
  const rule = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 50, holdoutPercent: 100 };
  const spared = seed(jobId, "Holdout Seal Fail", 11);
  const preview = await runScreenWave(jobId, rule, { dryRun: true });
  const previewRow = preview.decisions.find((d) => d.entryId === spared.id)!;
  assert.equal(previewRow.reasonCode, "holdout", "precondition: this candidate is a calibration holdout");
  assert.equal(preview.rejected, 0, "precondition: sparing removed them from the reject set");

  // Same unwritable-chain simulation the reject-seal guard uses (test 3).
  const side = openStore();
  side.exec(`ALTER TABLE decision_records RENAME TO decision_records_offline`);
  let committed;
  try {
    committed = await runScreenWave(jobId, rule, {
      dryRun: false,
      approval: { approvedBy: "Unit Test Approver", token: preview.approvalToken },
    });
  } finally {
    side.exec(`ALTER TABLE decision_records_offline RENAME TO decision_records`);
    side.close();
  }

  assert.equal(committed.sealFailures, 1, "the unsealed holdout is counted, not swallowed into a console.warn");
  const row = committed.decisions.find((d) => d.entryId === spared.id)!;
  assert.equal(row.action, "keep", "the sparing itself still stands — they were outside the approved reject set");
  assert.equal(row.reasonCode, "holdoutSealFailed", "and the row must NOT claim an arm the candidate is not in");
  assert.doesNotMatch(row.rationale, /kept as a calibration holdout/i);
  assert.equal(getPipelineEntry(spared.id)!.status, "active", "a failed holdout costs a data point, never a person");
  assert.equal(heldOutEntryIds().has(spared.id), false, "the clean arm and the row agree: this candidate is not in it");
});
