import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createChannelWebhook, listChannelWebhooks, revokeChannelWebhook, setChannelSpend, listChannelSpend } from "./channels.ts";

after(() => cleanupUnitDb());

// Behavioral tenant-isolation for the Channels surface (P1).

test("channel webhooks are isolated per team, and cross-tenant revoke is a no-op", () => {
  const a = createChannelWebhook({ channel: "email", jobId: "job-a" }, "ws-a");
  const b = createChannelWebhook({ channel: "email", jobId: "job-b" }, "ws-b");

  const listA = listChannelWebhooks("ws-a");
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
