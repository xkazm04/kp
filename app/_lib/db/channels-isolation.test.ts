import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  CHANNEL_WEBHOOK_LIST_DEFAULT_LIMIT,
  CHANNEL_WEBHOOK_LIST_MAX_LIMIT,
  createChannelWebhook,
  listChannelWebhooks,
  listChannelSpend,
  revokeChannelWebhook,
  setChannelSpend,
} from "./channels.ts";

after(() => cleanupUnitDb());

// Behavioral tenant-isolation for the Channels surface (P1).

test("channel webhooks are isolated per team, and cross-tenant revoke is a no-op", () => {
  const a = createChannelWebhook({ channel: "email", jobId: "job-a" }, "ws-a");
  const b = createChannelWebhook({ channel: "email", jobId: "job-b" }, "ws-b");

  const listA = listChannelWebhooks("ws-a").webhooks;
  assert.ok(listA.some((w) => w.token === a.token), "ws-a sees its own webhook");
  assert.ok(!listA.some((w) => w.token === b.token), "ws-a must NOT see ws-b's webhook");

  // A recruiter can't revoke another team's webhook even holding its token.
  assert.equal(revokeChannelWebhook(a.token, "ws-b"), false, "ws-b cannot revoke ws-a's webhook");
  assert.equal(revokeChannelWebhook(a.token, "ws-a"), true, "ws-a revokes its own");
});

test("channel spend is per-team — the same channel id holds independent figures", () => {
  setChannelSpend("linkedin", 1000, "ws-a");
  setChannelSpend("linkedin", 2000, "ws-b");
  assert.equal(listChannelSpend("ws-a").get("linkedin"), 1000);
  assert.equal(listChannelSpend("ws-b").get("linkedin"), 2000, "same channel id, isolated per team (composite PK)");

  // Clearing one team's figure leaves the other's intact.
  setChannelSpend("linkedin", null, "ws-a");
  assert.equal(listChannelSpend("ws-a").get("linkedin"), undefined);
  assert.equal(listChannelSpend("ws-b").get("linkedin"), 2000);
});

// The receivers list was unbounded and the whole Channels tab loads it on mount. The
// panes then filter it BY CHANNEL, which is why `truncated` matters more here than the
// row cost: a silent cut empties one pane and reads as "nothing is wired".
test("the receiver list is bounded, clamps a caller's limit, and says when it cut", () => {
  const ws = "ws-hook-bound";
  for (let i = 0; i < 5; i++) createChannelWebhook({ channel: "boards", jobId: `job-b${i}` }, ws);

  const page = listChannelWebhooks(ws, 2);
  assert.equal(page.webhooks.length, 2);
  assert.equal(page.truncated, true);

  const all = listChannelWebhooks(ws, CHANNEL_WEBHOOK_LIST_MAX_LIMIT);
  assert.equal(all.webhooks.length, 5);
  assert.equal(all.truncated, false);
  assert.equal(listChannelWebhooks(ws, 5).truncated, false, "a full page is not evidence of a next one");

  assert.equal(listChannelWebhooks(ws, 0).webhooks.length, 1, "below 1 clamps up to 1");
  assert.equal(listChannelWebhooks(ws, 10_000).webhooks.length, 5, "above MAX clamps down");
  assert.equal(listChannelWebhooks(ws, Number.NaN).webhooks.length, 5, "an unusable limit takes the default");
  assert.ok(CHANNEL_WEBHOOK_LIST_DEFAULT_LIMIT <= CHANNEL_WEBHOOK_LIST_MAX_LIMIT);

  // A revoked receiver is still out of the list, bound or no bound.
  revokeChannelWebhook(all.webhooks[0].token, ws);
  assert.equal(listChannelWebhooks(ws).webhooks.length, 4);
});
