// Locks the fixed-window limiter guarding the public token POSTs
// (idea-3e49abaf): under the limit passes, over the limit refuses, and the
// window genuinely resets — so throttling can't silently turn into either a
// permanent block or a no-op.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIpFrom, rateLimit, resolveClientIp } from "./rate-limit.ts";

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

// The client-IP resolution is the abuse-containment decision, so its trust model
// (bug-ui-scan-2026-07-09 #2) is pinned directly on the pure resolver.
test("resolveClientIp: an UNTRUSTED x-forwarded-for is NOT the bucket key (spoof-proof)", () => {
  // trustedHops = 0 ⇒ kp isn't behind a declared proxy, so the whole XFF is
  // attacker-supplied and must be ignored — collapse to ONE shared bucket.
  assert.equal(resolveClientIp("203.0.113.7, 10.0.0.1", null, 0), "local");
  assert.equal(resolveClientIp("198.51.100.2", null, 0), "local");
  assert.equal(resolveClientIp(null, "198.51.100.2", 0), "local");
  assert.equal(resolveClientIp(null, null, 0), "local");
  // The whole point: two DIFFERENT spoofed first hops map to the SAME key, so a
  // per-request random XFF can no longer mint unlimited fresh buckets.
  assert.equal(
    resolveClientIp("1.1.1.1", null, 0),
    resolveClientIp("2.2.2.2", null, 0),
    "spoofed XFF values must share one bucket when no proxy is trusted",
  );
});

test("resolveClientIp: with a trusted proxy, the caller is the hop from the RIGHT", () => {
  // One trusted proxy that appended the real client last ⇒ take the last hop.
  assert.equal(resolveClientIp("203.0.113.7, 10.0.0.1", null, 1), "10.0.0.1");
  // Two trusted proxies ⇒ the client is two from the right.
  assert.equal(resolveClientIp("client, proxyA, proxyB", null, 2), "proxyA");
  // Chain shorter than declared ⇒ clamp to the left-most hop, never out of range.
  assert.equal(resolveClientIp("only-one", null, 3), "only-one");
  // Trusted but no XFF ⇒ honour the proxy's single-value X-Real-IP.
  assert.equal(resolveClientIp(null, "198.51.100.2", 1), "198.51.100.2");
});

test("clientIpFrom honours KP_TRUSTED_PROXY (untrusted by default)", () => {
  const prev = process.env.KP_TRUSTED_PROXY;
  try {
    delete process.env.KP_TRUSTED_PROXY;
    // Default deploy: forwarding headers are ignored — shared bucket.
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "local");
    assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" })), "local");
    assert.equal(clientIpFrom(new Headers()), "local");

    process.env.KP_TRUSTED_PROXY = "1";
    // Behind one trusted proxy: the real client is the last appended hop.
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "10.0.0.1");

    process.env.KP_TRUSTED_PROXY = "true";
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "10.0.0.1");
  } finally {
    if (prev === undefined) delete process.env.KP_TRUSTED_PROXY;
    else process.env.KP_TRUSTED_PROXY = prev;
  }
});
