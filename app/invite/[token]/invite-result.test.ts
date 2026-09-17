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
import { readFileSync } from "node:fs";
import { classifyInviteResult, inviteFailedCopy, isRetryableInviteOutcome, isTerminalInviteOutcome, type InviteOutcome } from "./invite-result.ts";

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

test("alreadyActive and emailTaken are terminal sign-in endings, not form errors", () => {
  assert.equal(isTerminalInviteOutcome("alreadyActive"), true);
  assert.equal(isTerminalInviteOutcome("emailTaken"), true);
  assert.equal(isTerminalInviteOutcome("dead"), true);
  assert.equal(isTerminalInviteOutcome("weakPassword"), false, "a short password is still correctable on the form");
  assert.equal(isTerminalInviteOutcome("retry"), false);
  assert.equal(isTerminalInviteOutcome("rateLimited"), false);
});

test("the failed panel reuses alreadyActive/emailTaken copy rather than the load-failed fallback", () => {
  assert.deepEqual(inviteFailedCopy("alreadyActive"), { title: "alreadyActive", body: "alreadyActive" });
  assert.deepEqual(inviteFailedCopy("emailTaken"), { title: "emailTaken", body: "emailTaken" });
  assert.deepEqual(inviteFailedCopy("dead"), { title: "unavailableTitle", body: "unavailableBody" });
  assert.deepEqual(inviteFailedCopy("rateLimited"), { title: "rateLimitedTitle", body: "rateLimitedBody" });
  assert.deepEqual(inviteFailedCopy("retry"), { title: "loadFailedTitle", body: "loadFailedBody" });
});

test("AcceptForm swaps the two 409s to the failed panel (which already offers goToSignIn)", () => {
  const src = readFileSync(new URL("./AcceptForm.tsx", import.meta.url), "utf8");
  assert.match(src, /isTerminalInviteOutcome\(outcome\)/, "redeem 409s must leave the password form");
  assert.match(src, /inviteFailedCopy\(state\.outcome\)/, "the failed panel must not fall through to loadFailed for 409s");
  assert.match(src, /t\("goToSignIn"\)/, "the failed panel keeps the sign-in link");
});
