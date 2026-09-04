// P1-2: the screen-wave human-approval token (EU AI Act / GDPR Art. 22 gate).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  screenWaveApprovalToken,
  screenWaveApprovalIssuedAt,
  verifyScreenWaveApprovalToken,
  ScreenWaveApprovalError,
  consumeScreenWaveApprovalToken,
  isScreenWaveApprovalSpent,
  resetScreenWaveApprovalSpendForTests,
  SCREEN_WAVE_APPROVAL_MAX_AGE_MS,
} from "./screen-wave-approval.ts";

const POLICY = "screen-wave/bottom20/maxMatch50";
// A fixed issue time so the signature tests below compare SETS, not clocks.
const T0 = 1_700_000_000_000;

test("token is stable and order-independent for the same reject set", () => {
  const a = screenWaveApprovalToken("job1", POLICY, ["e3", "e1", "e2"], T0);
  const b = screenWaveApprovalToken("job1", POLICY, ["e1", "e2", "e3"], T0);
  assert.equal(a, b);
});

test("token changes when the reject set changes (added / removed candidate)", () => {
  const base = screenWaveApprovalToken("job1", POLICY, ["e1", "e2"], T0);
  assert.notEqual(base, screenWaveApprovalToken("job1", POLICY, ["e1", "e2", "e3"], T0));
  assert.notEqual(base, screenWaveApprovalToken("job1", POLICY, ["e1"], T0));
});

test("token changes when the policy or the job changes", () => {
  const base = screenWaveApprovalToken("job1", POLICY, ["e1"], T0);
  assert.notEqual(base, screenWaveApprovalToken("job1", "screen-wave/bottom30/maxMatch50", ["e1"], T0));
  assert.notEqual(base, screenWaveApprovalToken("job2", POLICY, ["e1"], T0));
});

test("an empty reject set still yields a stable token (an empty wave is approvable)", () => {
  const a = screenWaveApprovalToken("job1", POLICY, [], T0);
  const b = screenWaveApprovalToken("job1", POLICY, [], T0);
  assert.equal(a, b);
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
});

test("whitespace / blank ids are normalized so the signature is robust", () => {
  const a = screenWaveApprovalToken("job1", POLICY, ["e1", "e2"], T0);
  const b = screenWaveApprovalToken("job1", POLICY, [" e1 ", "", "e2"], T0);
  assert.equal(a, b);
});

test("ScreenWaveApprovalError carries its name (for the 409 mapping)", () => {
  const err = new ScreenWaveApprovalError("nope");
  assert.equal(err.name, "ScreenWaveApprovalError");
  assert.ok(err instanceof Error);
});

// --- staleness window (P2: "a review is of a moment") -------------------------

test("the token carries its issue time, and a fresh one verifies", () => {
  const token = screenWaveApprovalToken("job1", POLICY, ["e1", "e2"], T0);
  assert.equal(screenWaveApprovalIssuedAt(token), T0);
  assert.deepEqual(verifyScreenWaveApprovalToken(token, "job1", POLICY, ["e2", "e1"], T0 + 1000), { ok: true });
});

test("a token issued outside the window is refused as expired, not accepted as a review", () => {
  const token = screenWaveApprovalToken("job1", POLICY, ["e1"], T0);
  // One millisecond inside the window still commits…
  assert.deepEqual(verifyScreenWaveApprovalToken(token, "job1", POLICY, ["e1"], T0 + SCREEN_WAVE_APPROVAL_MAX_AGE_MS), { ok: true });
  // …a millisecond past it does not, nor does a token signed weeks ago.
  assert.deepEqual(verifyScreenWaveApprovalToken(token, "job1", POLICY, ["e1"], T0 + SCREEN_WAVE_APPROVAL_MAX_AGE_MS + 1), {
    ok: false,
    reason: "expired",
  });
  assert.deepEqual(verifyScreenWaveApprovalToken(token, "job1", POLICY, ["e1"], T0 + 21 * 24 * 60 * 60 * 1000), { ok: false, reason: "expired" });
});

test("the issue time cannot be back-dated — it is inside the signature", () => {
  const token = screenWaveApprovalToken("job1", POLICY, ["e1"], T0);
  const forged = `${T0 + SCREEN_WAVE_APPROVAL_MAX_AGE_MS * 10}.${token.split(".")[1]}`;
  assert.deepEqual(verifyScreenWaveApprovalToken(forged, "job1", POLICY, ["e1"], T0 + SCREEN_WAVE_APPROVAL_MAX_AGE_MS * 10), {
    ok: false,
    reason: "mismatch",
  });
});

test("a malformed or future-dated token is refused (clock skew must not extend the window)", () => {
  assert.deepEqual(verifyScreenWaveApprovalToken("not-a-token", "job1", POLICY, ["e1"], T0), { ok: false, reason: "malformed" });
  assert.equal(screenWaveApprovalIssuedAt("deadbeef"), null);
  const future = screenWaveApprovalToken("job1", POLICY, ["e1"], T0 + 60_000);
  assert.deepEqual(verifyScreenWaveApprovalToken(future, "job1", POLICY, ["e1"], T0), { ok: false, reason: "malformed" });
});

test("a stale-but-fresh-looking token still has to match the live set", () => {
  const token = screenWaveApprovalToken("job1", POLICY, ["e1", "e2"], T0);
  assert.deepEqual(verifyScreenWaveApprovalToken(token, "job1", POLICY, ["e1"], T0 + 1000), { ok: false, reason: "mismatch" });
});

// --- SINGLE SPEND ------------------------------------------------------------------
// verify proves the token still signs the live set and is fresh; it cannot prove the
// token has not been committed already, and the token is a pure function of its inputs,
// so an identical re-post re-derives an identical signature. The spend ledger is what
// makes one review authorize one commit.

test("a token is spendable exactly once", () => {
  resetScreenWaveApprovalSpendForTests();
  const token = screenWaveApprovalToken("job-spend", POLICY, ["a", "b"]);
  assert.equal(isScreenWaveApprovalSpent(token), false, "an unused review is not spent");
  assert.equal(consumeScreenWaveApprovalToken(token), true, "the first commit consumes it");
  assert.equal(consumeScreenWaveApprovalToken(token), false, "every later commit is refused");
  assert.equal(isScreenWaveApprovalSpent(token), true);
});

test("spending one approval does not spend another - the ledger is per token", () => {
  resetScreenWaveApprovalSpendForTests();
  const a = screenWaveApprovalToken("job-spend-a", POLICY, ["a"]);
  const b = screenWaveApprovalToken("job-spend-b", POLICY, ["a"]);
  assert.notEqual(a, b, "precondition: different jobs sign different tokens");
  assert.equal(consumeScreenWaveApprovalToken(a), true);
  assert.equal(consumeScreenWaveApprovalToken(b), true, "a different review is unaffected");
});

test("a spent entry is pruned once the token could no longer be committed anyway", () => {
  resetScreenWaveApprovalSpendForTests();
  const issuedAt = Date.now();
  const token = screenWaveApprovalToken("job-prune", POLICY, ["a"], issuedAt);
  assert.equal(consumeScreenWaveApprovalToken(token, issuedAt), true);
  // Still inside the window: the ledger must remember.
  assert.equal(isScreenWaveApprovalSpent(token, issuedAt + 60_000), true);
  // Past the window the token is refused as EXPIRED by verify regardless, so keeping its
  // spend entry would only grow the map forever. It is dropped.
  assert.equal(isScreenWaveApprovalSpent(token, issuedAt + SCREEN_WAVE_APPROVAL_MAX_AGE_MS + 1), false);
});
