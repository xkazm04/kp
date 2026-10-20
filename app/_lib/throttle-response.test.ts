// Challenge 2026-09-22 shared-api-utilities/B — the ONE clamp-and-header rule for a
// throttled answer.
//
// A 429 that says when to come back lets a machine caller (Polar's redelivery, a lead
// relay, an agent report) back off once instead of probing blind. The figure must come
// from the arithmetic that refused, and there must be NO header when there is no honest
// figure: a fabricated wait is worse than none, because a client that trusts it either
// hammers a door that wanted longer or sleeps through a window that was already open.
//
// Loaded per case, so a missing module fails each case on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { REFUSAL_ERRORS } from "./api-response.ts";

type WithRetryAfter = (res: Response, remainingMs: number | null | undefined, windowMs?: number) => Response;
type JsonThrottled = (retryAfterMs: number | null | undefined, windowMs?: number) => Response;

const load = async () => {
  const mod = (await import("./throttle-response.ts")) as Record<string, unknown>;
  assert.equal(typeof mod.withRetryAfter, "function", "throttle-response.ts exports withRetryAfter");
  assert.equal(typeof mod.jsonThrottled, "function", "throttle-response.ts exports jsonThrottled");
  return { withRetryAfter: mod.withRetryAfter as WithRetryAfter, jsonThrottled: mod.jsonThrottled as JsonThrottled };
};

const fresh = () => NextResponse.json({ ok: false }, { status: 429 });

test("withRetryAfter: delta-seconds rounded UP, never 0, never past the window", async () => {
  const { withRetryAfter } = await load();
  assert.equal(withRetryAfter(fresh(), 45_001, 60_000).headers.get("Retry-After"), "46", "rounded up, not down");
  assert.equal(withRetryAfter(fresh(), 200, 60_000).headers.get("Retry-After"), "1", "a sub-second wait is 1, never 0");
  assert.equal(withRetryAfter(fresh(), 600_000, 60_000).headers.get("Retry-After"), "60", "capped at the window");
  // An engine figure has no window of ours to cap it: the engine's own wait stands.
  assert.equal(withRetryAfter(fresh(), 12_000).headers.get("Retry-After"), "12");
  // The same response comes back (the header is set on it, not on a copy).
  const res = fresh();
  assert.equal(withRetryAfter(res, 1_000, 60_000), res);
});

test("withRetryAfter: no honest figure means NO header — null, 0, NaN, negative, infinite", async () => {
  const { withRetryAfter } = await load();
  for (const bad of [null, undefined, 0, Number.NaN, -5_000, Number.POSITIVE_INFINITY]) {
    assert.equal(
      withRetryAfter(fresh(), bad, 60_000).headers.get("Retry-After"),
      null,
      `remainingMs ${String(bad)} must not fabricate a wait`,
    );
  }
});

test("jsonThrottled: the coded 429 with retryAfterSeconds equal to the header", async () => {
  const { jsonThrottled } = await load();
  const res = jsonThrottled(45_001, 60_000);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "46");
  assert.deepEqual(await res.json(), {
    error: REFUSAL_ERRORS.TOO_MANY_REQUESTS,
    code: "TOO_MANY_REQUESTS",
    retryAfterSeconds: 46,
  });
});

test("jsonThrottled: with no figure, the plain coded 429 — no retryAfterSeconds, no header", async () => {
  const { jsonThrottled } = await load();
  for (const none of [null, undefined, 0, -1, Number.NaN]) {
    const res = jsonThrottled(none, 60_000);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), null);
    assert.deepEqual(await res.json(), { error: REFUSAL_ERRORS.TOO_MANY_REQUESTS, code: "TOO_MANY_REQUESTS" });
  }
});
