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
import { canSubmitInvite, classifyInviteResult, inviteFailedCopy, invitePasswordCheck, inviteSubmitBlock, isRetryableInviteOutcome, isTerminalInviteOutcome, type InviteOutcome } from "./invite-result.ts";

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

test("a needsName preview cannot submit with an empty name", () => {
  assert.equal(inviteSubmitBlock({ needsName: true, name: "", password: "abcdefgh" }), "missingName");
  assert.equal(inviteSubmitBlock({ needsName: true, name: "   ", password: "abcdefgh" }), "missingName");
  assert.equal(canSubmitInvite({ needsName: true, name: "", password: "abcdefgh" }), false);
  assert.equal(canSubmitInvite({ needsName: true, name: "Ada", password: "abcdefgh" }), true);
});

test("when the preview did not ask for a name, an empty name is not a block", () => {
  assert.equal(inviteSubmitBlock({ needsName: false, name: "", password: "abcdefgh" }), null);
  assert.equal(canSubmitInvite({ needsName: false, name: "", password: "abcdefgh" }), true);
});

test("an empty password is refused even when a name is present", () => {
  assert.equal(inviteSubmitBlock({ needsName: true, name: "Ada", password: "" }), "emptyPassword");
  assert.equal(canSubmitInvite({ needsName: false, name: "", password: "" }), false);
});

test("AcceptForm wires the name pre-check: required field, disabled submit, inline error, no POST", () => {
  const src = readFileSync(new URL("./AcceptForm.tsx", import.meta.url), "utf8");
  assert.match(src, /canSubmitInvite\(/, "submit disablement must use the shared helper");
  assert.match(src, /inviteSubmitBlock\(/, "submit must classify empty name before fetch");
  assert.match(src, /t\("nameRequired"\)/, "empty name must set the inline catalog error");
  assert.match(src, /required/, "the name input is required when it is shown");
});

test("invitePasswordCheck pins too-short, mismatch, and match", () => {
  assert.equal(invitePasswordCheck("short", "short", 8), "tooShort");
  assert.equal(invitePasswordCheck("abcdefgh", "abcdefgH", 8), "mismatch");
  assert.equal(invitePasswordCheck("abcdefgh", "abcdefgh", 8), "ok");
});

test("canSubmitInvite requires a matching confirmation at the preview floor", () => {
  const base = { needsName: false, name: "", minPasswordLength: 8 };
  assert.equal(inviteSubmitBlock({ ...base, password: "short", passwordConfirm: "short" }), "weakPassword");
  assert.equal(inviteSubmitBlock({ ...base, password: "abcdefgh", passwordConfirm: "abcdefgH" }), "passwordMismatch");
  assert.equal(canSubmitInvite({ ...base, password: "abcdefgh", passwordConfirm: "abcdefgh" }), true);
});

test("AcceptForm shows the floor, a confirm field, and does not POST on mismatch", () => {
  const src = readFileSync(new URL("./AcceptForm.tsx", import.meta.url), "utf8");
  assert.match(src, /t\("passwordHint", \{ minLength: minPasswordLength \}\)/, "hint uses the preview floor");
  assert.match(src, /t\("passwordConfirm"\)/, "confirm field is catalogued");
  assert.match(src, /minLength=\{minPasswordLength\}/, "native minLength matches the preview floor");
  assert.match(src, /aria-describedby=\{passwordDescribedBy\}/, "password input points at hint + error");
  assert.match(src, /t\("passwordMismatch"\)/, "mismatch is an inline error, not a fetch");
});

test("canSubmitInvite refuses an unchecked privacy/terms acknowledgment", () => {
  const ready = { needsName: false, name: "", password: "abcdefgh", passwordConfirm: "abcdefgh", minPasswordLength: 8 };
  assert.equal(inviteSubmitBlock({ ...ready, legalAck: false }), "legalAck");
  assert.equal(canSubmitInvite({ ...ready, legalAck: false }), false);
  assert.equal(canSubmitInvite({ ...ready, legalAck: true }), true);
});

test("AcceptForm cannot submit without an explicit privacy/terms acknowledgment", () => {
  const src = readFileSync(new URL("./AcceptForm.tsx", import.meta.url), "utf8");
  assert.match(src, /t\.rich\("legalAck"/, "the checkbox copy is catalogued");
  assert.match(src, /href="\/privacy"/, "privacy policy is linked");
  assert.match(src, /href="\/terms"/, "terms of service are linked");
  assert.match(src, /legalAck/, "submit disablement includes the ack");
});
