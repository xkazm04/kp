// Pins the invite-outcome contract. The pre-fix AcceptForm collapsed EVERY
// non-ok preview response and every fetch failure into `{ valid: false }` — the
// "this link is invalid, already used, or expired" dead end — and every non-ok
// redeem response into the generic error line. These assertions FAIL against
// that behavior (429 → rateLimited, 5xx/network/timeout → retry, and 410 →
// dead rather than generic), which is what makes them non-vacuous.
//
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInviteResult, isRetryableInviteOutcome, type InviteOutcome } from "./invite-result.ts";

test("2xx statuses classify as ok", () => {
  for (const status of [200, 201, 204]) {
    assert.equal(classifyInviteResult({ status }), "ok");
  }
});

test("404 and 410 are the ONLY statuses that declare the link dead", () => {
  assert.equal(classifyInviteResult({ status: 404 }), "dead");
  assert.equal(classifyInviteResult({ status: 410 }), "dead");
  for (const status of [429, 500, 502, 400, 403, 409]) {
    assert.notEqual(classifyInviteResult({ status }), "dead");
  }
});

test("429 classifies as rateLimited, NOT dead", () => {
  const outcome = classifyInviteResult({ status: 429 });
  assert.equal(outcome, "rateLimited");
  assert.notEqual(outcome, "dead");
});

test("5xx classifies as retry, NOT dead", () => {
  for (const status of [500, 502, 503]) {
    assert.equal(classifyInviteResult({ status }), "retry");
  }
});

test("a fetch-level failure (network drop, abort timeout) is retry, never dead", () => {
  assert.equal(classifyInviteResult({ failure: "network" }), "retry");
  assert.equal(classifyInviteResult({ failure: "timeout" }), "retry");
});

test("the redeem path's reason codes each get their own outcome", () => {
  assert.equal(classifyInviteResult({ status: 400, error: "weak_password" }), "weakPassword");
  assert.equal(classifyInviteResult({ status: 409, error: "email_taken" }), "emailTaken");
  assert.equal(classifyInviteResult({ status: 409, error: "already_active" }), "alreadyActive");
});

test("a 429 that somehow carries a reason code is still rateLimited (the limiter answers first)", () => {
  assert.equal(classifyInviteResult({ status: 429, error: "weak_password" }), "rateLimited");
});

test("an unexpected 4xx with no known code offers a retry rather than a false dead end", () => {
  assert.equal(classifyInviteResult({ status: 418 }), "retry");
  assert.equal(classifyInviteResult({ status: 409, error: "something_new" }), "retry");
});

test("only retry and rateLimited are retryable — a dead link never shows a retry button", () => {
  const retryable: InviteOutcome[] = ["retry", "rateLimited"];
  const terminal: InviteOutcome[] = ["ok", "dead", "weakPassword", "emailTaken", "alreadyActive"];
  for (const o of retryable) assert.equal(isRetryableInviteOutcome(o), true, `${o} must be retryable`);
  for (const o of terminal) assert.equal(isRetryableInviteOutcome(o), false, `${o} must not offer a retry`);
});
