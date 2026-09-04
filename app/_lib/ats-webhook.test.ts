// P1-5: webhook envelope + HMAC signing/verification.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildEnvelope,
  isAtsEvent,
  signWebhookBody,
  SIGNATURE_TOLERANCE_SECONDS,
  TIMESTAMP_HEADER,
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

// --- the timestamped scheme (/perfect 2026-09-03, integrations-settings) ------------
//
// The signature used to cover the BODY ALONE, so it never expired: one captured
// delivery could be replayed verbatim at any later moment and still verify. These pin
// the replacement — the instant is signed WITH the body, and a receiver checks a stated
// skew window — and pin that the old scheme still verifies for a receiver that has not
// migrated.
//
// NON-VACUITY: pre-change, `signWebhookBody` took two arguments and ignored a third, so
// the "timestamp changes the signature" assertion fails (both sides identical); and
// `verifyWebhookSignature` took no options object, so every skew assertion below fails
// (a stale timestamp verified).

test("a timestamp changes the signed input — the instant is authenticated, not decoration", () => {
  const body = JSON.stringify({ event: "ping", data: { ping: true } });
  const at = "2026-09-03T10:00:00.000Z";
  const bodyOnly = signWebhookBody("s3cr3t", body);
  const timestamped = signWebhookBody("s3cr3t", body, at);
  assert.notEqual(timestamped, bodyOnly, "signing with a timestamp must not equal signing without one");
  // …and it is a function of the timestamp, so the header cannot be edited in flight.
  assert.notEqual(signWebhookBody("s3cr3t", body, "2026-09-03T10:00:01.000Z"), timestamped);
  // The exact construction a receiver must reimplement: HMAC over `<timestamp>.<body>`.
  assert.equal(timestamped, signWebhookBody("s3cr3t", `${at}.${body}`));
});

test("a fresh timestamped delivery verifies; a REPLAY of the same bytes past the window does not", () => {
  const body = JSON.stringify({ event: "candidate.hired", sentAt: "2026-09-03T10:00:00.000Z" });
  const at = "2026-09-03T10:00:00.000Z";
  const now = Date.parse(at);
  const sig = signWebhookBody("s3cr3t", body, at);

  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now }), true);
  // Inside the window, both directions (clock skew is symmetric).
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now + 299_000 }), true);
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now - 299_000 }), true);
  // The replay: the identical captured header+body pair, re-sent later. This is the
  // whole point — the bytes are authentic, and it is refused anyway.
  assert.equal(
    verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now + 301_000 }),
    false,
    "a delivery replayed past the tolerance window must be refused",
  );
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now - 301_000 }), false);
  // The stated default is what an omitted tolerance uses.
  assert.equal(SIGNATURE_TOLERANCE_SECONDS, 300);
  assert.equal(
    verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000 }),
    false,
  );
  // …and a caller may state its own.
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, { timestamp: at, nowMs: now + 301_000, toleranceSeconds: 600 }), true);
});

test("the timestamp cannot be moved to keep a captured signature alive", () => {
  const body = JSON.stringify({ ping: true });
  const at = "2026-09-03T10:00:00.000Z";
  const sig = signWebhookBody("s3cr3t", body, at);
  // An attacker holding (body, sig, at) advances the header to beat the window. The
  // timestamp is inside the HMAC, so the signature no longer matches.
  const moved = "2026-09-03T11:00:00.000Z";
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, { timestamp: moved, nowMs: Date.parse(moved) }), false);
});

test("asking for the timestamped scheme and getting no usable header is a REFUSAL, never a downgrade", () => {
  const body = JSON.stringify({ ping: true });
  const at = "2026-09-03T10:00:00.000Z";
  const now = Date.parse(at);
  const bodyOnly = signWebhookBody("s3cr3t", body);
  // A sender that signs the body alone, answering a receiver that asked for the
  // timestamped scheme: the missing/blank/unparseable header must not fall back to the
  // replayable verification, which is exactly the downgrade an attacker would force.
  for (const header of [null, "", "not-a-date"]) {
    assert.equal(verifyWebhookSignature("s3cr3t", body, bodyOnly, { timestamp: header, nowMs: now }), false, `header=${header}`);
  }
});

test("the body-only scheme is unchanged for a receiver that has not migrated", () => {
  const body = JSON.stringify({ ping: true });
  const sig = signWebhookBody("s3cr3t", body);
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig), true);
  assert.equal(verifyWebhookSignature("s3cr3t", body, sig, {}), true, "an empty options object is still body-only");
  assert.equal(verifyWebhookSignature("wrong", body, sig), false);
});

test("the timestamp header is the same ISO instant the envelope carries in sentAt", () => {
  const at = "2026-09-03T10:00:00.000Z";
  assert.equal(buildEnvelope("ping", { ping: true }, at).sentAt, at);
  assert.equal(TIMESTAMP_HEADER, "x-kp-timestamp");
});
