// "Listening" is a CLAIM, and this is the predicate behind it.
//
// The Channels tab had two contradictory definitions of it side by side: the section
// badge said Listening the moment a receiver ROW existed, the row's own badge said it
// only once traffic had arrived. The row semantics won and `isReceiverLive` became the
// single definition — proven connectivity (an authenticated POST reached the endpoint),
// never proven leads. Nothing pinned that, so the cheapest "fix" for a confusing empty
// state — falling back to `acceptedCount > 0`, or to the row simply existing — would
// silently reinstate the green Listening badge over a receiver nothing has ever hit.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { isReceiverLive } from "./useChannelsReceivers";

const hook = (over: Partial<ChannelWebhookRecord>): ChannelWebhookRecord =>
  ({ token: "t1", channel: "email", receivedCount: 0, acceptedCount: 0, firstReceivedAt: null, ...over }) as ChannelWebhookRecord;

test("a receiver that has taken an authenticated POST is live", () => {
  assert.equal(isReceiverLive(hook({ receivedCount: 1 })), true);
  // The counter is the usual proof, but a row that recorded only the FIRST receipt
  // (a legacy row written before the counter existed) is live too.
  assert.equal(isReceiverLive(hook({ receivedCount: 0, firstReceivedAt: "2026-01-01T00:00:00.000Z" })), true);
});

test("a configured receiver nothing has reached is NOT live", () => {
  assert.equal(isReceiverLive(hook({})), false);
});

test("liveness is connectivity, not leads — a live-but-broken receiver stays live", () => {
  // Reaches the endpoint, then fails field mapping: zero candidates filed. That is
  // exactly the state the recruiter must be able to see, so it may not read as "Off".
  assert.equal(isReceiverLive(hook({ receivedCount: 12, acceptedCount: 0 })), true);
  // …and leads without a receipt cannot manufacture liveness in the other direction.
  assert.equal(isReceiverLive(hook({ receivedCount: 0, acceptedCount: 3 })), false);
});
