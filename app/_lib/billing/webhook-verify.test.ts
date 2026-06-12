// Pins the standard-webhooks verification the payment gate trusts money state
// to: HMAC over `${id}.${timestamp}.${body}`, base64 whsec_ secret, ±300s
// freshness, multi-signature (key rotation) tolerance, constant-time compare.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyStandardWebhook, WebhookVerificationError } from "./webhook-verify.ts";

const KEY = crypto.randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW_S = 1_750_000_000;
const BODY = '{"type":"subscription.active","data":{"id":"sub_1"}}';

function sign(id: string, timestamp: number, body: string, key: Buffer = KEY): string {
  return crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function headers(over: Partial<{ id: string; timestamp: string; signature: string }> = {}) {
  return {
    id: over.id ?? "evt_1",
    timestamp: over.timestamp ?? String(NOW_S),
    signature: over.signature ?? `v1,${sign("evt_1", NOW_S, BODY)}`,
  };
}

test("a correctly signed fresh delivery verifies", () => {
  verifyStandardWebhook(BODY, headers(), SECRET, { nowS: NOW_S });
});

test("a Polar-style raw secret (polar_whs_…) keys the HMAC with its UTF-8 bytes", () => {
  const polarSecret = "polar_whs_ovyN6cPrTv56AApvzCaJno08SSmGJmgb";
  const sig = sign("evt_1", NOW_S, BODY, Buffer.from(polarSecret, "utf-8"));
  verifyStandardWebhook(BODY, headers({ signature: `v1,${sig}` }), polarSecret, { nowS: NOW_S });
});

test("a tampered body is rejected", () => {
  assert.throws(
    () => verifyStandardWebhook(BODY.replace("sub_1", "sub_2"), headers(), SECRET, { nowS: NOW_S }),
    WebhookVerificationError
  );
});

test("a stale timestamp is rejected even with a valid signature", () => {
  const old = NOW_S - 3600;
  const h = { id: "evt_1", timestamp: String(old), signature: `v1,${sign("evt_1", old, BODY)}` };
  assert.throws(() => verifyStandardWebhook(BODY, h, SECRET, { nowS: NOW_S }), /tolerance/);
});

test("key rotation: any matching signature in the space-separated list passes", () => {
  const wrong = sign("evt_1", NOW_S, BODY, crypto.randomBytes(24));
  const good = sign("evt_1", NOW_S, BODY);
  verifyStandardWebhook(BODY, headers({ signature: `v1,${wrong} v1,${good}` }), SECRET, { nowS: NOW_S });
});

test("all-wrong signatures are rejected", () => {
  const wrong = sign("evt_1", NOW_S, BODY, crypto.randomBytes(24));
  assert.throws(
    () => verifyStandardWebhook(BODY, headers({ signature: `v1,${wrong}` }), SECRET, { nowS: NOW_S }),
    /no webhook signature matched/
  );
});

test("missing headers are rejected up front", () => {
  assert.throws(
    () => verifyStandardWebhook(BODY, { id: null, timestamp: String(NOW_S), signature: "v1,x" }, SECRET, { nowS: NOW_S }),
    /missing webhook/
  );
});

test("an unconfigured secret refuses to verify anything", () => {
  assert.throws(() => verifyStandardWebhook(BODY, headers(), "", { nowS: NOW_S }), /not configured/);
});
