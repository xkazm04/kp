// Pins the login-outcome contract (bug-ui-scan-2026-07-09
// auth-sessions-workspace-tenancy #5). The pre-fix LoginClient collapsed every
// non-ok response into the inline "credential" error; these assertions FAIL
// against that behavior (429 → rateLimited, 5xx → serverError, timeout →
// timeout are all distinct from credential), proving non-vacuity.
//
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLoginResult, isInlineCredentialError, type LoginOutcome } from "./login-result.ts";

test("2xx statuses classify as success", () => {
  for (const status of [200, 201, 204]) {
    assert.equal(classifyLoginResult({ status }), "success");
  }
});

test("401 is the only status that blames the password (credential)", () => {
  assert.equal(classifyLoginResult({ status: 401 }), "credential");
});

test("429 classifies as rateLimited, NOT credential", () => {
  const outcome = classifyLoginResult({ status: 429 });
  assert.equal(outcome, "rateLimited");
  assert.notEqual(outcome, "credential");
});

test("5xx classifies as serverError, NOT credential", () => {
  for (const status of [500, 502, 503]) {
    const outcome = classifyLoginResult({ status });
    assert.equal(outcome, "serverError");
    assert.notEqual(outcome, "credential");
  }
});

test("other unexpected non-ok (400/403/404) is serverError, never credential", () => {
  for (const status of [400, 403, 404]) {
    assert.equal(classifyLoginResult({ status }), "serverError");
  }
});

test("fetch-level failures map to their own outcomes (never credential)", () => {
  assert.equal(classifyLoginResult({ failure: "network" }), "network");
  assert.equal(classifyLoginResult({ failure: "timeout" }), "timeout");
});

test("only the credential outcome renders the inline field error", () => {
  const outcomes: LoginOutcome[] = ["success", "credential", "rateLimited", "serverError", "network", "timeout"];
  const inline = outcomes.filter(isInlineCredentialError);
  assert.deepEqual(inline, ["credential"]);
});
