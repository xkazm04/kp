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
// The guard demands a BOUND PREDICATE, not the mere presence of the string
// "workspace_id" somewhere in the statement — a column named in a SELECT list or an
// ORDER BY scopes nothing. It used to demand only the latter, and channel_webhooks is
// read through a composed fragment (WEBHOOK_SELECT + a per-call WHERE), so the only
// channel_webhooks SELECT it ever inspected was the bare fragment, which passed purely
// on `w.workspace_id` appearing in its select list. The three statements that actually
// run were invisible to it: deleting `AND w.workspace_id = ?` from listChannelWebhooks
// — which renders every team's receivers, tokens and confidential role titles in every
// other team's Channels tab — left this test green. The fragment is now resolved into
// its call sites before anything is checked.
//
// EXEMPTIONS, each named so it is visible rather than accidental:
//   - the two RECEIVER-side liveness counters (recordChannelWebhookReceipt /
//     recordChannelWebhookAccepted), stamped by the CSPRNG webhook token on the PUBLIC
//     inbound endpoint — the token is the capability, same doctrine as offer/lead tokens;
//   - the by-token reads on that same doctrine: getActiveChannelWebhook (the receiver's
//     lookup) and createChannelWebhook's re-read of a token it just generated;
//   - the CLOCK-side pull sweep (listPullSources / recordPullResult, L0 —
//     docs/concepts/local-first-edge.md). There is ONE clock per installation and it
//     must poll EVERY team's sources, exactly as the automation pass sweeps every
//     team's entries; each row carries its own workspace_id and the lead it produces
//     is filed into THAT team by the intake core, so the sweep is scoped per LEAD
//     rather than per SWEEP. The recruiter-facing half of the same feature
//     (getChannelPullConfig / setChannelPull) is scoped like every other management
//     path and is NOT exempt — which is what keeps this exemption narrow.
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = [path.join(dir, "channels.ts"), path.join(dir, "devcase.ts")];
const src = files.map((f) => readFileSync(f, "utf8")).join("\n");

// channel_webhooks is read through ONE shared fragment. Inline it into its call sites and
// drop the fragment itself — it is a projection, never an executable statement.
const fragment = (/const WEBHOOK_SELECT = `([^`]*)`/.exec(src)?.[1] ?? "").trim();
assert.ok(fragment.includes("FROM channel_webhooks"), "WEBHOOK_SELECT no longer resolves — the guard would go blind");

const statements = [...src.matchAll(/`([^`]*)`/g)]
  .map((m) => m[1])
  .filter((s) => s.trim() !== fragment)
  .map((s) => s.replaceAll("${WEBHOOK_SELECT}", fragment));

// A receiver-side liveness counter, stamped by webhook token on the public endpoint.
function isTokenCounter(sql: string): boolean {
  return /update\s+channel_webhooks\s+set\s+(received_count|accepted_count)/i.test(sql);
}

// A by-token read of channel_webhooks: the CSPRNG token IS the capability.
function isTokenLookup(sql: string): boolean {
  return /\bfrom\s+channel_webhooks\b/i.test(sql) && /\bwhere\s+w\.token\s*=\s*\?/i.test(sql);
}

// The clock's installation-wide pull sweep. Recognized by the pull columns it reads
// or writes, so a future recruiter-facing query over the same table is not covered.
function isClockPullSweep(sql: string): boolean {
  return (
    /from\s+channel_webhooks[\s\S]*pull_url\s+is\s+not\s+null/i.test(sql) ||
    /update\s+channel_webhooks\s+set\s+last_pull_at/i.test(sql)
  );
}

/** The part of the statement that can actually SCOPE it: an INSERT is scoped by the
 *  column it writes, everything else by its WHERE predicate. A statement with no WHERE
 *  yields "" and fails, which is the whole point. */
function scopingClause(sql: string): string {
  if (/\binsert\s+(or\s+\w+\s+)?into\b/i.test(sql)) {
    const values = sql.search(/\bvalues\b/i);
    return values >= 0 ? sql.slice(0, values) : sql;
  }
  return /\bwhere\b([\s\S]*)$/i.exec(sql)?.[1] ?? "";
}

test("every channels/outbox statement is workspace-scoped BY PREDICATE (by-token receiver paths exempt)", () => {
  const touching = statements.filter((s) =>
    /\b(from|into|update|delete\s+from)\s+(channel_webhooks|channel_spend|dev_outbox)\b/i.test(s)
  );
  assert.ok(touching.length >= 12, `expected >=12 channels/outbox statements, found ${touching.length}`);
  assert.ok(touching.some(isTokenCounter), "expected the receiver-counter exemptions to match something");
  assert.ok(touching.some(isTokenLookup), "expected the by-token receiver reads to resolve (fragment inlining works)");
  assert.ok(touching.some(isClockPullSweep), "expected the clock's pull sweep to match something");
  for (const sql of touching.filter((s) => !isTokenCounter(s) && !isTokenLookup(s) && !isClockPullSweep(s))) {
    assert.ok(
      /workspace_id/i.test(scopingClause(sql)),
      `a channels/outbox statement is NOT workspace-scoped by predicate:\n${sql.replace(/\s+/g, " ").trim().slice(0, 220)}`
    );
  }
});
