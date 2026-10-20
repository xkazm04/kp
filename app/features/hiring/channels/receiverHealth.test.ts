// Receiver health verdict (challenge 2026-09-22 candidate-channels-ui/B).
//
// A receiver used to be binary: Waiting or Listening, where Listening meant one
// authenticated POST ever arrived. That painted a Zapier test ping followed by a week
// of rejected payloads green, and ignored the pull half (lastPullError) entirely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { receiverHealth, type ReceiverHealthInput } from "./receiverHealth";

const row = (over: Partial<ReceiverHealthInput>): ReceiverHealthInput => ({
  receivedCount: 0,
  acceptedCount: 0,
  firstReceivedAt: null,
  pullUrl: null,
  lastPullError: null,
  ...over,
});

test("never reached, nothing filed -> waiting (neutral), not live", () => {
  const h = receiverHealth(row({ receivedCount: 0, acceptedCount: 0, pullUrl: null }));
  assert.equal(h.verdict, "waiting");
  assert.equal(h.tone, "neutral");
  assert.equal(h.live, false);
  assert.equal(h.detail, null);
});

test("reached but nothing filed -> reachedNoLeads (caution), still live per isReceiverLive", () => {
  const h = receiverHealth(row({ receivedCount: 7, acceptedCount: 0, pullUrl: null }));
  assert.equal(h.verdict, "reachedNoLeads");
  assert.equal(h.tone, "caution");
  assert.equal(h.live, true, "liveness stays receipt-driven");
  assert.notEqual(h.tone, "positive", "a reached-but-empty row must not read as a healthy Listening");
});

test("reached and filing -> delivering (positive)", () => {
  const h = receiverHealth(row({ receivedCount: 7, acceptedCount: 3 }));
  assert.equal(h.verdict, "delivering");
  assert.equal(h.tone, "positive");
  assert.equal(h.live, true);
});

test("a failing pull overrides delivering; the raw error is DATA, never the headline", () => {
  const h = receiverHealth(
    row({ receivedCount: 7, acceptedCount: 3, pullUrl: "https://ats.example.com/feed", lastPullError: "HTTP 502" })
  );
  assert.equal(h.verdict, "pullFailing");
  assert.equal(h.tone, "critical");
  assert.equal(h.detail, "HTTP 502", "the machine string is exposed for a code-styled render");
  assert.match(h.key, /^[a-zA-Z.]+$/, "the headline is a catalog key");
  assert.notEqual(h.key, "HTTP 502");
  // A stale error on a receiver whose pull was since disabled is not a failing pull
  // (setChannelPull nulls it on write, but the verdict must not depend on that).
  assert.equal(receiverHealth(row({ acceptedCount: 3, receivedCount: 3, pullUrl: null, lastPullError: "HTTP 502" })).verdict, "delivering");
});
