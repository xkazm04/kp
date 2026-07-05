import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard for the Channels surface: channel_webhooks +
// channel_spend (db/channels.ts) and the comms outbox dev_outbox (db/devcase.ts).
// recordOutbox auto-derives the tenant from the referenced entry (like recordEvent);
// the recruiter list/create/revoke/spend paths filter workspace_id.
//
// EXEMPTION: the two RECEIVER-side liveness counters (recordChannelWebhookReceipt /
// recordChannelWebhookAccepted) stamp by the CSPRNG webhook token on the PUBLIC
// inbound endpoint — the token is the capability, same doctrine as offer/lead tokens.
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = [path.join(dir, "channels.ts"), path.join(dir, "devcase.ts")];
const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// A receiver-side liveness counter, stamped by webhook token on the public endpoint.
function isTokenCounter(sql: string): boolean {
  return /update\s+channel_webhooks\s+set\s+(received_count|accepted_count)/i.test(sql);
}

test("every channels/outbox query is workspace-scoped (receiver token counters exempt)", () => {
  const touching = sqlBlocks.filter((s) =>
    /\b(from|into|update|delete\s+from)\s+(channel_webhooks|channel_spend|dev_outbox)\b/i.test(s)
  );
  assert.ok(touching.length >= 9, `expected >=9 channels/outbox queries, found ${touching.length}`);
  assert.ok(touching.some(isTokenCounter), "expected the receiver-counter exemptions to match something");
  for (const sql of touching.filter((s) => !isTokenCounter(s))) {
    assert.ok(/workspace_id/.test(sql), `a channels/outbox query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
