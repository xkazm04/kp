// P1-5: webhook envelope + HMAC signing/verification.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildEnvelope,
  isAtsEvent,
  signWebhookBody,
  SUBSCRIBABLE_EVENTS,
  verifyWebhookSignature,
} from "./ats-webhook.ts";
import { ATS_SCHEMA_VERSION } from "./ats-record.ts";

test("buildEnvelope stamps the event, time, and schema version", () => {
  const env = buildEnvelope("ping", { ping: true }, "2026-06-20T00:00:00.000Z");
  assert.equal(env.event, "ping");
  assert.equal(env.sentAt, "2026-06-20T00:00:00.000Z");
  assert.equal(env.schemaVersion, ATS_SCHEMA_VERSION);
  assert.deepEqual(env.data, { ping: true });
});

test("signWebhookBody is the sha256= HMAC of the exact body (known vector)", () => {
  const body = '{"hello":"world"}';
  const expected = "sha256=" + createHmac("sha256", "topsecret").update(body, "utf8").digest("hex");
  assert.equal(signWebhookBody("topsecret", body), expected);
});

test("verify round-trips a freshly signed body", () => {
  const body = JSON.stringify({ event: "candidate.hired", n: 1 });
  const sig = signWebhookBody("s3cr3t", body);
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig), true);
});

test("verify rejects a wrong secret, tampered body, or missing signature", () => {
  const body = JSON.stringify({ a: 1 });
  const sig = signWebhookBody("right", body);
  assert.equal(verifyWebhookSignature("wrong", body, sig), false);
  assert.equal(verifyWebhookSignature("right", body + " ", sig), false);
  assert.equal(verifyWebhookSignature("right", body, null), false);
  assert.equal(verifyWebhookSignature("right", body, "sha256=deadbeef"), false); // length-mismatched, no throw
});

test("isAtsEvent + subscribable set (ping is not subscribable)", () => {
  assert.equal(isAtsEvent("candidate.hired"), true);
  assert.equal(isAtsEvent("nope"), false);
  assert.equal(SUBSCRIBABLE_EVENTS.includes("ping" as never), false);
  assert.ok(SUBSCRIBABLE_EVENTS.includes("candidate.hired"));
});
