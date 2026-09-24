import { test } from "node:test";
import assert from "node:assert/strict";
import { GIG_ATTEMPT_STATUSES, GIG_STATUSES } from "./types.ts";
import {
  GIG_ATTEMPT_TRANSITIONS,
  GIG_TRANSITIONS,
  canTransitionGig,
  canTransitionGigAttempt,
  isTerminalGigAttemptStatus,
  isTerminalGigStatus,
} from "./transitions.ts";

test("GIG_TRANSITIONS covers every status exactly, and every target is a real status", () => {
  assert.deepEqual(Object.keys(GIG_TRANSITIONS).sort(), [...GIG_STATUSES].sort());
  for (const [from, tos] of Object.entries(GIG_TRANSITIONS)) {
    for (const to of tos) assert.ok((GIG_STATUSES as readonly string[]).includes(to), `${from} -> ${to} names no status`);
    assert.ok(!tos.includes(from as never), `${from} has a self-loop`);
  }
});

test("GIG_ATTEMPT_TRANSITIONS covers every attempt status exactly, and every target is real", () => {
  assert.deepEqual(Object.keys(GIG_ATTEMPT_TRANSITIONS).sort(), [...GIG_ATTEMPT_STATUSES].sort());
  for (const [from, tos] of Object.entries(GIG_ATTEMPT_TRANSITIONS)) {
    for (const to of tos) assert.ok((GIG_ATTEMPT_STATUSES as readonly string[]).includes(to), `${from} -> ${to}`);
  }
});

test("gig terminals: accepted, rejected, declined, expired, withdrawn - and nothing else", () => {
  const terminal = GIG_STATUSES.filter(isTerminalGigStatus).sort();
  assert.deepEqual(terminal, ["accepted", "declined", "expired", "rejected", "withdrawn"]);
});

test("attempt terminals: revision_requested, failed, sent, discarded - a revision is a NEW attempt", () => {
  const terminal = GIG_ATTEMPT_STATUSES.filter(isTerminalGigAttemptStatus).sort();
  assert.deepEqual(terminal, ["discarded", "failed", "revision_requested", "sent"]);
});

test("the gig flow's load-bearing edges", () => {
  // The happy path.
  for (const [a, b] of [
    ["new", "qualified"],
    ["qualified", "dispatched"],
    ["dispatched", "drafted"],
    ["drafted", "in_review"],
    ["in_review", "sent"],
    ["sent", "accepted"],
    ["sent", "rejected"],
  ] as const) {
    assert.ok(canTransitionGig(a, b), `${a} -> ${b} must be allowed`);
  }
  // Honeypot: flagged from new, and (added edge) from qualified on a re-scan; cleared back to new.
  assert.ok(canTransitionGig("new", "suspect"));
  assert.ok(canTransitionGig("qualified", "suspect"));
  assert.ok(canTransitionGig("suspect", "new"));
  // A suspect gig is never dispatched or qualified directly.
  assert.equal(canTransitionGig("suspect", "dispatched"), false);
  assert.equal(canTransitionGig("suspect", "qualified"), false);
  // Failed attempt returns the gig to qualified; a revision re-dispatches.
  assert.ok(canTransitionGig("dispatched", "qualified"));
  assert.ok(canTransitionGig("drafted", "dispatched"));
  assert.ok(canTransitionGig("in_review", "dispatched"));
  // A discarded draft returns the gig to qualified (the review desk's `discard`).
  assert.ok(canTransitionGig("drafted", "qualified"));
  assert.ok(canTransitionGig("in_review", "qualified"));
  // Nothing skips the operator's review into sent.
  assert.equal(canTransitionGig("drafted", "sent"), false);
  assert.equal(canTransitionGig("dispatched", "sent"), false);
  // Once sent, only the judge (or expiry) moves it: the operator cannot withdraw sent work here.
  assert.equal(canTransitionGig("sent", "withdrawn"), false);
  assert.equal(canTransitionGig("accepted", "rejected"), false);
});

test("the attempt flow's load-bearing edges", () => {
  assert.ok(canTransitionGigAttempt("dispatched", "running"));
  assert.ok(canTransitionGigAttempt("dispatched", "drafted"));
  assert.ok(canTransitionGigAttempt("running", "failed"));
  assert.ok(canTransitionGigAttempt("drafted", "approved"));
  assert.ok(canTransitionGigAttempt("approved", "sent"));
  assert.ok(canTransitionGigAttempt("approved", "revision_requested"));
  assert.equal(canTransitionGigAttempt("drafted", "sent"), false, "sending requires an approval first");
  assert.equal(canTransitionGigAttempt("revision_requested", "drafted"), false, "a revision is a new attempt");
  assert.equal(canTransitionGigAttempt("sent", "discarded"), false);
});
