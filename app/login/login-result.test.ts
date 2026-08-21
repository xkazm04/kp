// Pins the login-outcome contract (bug-ui-scan-2026-07-09
// auth-sessions-workspace-tenancy #5). The pre-fix LoginClient collapsed every
// non-ok response into the inline "credential" error; these assertions FAIL
// against that behavior (429 → rateLimited, 5xx → serverError, timeout →
// timeout are all distinct from credential), proving non-vacuity.
//
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLoginResult, isInlineCredentialError, safeNextPath, type LoginOutcome } from "./login-result.ts";

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

// --- safeNextPath: the post-login redirect target ---------------------------
// These pin the open-redirect guard. The pre-fix rule was the prefix test
// `n.startsWith("/") && !n.startsWith("//")`; the BACKSLASH and TAB cases below
// fail against it (it returns them verbatim and the router hard-navigates to
// evil.com), proving non-vacuity.
const ORIGIN = "https://kp.example.com";

test("an in-app path is preserved, query and hash included", () => {
  assert.equal(safeNextPath("?next=%2F", ORIGIN), "/");
  assert.equal(safeNextPath("?next=%2F%3Ftab%3Djobs", ORIGIN), "/?tab=jobs");
  assert.equal(safeNextPath("?next=%2Fbilling%23plans", ORIGIN), "/billing#plans");
});

test("a missing, empty or non-path next falls back to the workspace root", () => {
  assert.equal(safeNextPath("", ORIGIN), "/");
  assert.equal(safeNextPath("?next=", ORIGIN), "/");
  assert.equal(safeNextPath("?next=jobs", ORIGIN), "/");
});

test("a backslash authority can NOT redirect off-origin", () => {
  // WHATWG parses "/\evil.com" to the authority evil.com for a special scheme,
  // but it passes the old startsWith("/") && !startsWith("//") prefix test.
  assert.equal(safeNextPath("?next=%2F%5Cevil.com", ORIGIN), "/");
  assert.equal(safeNextPath("?next=%2F%5C%5Cevil.com", ORIGIN), "/");
});

test("a stripped tab/newline inside the prefix can NOT redirect off-origin", () => {
  // The URL parser removes tab/CR/LF, so "/\t/evil.com" becomes "//evil.com".
  assert.equal(safeNextPath("?next=%2F%09%2Fevil.com", ORIGIN), "/");
  assert.equal(safeNextPath("?next=%2F%0A%2Fevil.com", ORIGIN), "/");
});

test("protocol-relative and scheme-bearing targets fall back to the root", () => {
  assert.equal(safeNextPath("?next=%2F%2Fevil.com", ORIGIN), "/");
  assert.equal(safeNextPath("?next=https%3A%2F%2Fevil.com%2Fx", ORIGIN), "/");
  assert.equal(safeNextPath("?next=javascript%3Aalert(1)", ORIGIN), "/");
});

test("even a same-origin ABSOLUTE url is refused — only in-app paths are legitimate", () => {
  assert.equal(safeNextPath(`?next=${encodeURIComponent(`${ORIGIN}/jobs?x=1`)}`, ORIGIN), "/");
});
