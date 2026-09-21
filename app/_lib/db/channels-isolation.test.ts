import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  CHANNEL_WEBHOOK_LIST_DEFAULT_LIMIT,
  CHANNEL_WEBHOOK_LIST_MAX_LIMIT,
  createChannelWebhook,
  listChannelWebhooks,
  listChannelSpend,
  recordPullResult,
  revokeChannelWebhook,
  setChannelPull,
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

test("the receiver list projects recruiter-safe pull health and omits the secret", () => {
  // GET /api/channels/webhooks JSON.stringifies this record. A pull-configured hook
  // must carry the URL and hasPullSecret without ever putting the bearer on the wire;
  // a push-only hook must still carry the four fields, as null/false.
  process.env.KP_SECRET ??= "channels-isolation-secret";
  const ws = "ws-pull-health";
  const push = createChannelWebhook({ channel: "email", jobId: "job-push" }, ws);
  const pull = createChannelWebhook({ channel: "boards", jobId: "job-pull" }, ws);
  assert.equal(setChannelPull(pull.token, { url: "https://ats.example.com/feed", secret: "s3cret-token" }, ws), true);
  recordPullResult(pull.token, { error: "timeout contacting source" });

  const listed = listChannelWebhooks(ws).webhooks;
  const pushRow = listed.find((w) => w.token === push.token);
  const pullRow = listed.find((w) => w.token === pull.token);
  assert.ok(pushRow && pullRow);

  assert.equal(pushRow.pullUrl, null);
  assert.equal(pushRow.hasPullSecret, false);
  assert.equal(pushRow.lastPullAt, null);
  assert.equal(pushRow.lastPullError, null);

  assert.equal(pullRow.pullUrl, "https://ats.example.com/feed");
  assert.equal(pullRow.hasPullSecret, true);
  assert.ok(pullRow.lastPullAt, "a failed pull still stamps lastPullAt");
  assert.equal(pullRow.lastPullError, "timeout contacting source");

  const parsed = JSON.parse(JSON.stringify(pullRow)) as Record<string, unknown>;
  for (const key of ["secret", "pullSecret", "pull_secret"]) {
    assert.equal(key in parsed, false, `list JSON must not carry ${key}`);
  }
  const json = JSON.stringify(pullRow);
  assert.equal(json.includes("s3cret-token"), false);
  assert.equal(json.includes("v1:"), false, "ciphertext must not ride the list");
});
