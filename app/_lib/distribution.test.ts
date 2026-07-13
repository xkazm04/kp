// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path
// (distribution → db → db-path). It also clears COMMS_WEBHOOK_URL, so sendComm uses
// the local OutboxChannel (records a "queued" row; no network). Keep it first.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getAdapter, intakeSubmission, LocalDistributionAdapter, UnknownChannelError } from "./distribution.ts";
import { createPosting, createSubmission, listOutboxFiltered } from "./db.ts";

// bug-ui-scan-2026-07-09 shared-utility-libraries #4 + #5.
//
// #4 — the acknowledgement was gated on the one-shot `created` insert flag, so a
// first attempt whose sendComm threw persisted the submission but dropped the ack,
// and the candidate's retry (created === false) returned before sendComm and dropped
// it FOREVER. The fix drives the ack off a durable marker (an acknowledgement outbox
// row for the submission), so a retry that finds an existing-but-unacked row re-sends.
//
// #5 — getAdapter silently mapped an UNKNOWN channel to the local stub, so a typo'd /
// unimplemented channel published a local posting and answered as if it had succeeded.
// It now throws UnknownChannelError for an unregistered channel; local stays the
// no-argument default.
//
// Real DB (the store's own connection on a throwaway file). Full ensureDb() init runs
// on the first store call in before().

/** Count the acknowledgement outbox rows recorded for a submission. */
function ackCount(submissionId: string): number {
  return listOutboxFiltered({ ref: submissionId, kind: "acknowledgement", limit: 50 }).length;
}

let seq = 0;
/** A fresh OPEN local posting to submit against. */
function freshPosting(role = "Backend Developer") {
  seq += 1;
  return createPosting({
    caseId: `dc-test-${seq}`,
    channel: "local",
    token: `tok-test-${seq}`,
    roleTitle: role,
    caseTitle: "Take-home case",
  });
}

before(() => {
  // Force the full ensureDb() init (creates dev_postings / dev_submissions / dev_outbox).
  listOutboxFiltered({ limit: 1 });
});

after(() => cleanupUnitDb());

// ── #5 getAdapter ────────────────────────────────────────────────────────────

test("getAdapter: the no-argument default is the local stub", () => {
  assert.equal(getAdapter().channel, "local");
  assert.ok(getAdapter() instanceof LocalDistributionAdapter);
  assert.equal(getAdapter("local").channel, "local");
});

test("getAdapter: an UNKNOWN channel throws instead of silently using local", () => {
  // NON-VACUITY: pre-fix `return ADAPTERS[channel] ?? ADAPTERS.local` returned the
  // LOCAL adapter for these (no throw), so a publish to "email"/"ats"/a typo looked
  // configured but went nowhere. assert.throws would fail against that behavior.
  assert.throws(() => getAdapter("email"), UnknownChannelError);
  assert.throws(() => getAdapter("ats"), /Unsupported distribution channel/);
  assert.throws(() => getAdapter("locl"), UnknownChannelError); // a genuine typo
});

// ── #4 intakeSubmission acknowledgement durability ───────────────────────────

test("intakeSubmission: a genuinely new submission is acknowledged exactly once", async () => {
  const posting = freshPosting();
  const { submission, isNew } = await intakeSubmission({
    postingId: posting.id,
    candidateRef: "alice",
    repoRef: "repo-alice",
  });
  assert.equal(isNew, true);
  assert.equal(ackCount(submission.id), 1);
});

test("intakeSubmission: a retry of an ALREADY-acknowledged submission does not double-send", async () => {
  const posting = freshPosting();
  const input = { postingId: posting.id, candidateRef: "bob", repoRef: "repo-bob" };
  const first = await intakeSubmission(input);
  const second = await intakeSubmission(input);
  assert.equal(second.isNew, false, "the duplicate is not treated as new");
  // Idempotent: the existing ack row is detected, so no second acknowledgement is sent.
  assert.equal(ackCount(first.submission.id), 1);
});

test("intakeSubmission: a retry RE-SENDS the ack when the first attempt persisted the row but dropped the ack", async () => {
  const posting = freshPosting();
  const input = { postingId: posting.id, candidateRef: "carol", repoRef: "repo-carol" };

  // Reproduce the post-first-attempt state the bug leaves behind: the submission row
  // is committed, but its sendComm threw before recordOutbox — so NO acknowledgement
  // outbox row exists. createSubmission alone (without the ack) models exactly that.
  const { submission, created } = createSubmission(input);
  assert.equal(created, true);
  assert.equal(ackCount(submission.id), 0, "precondition: the ack was dropped by the failed first attempt");

  // The candidate re-submits. Here `created` is now false.
  // NON-VACUITY: pre-fix, `if (!created) return { submission, isNew: false }` ran
  // BEFORE sendComm, so the ack stayed dropped forever — ackCount would remain 0 and
  // this assertion would fail. The fix drives the ack off the (absent) outbox marker
  // and re-sends it.
  const retry = await intakeSubmission(input);
  assert.equal(retry.isNew, false, "the row already existed, so it is not a new arrival");
  assert.equal(ackCount(submission.id), 1, "the retry recovered the dropped acknowledgement");
});
