// Locks the request-level idempotency guard for the public inbound webhook: a
// byte-identical retry within the TTL is a duplicate (caller short-circuits), a
// released or expired claim runs again, and an explicit Idempotency-Key header
// wins over the body hash.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimWebhookIdempotency,
  releaseWebhookIdempotency,
  webhookIdempotencyKey,
} from "./webhook-idempotency.ts";

test("first claim wins, an immediate retry of the same key is a duplicate", () => {
  const key = `inbound:tok:${webhookIdempotencyKey('{"a":1}', null)}`;
  const t0 = 1_000_000;
  assert.equal(claimWebhookIdempotency(key, 60_000, t0), true);
  assert.equal(claimWebhookIdempotency(key, 60_000, t0 + 5), false); // retry within window
});

test("a released claim can be re-run (failed processing → retry allowed)", () => {
  const key = `inbound:tok:${webhookIdempotencyKey('{"b":2}', null)}`;
  const t0 = 2_000_000;
  assert.equal(claimWebhookIdempotency(key, 60_000, t0), true);
  releaseWebhookIdempotency(key);
  assert.equal(claimWebhookIdempotency(key, 60_000, t0 + 5), true);
});

test("a claim past its TTL is re-runnable", () => {
  const key = `inbound:tok:${webhookIdempotencyKey('{"c":3}', null)}`;
  const t0 = 3_000_000;
  assert.equal(claimWebhookIdempotency(key, 60_000, t0), true);
  assert.equal(claimWebhookIdempotency(key, 60_000, t0 + 60_001), true); // window elapsed
});

test("an explicit Idempotency-Key header beats the body hash and ignores body drift", () => {
  const k1 = webhookIdempotencyKey('{"x":1}', "evt-123");
  const k2 = webhookIdempotencyKey('{"x":2}', "evt-123"); // different body, same header
  assert.ok(k1.startsWith("h:"));
  assert.equal(k1, k2);
});

test("without a header, identical bodies collide and different bodies don't", () => {
  assert.equal(webhookIdempotencyKey('{"x":1}', null), webhookIdempotencyKey('{"x":1}', undefined));
  assert.notEqual(webhookIdempotencyKey('{"x":1}', null), webhookIdempotencyKey('{"x":2}', null));
  assert.ok(webhookIdempotencyKey('{"x":1}', "").startsWith("b:")); // blank header → body hash
});
