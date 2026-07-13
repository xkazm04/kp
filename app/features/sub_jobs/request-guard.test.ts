// Pins the "latest request wins" race guard for RecruiterCandidates.load()
// (sourcing-campaigns-rediscovery #3). The bug: load() wrote `setData(payload)`
// UNCONDITIONALLY in its .then — no per-request key check — so when the reused
// posting modal switched from Role A to Role B, a slow A ranking resolving last
// clobbered B's candidate list.
//
// Non-vacuity: pre-fix there was no isCurrent gate at all (the response was always
// committed). This guard encodes the missing rule; asserting a superseded key is NOT
// current is exactly the check the pre-fix code lacked — reverting the component's
// `if (!guardRef.current.isCurrent(key)) return;` restores the always-commit bug.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLatestRequestGuard } from "./request-guard.ts";

test("a response whose request was superseded is not current (dropped)", () => {
  const g = makeLatestRequestGuard();
  g.begin("job-A"); // rank Role A (slow ranking in flight)
  g.begin("job-B"); // modal switches to Role B before A resolves
  assert.equal(g.isCurrent("job-A"), false); // A's late response must be dropped
  assert.equal(g.isCurrent("job-B"), true); // B's response is the current one
});

test("a request key stays current until a newer one begins", () => {
  const g = makeLatestRequestGuard();
  g.begin("job-A");
  assert.equal(g.isCurrent("job-A"), true);
  g.begin("job-A"); // a re-fetch for the same role keeps it current
  assert.equal(g.isCurrent("job-A"), true);
});

test("no request has begun: nothing is current", () => {
  const g = makeLatestRequestGuard();
  assert.equal(g.isCurrent("job-A"), false);
});
