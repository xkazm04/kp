// Behavioral coverage for onboarding-store.ts against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import). Pins the run/step
// state machine: one run per hire, checklist completion auto-closes and
// re-opens the run, intake values are bounded, the pre-boarding nudge is due
// exactly once, and the e-sign seam only signs a requested signature.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  duePreboardingReminders,
  ensureDefaultTemplate,
  getRunDetail,
  listRuns,
  listTemplates,
  markPreboardingReminded,
  markSigned,
  requestSignature,
  saveIntake,
  setTaskDone,
  startRun,
} from "./onboarding-store.ts";
import { DEFAULT_ONBOARDING_TASKS, DEFAULT_QUESTIONNAIRE } from "./onboarding.ts";

after(() => cleanupUnitDb());

const FUTURE = new Date(Date.now() + 60_000).toISOString();

test("the default template is seeded exactly once and carries the default checklist + questionnaire", () => {
  const id = ensureDefaultTemplate();
  assert.equal(ensureDefaultTemplate(), id, "re-ensuring returns the same template");
  const templates = listTemplates();
  assert.equal(templates.length, 1);
  assert.deepEqual(templates[0].tasks, DEFAULT_ONBOARDING_TASKS);
  assert.deepEqual(templates[0].questionnaire, DEFAULT_QUESTIONNAIRE);
});

test("startRun is idempotent: one run per entry, the existing run comes back", () => {
  const run = startRun({ entryId: "ob-entry-1", candidateLabel: "New Hire", jobTitle: "Role" });
  assert.equal(run.status, "active");
  const again = startRun({ entryId: "ob-entry-1" });
  assert.equal(again.id, run.id);
});

test("checking the last task completes the run; unchecking re-opens it", () => {
  const run = startRun({ entryId: "ob-entry-2" });
  const tasks = getRunDetail(run.id)!.tasks;
  assert.ok(tasks.length > 0);

  // Check all but one — still active.
  for (const task of tasks.slice(0, -1)) setTaskDone(run.id, task.id, true);
  let detail = getRunDetail(run.id)!;
  assert.equal(detail.run.status, "active");
  assert.equal(detail.progress.complete, false);

  // The final check flips the run to complete and stamps completed_at.
  detail = setTaskDone(run.id, tasks[tasks.length - 1].id, true)!;
  assert.equal(detail.run.status, "complete");
  assert.ok(detail.run.completedAt);
  assert.equal(detail.progress.pct, 100);

  // Unchecking any task re-opens the run and clears the completion stamp.
  detail = setTaskDone(run.id, tasks[0].id, false)!;
  assert.equal(detail.run.status, "active");
  assert.equal(detail.run.completedAt, null);

  // Unknown run → null, never a phantom row.
  assert.equal(setTaskDone("obr-nope", tasks[0].id, true), null);
});

test("saveIntake keeps only non-blank string answers and bounds every value", () => {
  const run = startRun({ entryId: "ob-entry-3" });
  const detail = saveIntake(run.id, {
    preferredName: "  Alex  ",
    tshirtSize: "",
    dietaryNeeds: 42 as unknown as string,
    equipmentPrefs: "x".repeat(2000),
  })!;
  assert.equal(detail.intake!.preferredName, "Alex", "values are trimmed");
  assert.equal("tshirtSize" in detail.intake!, false, "blank answers are dropped");
  assert.equal("dietaryNeeds" in detail.intake!, false, "non-string answers are dropped");
  assert.equal(detail.intake!.equipmentPrefs.length, 500, "oversize values are bounded");
  assert.equal(saveIntake("obr-nope", {}), null);
});

test("saveIntake MERGES over the existing row and never blanks it (candidate-onboarding-hand-off #1)", () => {
  const run = startRun({ entryId: "ob-entry-merge" });
  // Candidate submits their intake.
  saveIntake(run.id, { emergencyContact: "Pat 555-0101", licenceNo: "AB-1234" });
  // Recruiter opens the run (form answers initialized to {}), tabs through a field
  // without changing anything → blur fires an intake PATCH with the stale {} snapshot.
  let detail = saveIntake(run.id, {})!;
  assert.equal(detail.intake!.emergencyContact, "Pat 555-0101", "an empty PATCH must NOT wipe the submitted intake");
  assert.equal(detail.intake!.licenceNo, "AB-1234", "unrelated keys survive an empty PATCH");
  // Recruiter edits one field → only that key changes; the rest is preserved.
  detail = saveIntake(run.id, { emergencyContact: "Jordan 555-0199" })!;
  assert.equal(detail.intake!.emergencyContact, "Jordan 555-0199", "the edited key updates");
  assert.equal(detail.intake!.licenceNo, "AB-1234", "keys the recruiter didn't touch are preserved");
});

