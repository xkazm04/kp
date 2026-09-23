// The interview-session status machine, written down once (interview-session-status.ts).
// Pure: no DB. The store cases live in db/interview-session-transitions.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERVIEW_SESSION_STATUSES,
  canInterviewTransition,
  finalizeFromGuard,
  fromStatesFor,
  isInterviewSessionStatus,
  statusFromGuard,
} from "./interview-session-status.ts";

test("the table answers the moves the card names", () => {
  assert.equal(canInterviewTransition("revoked", "in_progress"), false, "a revoke cannot be undone by a connect");
  assert.equal(canInterviewTransition("failed", "in_progress"), true, "a dropped call is reconnectable by design");
  assert.equal(canInterviewTransition("created", "in_progress"), true);
  for (const to of INTERVIEW_SESSION_STATUSES) {
    assert.equal(canInterviewTransition("completed", to), false, `completed -> ${to}: the transcript is evidence`);
  }
  assert.equal(canInterviewTransition("in_progress", "revoked"), true, "a recruiter may pull a live link");
  assert.equal(canInterviewTransition("paused", "in_progress"), false, "an unknown from-status is never legal");
  assert.equal(canInterviewTransition("created", "paused"), false, "an unknown target is never legal");
});

test("revoked is terminal and a re-revoke is not an edge", () => {
  for (const to of INTERVIEW_SESSION_STATUSES) {
    assert.equal(canInterviewTransition("revoked", to), false, `revoked -> ${to}`);
  }
  assert.deepEqual([...fromStatesFor("revoked")], ["created", "in_progress", "failed"]);
});

test("the from-set is derived from the edges, in declaration order", () => {
  assert.deepEqual([...fromStatesFor("in_progress")], ["created", "in_progress", "failed"]);
  assert.deepEqual([...fromStatesFor("completed")], ["created", "in_progress", "failed"]);
  assert.deepEqual([...fromStatesFor("created")], [], "nothing moves back to created");
});

test("the SQL guards are rendered from the table", () => {
  assert.equal(statusFromGuard("revoked"), "status IN ('created','in_progress','failed')");
  assert.equal(statusFromGuard("in_progress"), "status IN ('created','in_progress','failed')");
  // A finalize also lands on a revoked row (the transcript is evidence), keeping its status.
  assert.equal(finalizeFromGuard("completed"), "status IN ('created','in_progress','failed','revoked')");
  assert.throws(() => statusFromGuard("created"), /no legal move/);
  assert.throws(() => statusFromGuard("bogus" as never), /unknown/);
});

test("runtime guard", () => {
  assert.equal(isInterviewSessionStatus("revoked"), true);
  assert.equal(isInterviewSessionStatus("REVOKED"), false);
  assert.equal(isInterviewSessionStatus(null), false);
});
