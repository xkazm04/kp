// Locks the three-state outbound-comms (Outbox) delivery contract introduced to
// pin down what `queued`/`sent`/`failed` actually mean, so a silently-dropped
// offer or rejection can't hide behind an ad-hoc status string. These tests fix
// the exact enum membership (a future widening/renaming must be deliberate), the
// legacy-row normalization (pre-contract "failed:NNN" → "failed"), and the
// relay retry/dead-letter classification.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOX_STATUSES,
  coerceOutboxStatus,
  isRetryableHttpStatus,
  isBounceOutcome,
  COMMS_RELAY_RETRY,
} from "./comms-status.ts";

test("the canonical status list is exactly the four documented states", () => {
  assert.deepEqual([...OUTBOX_STATUSES].sort(), ["bounced", "failed", "queued", "sent"]);
});

test("queued is terminal and distinct — it is NOT a pending alias", () => {
  // The contract: queued is the offline success state, not a row awaiting a
  // worker. Guard that no "pending"/"sending" synonym crept into the enum.
  assert.equal(OUTBOX_STATUSES.includes("queued"), true);
  assert.equal(OUTBOX_STATUSES.includes("pending" as never), false);
  assert.equal(OUTBOX_STATUSES.includes("sending" as never), false);
});

test("coerceOutboxStatus passes through the canonical values", () => {
  assert.equal(coerceOutboxStatus("queued"), "queued");
  assert.equal(coerceOutboxStatus("sent"), "sent");
  assert.equal(coerceOutboxStatus("failed"), "failed");
  assert.equal(coerceOutboxStatus("bounced"), "bounced");
});

test("isBounceOutcome flags only hard, reputation-critical relay outcomes", () => {
  for (const o of ["bounced", "Bounce", " COMPLAINT ", "spam", "dropped", "failed"]) {
    assert.equal(isBounceOutcome(o), true, `${o} is a bounce`);
  }
  for (const o of ["delivered", "opened", "clicked", "deferred", "", null, undefined]) {
    assert.equal(isBounceOutcome(o), false, `${o} is NOT a bounce`);
  }
});

test("coerceOutboxStatus collapses legacy/unknown values to failed", () => {
  // Pre-contract rows stored the HTTP code inline; and any unrecognized value
  // must default to a NON-success state in a candidate-comms audit log.
  assert.equal(coerceOutboxStatus("failed:500"), "failed");
  assert.equal(coerceOutboxStatus("failed:404"), "failed");
  assert.equal(coerceOutboxStatus("bogus"), "failed");
  assert.equal(coerceOutboxStatus(null), "failed");
  assert.equal(coerceOutboxStatus(undefined), "failed");
});


test("transient HTTP statuses are retryable", () => {
  for (const s of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableHttpStatus(s), true, `${s} should be retryable`);
  }
});

test("permanent (caller/config) HTTP statuses dead-letter immediately", () => {
  for (const s of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetryableHttpStatus(s), false, `${s} should NOT be retryable`);
  }
});

test("the retry policy is bounded (no unbounded resend loop)", () => {
  assert.ok(COMMS_RELAY_RETRY.maxAttempts >= 1);
  assert.ok(Number.isFinite(COMMS_RELAY_RETRY.maxAttempts));
  assert.ok(COMMS_RELAY_RETRY.baseDelayMs >= 0);
});
