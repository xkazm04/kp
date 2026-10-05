// One message's truth (level 3): the delivery timeline is built only from the row's own fields, a
// step with no time on record says so, and the note under the verdict never flatters.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../../channelsCommsHelpers.ts";
import { deliveryTimeline, letterCondition, messageNote } from "./channelsNightMessageModel.ts";

const AT = "2026-09-29T10:00:00.000Z";
const msg = (over: Partial<Message> = {}): Message => ({
  id: "m1", recipient: "jana@example.com", subject: "Offer", body: "Hi Jana,", kind: "offer_letter", channel: "webhook",
  status: "sent", ref: "e1", createdAt: AT, ...over,
});
const keys = (m: Message, relay = true) => deliveryTimeline(m, relay).map((s) => `${s.key}:${s.state}`);

test("a sent row: relayed, at the time it was recorded (the row is written after the relay answered)", () => {
  const [only, ...rest] = deliveryTimeline(msg(), true);
  assert.deepEqual(rest, []);
  assert.equal(only.key, "relayed");
  assert.equal(only.at, AT);
});

test("a queued row never reaches a relay later, with or without one now", () => {
  assert.deepEqual(keys(msg({ status: "queued" }), false), ["recorded:done", "neverHanded:blocked"]);
  assert.deepEqual(keys(msg({ status: "queued" }), true), ["recorded:done", "neverHanded:blocked"]);
  assert.equal(deliveryTimeline(msg({ status: "queued" }), false)[1].variant, "relayOff");
  assert.equal(deliveryTimeline(msg({ status: "queued" }), true)[1].variant, "relayOn");
  assert.equal(deliveryTimeline(msg({ status: "queued" }), false)[1].at, null, "no time is invented for a step that cannot happen");
});

test("a dead letter carries its recorded reason and waits on a person; no reason is null, not prose", () => {
  const t = deliveryTimeline(msg({ status: "failed", failureDetail: "http 502" }), true);
  assert.deepEqual(t.map((s) => `${s.key}:${s.state}`), ["deadLettered:done", "needsYou:pending"]);
  assert.equal(t[0].detail, "http 502");
  assert.equal(deliveryTimeline(msg({ status: "failed", failureDetail: null }), true)[0].detail, null);
});

test("a recovered row: the failure, then the resend at its own recorded time", () => {
  const t = deliveryTimeline(msg({ status: "failed", recovered: true, recoveredAt: "2026-09-29T11:00:00.000Z", failureDetail: "http 503" }), true);
  assert.deepEqual(t.map((s) => s.key), ["deadLettered", "resent"]);
  assert.equal(t[1].at, "2026-09-29T11:00:00.000Z");
  assert.equal(deliveryTimeline(msg({ status: "failed", recovered: true }), true)[1].at, null, "no recoveredAt: no time");
});

test("a bounce: relayed, bounced with the relay's words, then a corrected address", () => {
  const t = deliveryTimeline(msg({ bounced: true, bouncedAt: "2026-09-29T12:00:00.000Z", bounceDetail: "550 mailbox unavailable" }), true);
  assert.deepEqual(t.map((s) => `${s.key}:${s.state}`), ["relayed:done", "bounced:done", "needsAddress:pending"]);
  assert.equal(t[1].detail, "550 mailbox unavailable");
});

test("an unmatched receipt: it arrived, and matched nothing", () => {
  assert.deepEqual(keys(msg({ status: "bounced", orphaned: true })), ["receiptArrived:done", "unmatched:pending"]);
});

test("the note: queued with no relay is the loud one; sent and recovered carry none", () => {
  assert.deepEqual(messageNote("queued", false), { key: "queuedNoRelay", tone: "critical" });
  assert.deepEqual(messageNote("queued", true), { key: "queuedLater", tone: "caution" });
  assert.deepEqual(messageNote("failed", true), { key: "failed", tone: "critical" });
  assert.deepEqual(messageNote("bounced", true), { key: "bounced", tone: "critical" });
  assert.deepEqual(messageNote("orphaned", true), { key: "orphaned", tone: "caution" });
  assert.equal(messageNote("sent", true), null);
  assert.equal(messageNote("recovered", true), null);
});

test("the letter's drawing: evidence is live, needs-you fails, a receipt reaches, queued waits", () => {
  assert.equal(letterCondition("sent"), "live");
  assert.equal(letterCondition("recovered"), "live");
  assert.equal(letterCondition("failed"), "fail");
  assert.equal(letterCondition("bounced"), "fail");
  assert.equal(letterCondition("orphaned"), "reach");
  assert.equal(letterCondition("queued"), "wait");
});
