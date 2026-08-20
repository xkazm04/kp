import { test } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  secretsMatch,
  isTimestampFresh,
  callbackNonce,
  createReplayGuard,
  CALLBACK_TIMESTAMP_WINDOW_MS,
} from "./callback-auth.ts";

// communications-inbound-channels #4 — the relay callback trust boundary.

// --- secretsMatch: constant-time, length-independent -------------------------

test("secretsMatch accepts the exact secret and rejects a wrong one", () => {
  assert.equal(secretsMatch("s3cr3t-token", "s3cr3t-token"), true);
  assert.equal(secretsMatch("s3cr3t-toke", "s3cr3t-token"), false); // one char short
  assert.equal(secretsMatch("wrong-value!", "s3cr3t-token"), false); // same length, wrong
});

test("secretsMatch rejects missing/empty presented without throwing", () => {
  assert.equal(secretsMatch(null, "s3cr3t"), false);
  assert.equal(secretsMatch(undefined, "s3cr3t"), false);
  assert.equal(secretsMatch("", "s3cr3t"), false);
});

test("secretsMatch handles length mismatch safely (naive timingSafeEqual throws)", () => {
  // Non-vacuity: the naive compare a code review would reach for THROWS here — my
  // hash-to-fixed-length approach must return false instead. If secretsMatch ever
  // regressed to raw-buffer timingSafeEqual, this would throw and fail the test.
  assert.throws(() => timingSafeEqual(Buffer.from("short"), Buffer.from("a-much-longer-secret")));
  assert.doesNotThrow(() => secretsMatch("short", "a-much-longer-secret"));
  assert.equal(secretsMatch("short", "a-much-longer-secret"), false);
});

// --- isTimestampFresh: replay window -----------------------------------------

test("isTimestampFresh accepts a now-ish stamp and rejects a stale one", () => {
  const now = Date.parse("2026-07-09T12:00:00Z");
  assert.equal(isTimestampFresh("2026-07-09T12:00:30Z", now), true); // 30s ahead
  assert.equal(isTimestampFresh(new Date(now - 60_000).toISOString(), now), true); // 1m ago
  assert.equal(isTimestampFresh("2026-07-09T11:50:00Z", now), false); // 10m stale > 5m window
});

test("isTimestampFresh accepts epoch-ms and fails closed on junk/missing", () => {
  const now = Date.parse("2026-07-09T12:00:00Z");
  assert.equal(isTimestampFresh(String(now - 1000), now), true);
  assert.equal(isTimestampFresh(null, now), false);
  assert.equal(isTimestampFresh("", now), false);
  assert.equal(isTimestampFresh("not-a-date", now), false);
});

// --- callbackNonce + replay guard: idempotency -------------------------------

test("callbackNonce prefers an explicit nonce, else derives a stable one", () => {
  const base = { timestamp: "2026-07-09T12:00:00Z", ref: "ent_1", kind: "offer", outcome: "bounced", detail: "550" };
  assert.equal(callbackNonce({ ...base, explicitNonce: "abc-123" }), "abc-123");
  // Same inputs → same derived nonce; a changed field → a different one.
  assert.equal(callbackNonce(base), callbackNonce({ ...base }));
  assert.notEqual(callbackNonce(base), callbackNonce({ ...base, outcome: "complaint" }));
  assert.notEqual(callbackNonce(base), callbackNonce({ ...base, timestamp: "2026-07-09T12:01:00Z" }));
});

test("replay guard admits the first sighting and rejects an exact replay", () => {
  const guard = createReplayGuard();
  const now = 1_000_000;
  assert.equal(guard.isReplay("nonce-A", now), false); // first time → allowed
  assert.equal(guard.isReplay("nonce-A", now + 1000), true); // replay within ttl → blocked
  assert.equal(guard.isReplay("nonce-B", now + 1000), false); // a different receipt is fine
});

test("replay guard forgets a nonce once its ttl elapses", () => {
  const guard = createReplayGuard(1000);
  assert.equal(guard.isReplay("n", 0), false);
  assert.equal(guard.isReplay("n", 500), true); // still within ttl
  assert.equal(guard.isReplay("n", 2000), false); // ttl elapsed → treated as new
});

test("the replay window is a sane, non-zero bound", () => {
  assert.ok(CALLBACK_TIMESTAMP_WINDOW_MS >= 60_000);
});

// --- release: idempotency must only persist for work that SUCCEEDED -----------

test("a released nonce is admitted again, so a retry of a FAILED receipt re-runs", () => {
  const guard = createReplayGuard();
  const now = 1_000_000;
  assert.equal(guard.isReplay("n", now), false); // claimed while recording
  guard.release("n"); // recording threw — the receipt was never stored
  assert.equal(guard.isReplay("n", now + 500), false, "the relay's retry must be processed, not dismissed as a duplicate");
  assert.equal(guard.isReplay("n", now + 600), true, "and the re-claim still guards a genuine replay");
});

test("release only drops the nonce it names", () => {
  const guard = createReplayGuard();
  guard.isReplay("a", 0);
  guard.isReplay("b", 0);
  guard.release("a");
  assert.equal(guard.isReplay("a", 1), false);
  assert.equal(guard.isReplay("b", 1), true);
});

// SOURCE GUARD for the route half of the same contract: route.ts drags in
// next/server + better-sqlite3, so node --test cannot exercise it. Without the
// release, a recordOutbox that threw (a locked DB) left the nonce recorded — the
// relay's retry got a 200 `duplicate: true`, stopped retrying, and the bounce was
// lost, leaving a green `sent` on an undeliverable candidate message.
test("the callback route gives the nonce back when recording the receipt failed", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /let claimedNonce: string \| null = null;/, "the claim is tracked outside the try");
  assert.match(src, /claimedNonce = nonce;/, "the nonce is marked claimed once isReplay admits it");
  const catchAt = src.indexOf("} catch (error) {");
  assert.ok(catchAt > 0, "guard the guard: the route still has a catch");
  assert.match(
    src.slice(catchAt),
    /if \(claimedNonce\) replayGuard\.release\(claimedNonce\);/,
    "a failed write must release the claim (webhook-idempotency doctrine)"
  );
});