test("saveIntake does not mint an empty intake row (keeps the pre-boarding nudge alive)", () => {
  const run = startRun({ entryId: "ob-entry-empty" });
  const detail = saveIntake(run.id, { blank: "   ", nope: 7 as unknown as string })!;
  assert.equal(detail.intake, null, "an all-blank first save creates no intake row");
  assert.ok(
    new Set(duePreboardingReminders(FUTURE).map((r) => r.id)).has(run.id),
    "the run is still due for the one-shot pre-boarding reminder",
  );
});

test("the pre-boarding nudge is due only for active, unsubmitted, un-reminded runs — and claims once", () => {
  const run = startRun({ entryId: "ob-entry-4" });
  const dueIds = () => new Set(duePreboardingReminders(FUTURE).map((r) => r.id));
  assert.ok(dueIds().has(run.id), "a fresh run past the cutoff is due");

  // The CAS claim flips exactly once and removes the run from the due set.
  assert.equal(markPreboardingReminded(run.id), true);
  assert.equal(markPreboardingReminded(run.id), false);
  assert.ok(!dueIds().has(run.id));

  // A submitted intake also removes eligibility (nothing left to nudge about).
  const submitted = startRun({ entryId: "ob-entry-5" });
  saveIntake(submitted.id, { preferredName: "Sam" });
  assert.ok(!dueIds().has(submitted.id));
});

test("the e-sign seam: request → signed once, with signer recorded; unknown ids stay null", () => {
  const run = startRun({ entryId: "ob-entry-6" });
  const detail = requestSignature(run.id, "  Employment contract  ")!;
  assert.equal(detail.signatures.length, 1);
  const sig = detail.signatures[0];
  assert.equal(sig.status, "requested");
  assert.equal(sig.document, "Employment contract");

  const signed = markSigned(run.id, sig.id, "New Hire")!;
  assert.deepEqual(
    signed.signatures.map((s) => ({ status: s.status, signer: s.signer })),
    [{ status: "signed", signer: "New Hire" }]
  );
  assert.ok(signed.signatures[0].signedAt);
  assert.equal(markSigned(run.id, "obs-nope", "x"), null);
});

// bug-ui-scan-2026-07-09 (candidate-onboarding-hand-off #4): a signature can only be
// signed WITHIN its own run. A signatureId belonging to RUN_B, presented on RUN_A's
// URL, must not sign RUN_B's document nor swap RUN_A's on-screen detail to RUN_B.
test("markSigned refuses a signature that belongs to a different run (object-level ownership)", () => {
  const runA = startRun({ entryId: "ob-sign-A", candidateLabel: "Alice", jobTitle: "Eng" });
  const runB = startRun({ entryId: "ob-sign-B", candidateLabel: "Bob", jobTitle: "PM" });
  const sigB = requestSignature(runB.id, "Bob's contract")!.signatures[0];

  // Signing RUN_B's signature via RUN_A's id is rejected (404 → null) …
  assert.equal(markSigned(runA.id, sigB.id, "Mallory"), null, "cross-run sign must be refused");
  // … and RUN_B's signature is untouched (still 'requested', no signer/stamp) —
  // this assertion FAILS against pre-fix code, which would have signed sigB.
  const stillRequested = getRunDetail(runB.id)!.signatures[0];
  assert.equal(stillRequested.status, "requested");
  assert.equal(stillRequested.signer, null);
  assert.equal(stillRequested.signedAt, null);

  // The correct run signs it and returns RUN_B's own detail.
  const ok = markSigned(runB.id, sigB.id, "New Hire")!;
  assert.equal(ok.run.id, runB.id);
  assert.equal(ok.signatures[0].status, "signed");
});

// bug-ui-scan-2026-07-09 (candidate-onboarding-hand-off #3): the run table enforces
// one run per entry (UNIQUE entry_id). startRun's get-or-create must therefore be
// conflict-tolerant: a second provisioning for the same entry returns the existing run
// (never a duplicate, never a UNIQUE crash), which is the atomic upsert the fix makes.
test("startRun is conflict-tolerant — one run per entry, a re-provision returns the winner", () => {
  const winner = startRun({ entryId: "ob-race", candidateLabel: "Winner", jobTitle: "Eng" });
  // A concurrent second start for the same entry yields the SAME row, not a duplicate.
  const loser = startRun({ entryId: "ob-race", candidateLabel: "Loser", jobTitle: "Other" });
  assert.equal(loser.id, winner.id, "re-provisioning returns the single surviving run");
  assert.equal(loser.candidateLabel, "Winner", "the winner's row is returned, not a new one");
  // Exactly one row exists for the entry — the UNIQUE(entry_id) invariant holds.
  const runs = listRuns().filter((r) => r.entryId === "ob-race");
  assert.equal(runs.length, 1, "never two runs for one entry");
});
