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
import { makeLatestRequestGuard } from "./jobsRequestGuard.ts";

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

// --- requestKey (lot JW, wave 22) -------------------------------------------
// The posting modal's campaign-pack existence probe was the one keyed fetch in
// this context running WITHOUT the guard: a bare `void fetch(...).then(setPackExists)`.
// It is keyed by two things, not one — the job AND the posting language — so the
// key has to be composed, and composing it ad-hoc per call site is how a guard
// silently starts comparing the wrong strings.
import { requestKey } from "./jobsRequestGuard.ts";

test("requestKey composes a multi-part key that changes with EITHER part", () => {
  assert.equal(requestKey("job-A", "en"), requestKey("job-A", "en"));
  assert.notEqual(requestKey("job-A", "en"), requestKey("job-B", "en")); // role switched
  assert.notEqual(requestKey("job-A", "en"), requestKey("job-A", "cs")); // language switched
});

test("requestKey cannot collide across a part boundary", () => {
  // Without a separator "a" + "bc" and "ab" + "c" are the same key, and a probe
  // for one job/lang pair would be accepted as the answer for another.
  assert.notEqual(requestKey("a", "bc"), requestKey("ab", "c"));
});

test("a pack probe superseded by a role switch is dropped", () => {
  const g = makeLatestRequestGuard();
  g.begin(requestKey("job-A", "en")); // probe A's pack (slow)
  g.begin(requestKey("job-B", "en")); // the modal is reused for Role B
  assert.equal(g.isCurrent(requestKey("job-A", "en")), false); // A's answer must not set packExists
  assert.equal(g.isCurrent(requestKey("job-B", "en")), true);
});
