// C4 — recorded debrief findings release holds. A suspect band or an unwitnessed trace
// holds promote and permanent observed minting; the ONLY exit is a sealed human
// `authorship_verified` decision bound to a digest of the submission, written after the
// interviewer recorded a finding per follow-up. Band and score stay as history.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPosting, createSubmission, getSubmission, saveSubmissionEvaluation } from "./db.ts";
import {
  clearAuthorship,
  clearedByFor,
  heldForAuthorship,
  readDebriefFindings,
  recordDebriefFindings,
  DebriefFindingError,
} from "./devcase-debrief-findings.ts";
import { promoteSubmission } from "./devcase-run.ts";

after(() => cleanupUnitDb());

const FOLLOWUPS = Array.from({ length: 5 }, (_, i) => ({ id: `f${i + 1}`, question: `Why did you choose option ${i + 1}?` }));

function bundle(band: string, witness = "witnessed", nonce = "a") {
  return {
    evaluation: { confidence: 0.9 },
    transfer: { transferScore: 88 },
    authenticity: { band, score: band === "suspect" ? 20 : 90 },
    integrity: { witness: { verdict: witness } },
    followups: { questions: FOLLOWUPS },
    evaluatedAt: nonce,
  };
}

let n = 0;
function submissionWith(b: unknown) {
  n += 1;
  const posting = createPosting({ caseId: `case-${n}`, channel: "link", token: `tok-${n}`, roleTitle: "Dev", caseTitle: "Case" } as never);
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: `cand-${n}`, repoRef: `session:s${n}` });
  saveSubmissionEvaluation(submission.id, b, 88);
  return getSubmission(submission.id)!;
}

const supported = (i: number) => ({ followupIndex: i, kind: "supported" as const });

test("a suspect submission is held; no findings means a clearance is refused", () => {
  const sub = submissionWith(bundle("suspect"));
  assert.equal(heldForAuthorship(sub), true);
  const res = clearAuthorship(sub, "human:recruiter");
  assert.equal(res.cleared, false);
  assert.equal(clearedByFor(sub), null);
  assert.equal(heldForAuthorship(sub), true);
});

test("an authentic, witnessed submission is not held at all", () => {
  assert.equal(heldForAuthorship(submissionWith(bundle("authentic"))), false);
});

test("an adverse finding without a quote is refused; with one it is kept", () => {
  const sub = submissionWith(bundle("suspect"));
  for (const kind of ["revised", "not_evidenced"] as const) {
    assert.throws(
      () => recordDebriefFindings(sub, [{ followupIndex: 1, kind }], "human:recruiter"),
      (e: unknown) => e instanceof DebriefFindingError && e.code === "DEBRIEF_FINDING_QUOTE_REQUIRED",
    );
    assert.throws(() => recordDebriefFindings(sub, [{ followupIndex: 1, kind, quote: "   " }], "human:recruiter"), DebriefFindingError);
  }
  recordDebriefFindings(sub, [{ followupIndex: 1, kind: "revised", quote: "Actually I copied that part." }], "human:recruiter");
  assert.equal(readDebriefFindings(sub).findings[0].kind, "revised");
});

test("a follow-up with no finding reads 'not asked', never a midpoint", () => {
  const sub = submissionWith(bundle("suspect"));
  assert.equal(readDebriefFindings(sub).recorded, false);
  recordDebriefFindings(sub, [supported(1), supported(2)], "human:recruiter");
  const read = readDebriefFindings(sub);
  assert.equal(read.recorded, true);
  assert.deepEqual(read.findings.map((f) => f.kind), ["supported", "supported", "not_asked", "not_asked", "not_asked"]);
  assert.equal(read.supported, 2);
  assert.equal(read.total, 5);
});

test("suspect + sealed clearance with 4 of 5 supported releases the hold; band and score stay", () => {
  const sub = submissionWith(bundle("suspect"));
  recordDebriefFindings(sub, [1, 2, 3, 4].map(supported).concat([{ followupIndex: 5, kind: "not_asked" as never }]), "human:recruiter");
  const res = clearAuthorship(sub, "human:Petra");
  assert.equal(res.cleared, true);
  assert.equal(clearedByFor(sub), "human:Petra");
  assert.equal(heldForAuthorship(sub), false);
  const after = getSubmission(sub.id)!;
  assert.equal((after.evaluation as { authenticity: { band: string } }).authenticity.band, "suspect");
  assert.equal(after.transferScore, 88);
});

test("fewer than 4 of 5 supported does not clear", () => {
  const sub = submissionWith(bundle("suspect"));
  recordDebriefFindings(sub, [supported(1), supported(2), supported(3)], "human:recruiter");
  assert.equal(clearAuthorship(sub, "human:recruiter").cleared, false);
  assert.equal(clearedByFor(sub), null);
});

test("an unwitnessed trace is released the same way", () => {
  const sub = submissionWith(bundle("authentic", "unwitnessed"));
  assert.equal(heldForAuthorship(sub), true);
  recordDebriefFindings(sub, [1, 2, 3, 4, 5].map(supported), "human:recruiter");
  assert.equal(clearAuthorship(sub, "human:recruiter").cleared, true);
  assert.equal(heldForAuthorship(sub), false);
});

test("re-evaluating the submission changes the digest and invalidates the clearance", () => {
  const sub = submissionWith(bundle("suspect"));
  recordDebriefFindings(sub, [1, 2, 3, 4, 5].map(supported), "human:recruiter");
  clearAuthorship(sub, "human:recruiter");
  assert.equal(heldForAuthorship(getSubmission(sub.id)!), false);
  saveSubmissionEvaluation(sub.id, bundle("suspect", "witnessed", "b"), 88);
  const re = getSubmission(sub.id)!;
  assert.equal(clearedByFor(re), null);
  assert.equal(heldForAuthorship(re), true);
  assert.equal(readDebriefFindings(re).recorded, false, "findings of the old evaluation do not carry over");
});

test("promote stops forcing a hold once cleared, and stays held before", () => {
  const sub = submissionWith(bundle("suspect"));
  const held = promoteSubmission(sub.id, 70);
  assert.equal(held?.recommendation, "hold");
  recordDebriefFindings(sub, [1, 2, 3, 4, 5].map(supported), "human:recruiter");
  clearAuthorship(sub, "human:recruiter");
  const released = promoteSubmission(sub.id, 70);
  assert.equal(released?.recommendation, "advance");
});
