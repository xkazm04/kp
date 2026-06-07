// Locks the fixed-window limiter guarding the public token POSTs
// (idea-3e49abaf): under the limit passes, over the limit refuses, and the
// window genuinely resets — so throttling can't silently turn into either a
// permanent block or a no-op.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIpFrom, rateLimit } from "./rate-limit.ts";

const MIN = 60_000;

test("allows up to the limit within a window, then refuses", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit("t:a", { limit: 5, windowMs: MIN }, t0 + i), true, `hit ${i + 1} should pass`);
  }
  assert.equal(rateLimit("t:a", { limit: 5, windowMs: MIN }, t0 + 10), false, "hit 6 must be refused");
});

test("the window resets after windowMs", () => {
  const t0 = 2_000_000;
  assert.equal(rateLimit("t:b", { limit: 1, windowMs: MIN }, t0), true);
  assert.equal(rateLimit("t:b", { limit: 1, windowMs: MIN }, t0 + 1), false);
  assert.equal(rateLimit("t:b", { limit: 1, windowMs: MIN }, t0 + MIN + 1), true, "a fresh window must admit again");
});

test("keys are independent — one hot token can't starve another", () => {
  const t0 = 3_000_000;
  assert.equal(rateLimit("t:c1", { limit: 1, windowMs: MIN }, t0), true);
  assert.equal(rateLimit("t:c1", { limit: 1, windowMs: MIN }, t0 + 1), false);
  assert.equal(rateLimit("t:c2", { limit: 1, windowMs: MIN }, t0 + 2), true);
});

test("clientIpFrom prefers the first x-forwarded-for hop and degrades to 'local'", () => {
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIpFrom(new Headers()), "local");
});
