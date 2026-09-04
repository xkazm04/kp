// The canary reason resolver, pinned. Both Test buttons hand it a server verdict and
// it decides WHICH sentence the operator reads — a wrong key, a rate limit and a
// firewall are three different fixes, and before this resolver existed all three
// collapsed into one flat "Test failed."
//
// It had no test at all, and the rule it holds is easy to get subtly wrong: a code the
// catalog does not carry must fall back rather than render a raw id, and it must do so
// by CHECKING the vocabulary rather than by trusting whatever string arrived. The
// vocabulary is now a literal array + derived union + runtime guard (the tabs.ts
// shape), so the decision is testable without next-intl.
//
// Runner: `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS_TEST_CODES, isModelsTestCode, testReasonKeyFor } from "./modelsTestReason.ts";

test("every declared code resolves to itself as a catalog key", () => {
  assert.ok(MODELS_TEST_CODES.length >= 10, "anti-vacuity: the vocabulary is not empty");
  for (const code of MODELS_TEST_CODES) {
    assert.equal(testReasonKeyFor({ ok: false, code }), code, `${code} must reach the catalog`);
  }
});

test("a verdict with NO code falls back — an ok:false with nothing to say is not a reason", () => {
  assert.equal(testReasonKeyFor({ ok: false }), null);
  assert.equal(testReasonKeyFor(null), null);
  assert.equal(testReasonKeyFor(undefined), null);
});

test("an UNKNOWN code falls back rather than rendering a raw id", () => {
  // A newer server, a proxy's own envelope, or a code added on the route and not yet
  // in the catalog. The operator reads the generic sentence; they never read "quota_x".
  assert.equal(testReasonKeyFor({ ok: false, code: "quota_exceeded_v2" }), null);
  assert.equal(testReasonKeyFor({ ok: false, code: "" }), null);
});

test("the guard refuses non-strings and near misses", () => {
  assert.equal(isModelsTestCode("auth"), true);
  assert.equal(isModelsTestCode("AUTH"), false, "the vocabulary is lower-case and exact");
  assert.equal(isModelsTestCode(undefined), false);
  assert.equal(isModelsTestCode(null), false);
  assert.equal(isModelsTestCode(42), false);
  assert.equal(isModelsTestCode(["auth"]), false);
});

test("the three codes the KEYS route mints before spawning are in the vocabulary", () => {
  // These are the pre-flight refusals: they never reach a provider, so if the client
  // did not know them the panel would say "Test failed" for a case it could have
  // fixed on screen (reveal the model box, save a key first).
  for (const code of ["model_required", "not_found", "unknown_provider"]) {
    assert.ok(isModelsTestCode(code), `${code} must be a client-known reason`);
  }
});
