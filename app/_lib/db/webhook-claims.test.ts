// The durable webhook claim — what the inbound receiver, the pull pass, the edge drain
// and the agent-report route all dedupe on.
//
// It used to be `new Map()` in webhook-idempotency.ts, and the one event that makes a
// replay happen (the process dying between apply and ack, or mid-page) was the one
// event that emptied it. These cases pin the store that replaced it:
//
//   1. a SETTLED key stays settled across a restart (the replay is absorbed);
//   2. an UNSETTLED key (a crash mid-work) re-opens once its lease runs out, so the
//      delivery re-runs instead of being dropped;
//   3. the mark is a uniqueness-enforced write, not a read-then-write;
//   4. release() still gives the key back on the failure path;
//   5. settled keys expire after the done-horizon and a lazy sweep deletes them, so
//      the table is bounded;
//   9. the row never holds the composed key: today's keys embed the receiver's raw
//      capability token, and a DB row is a place security:secrets does not look.
//
// A "restart" is the real one as far as SQLite can tell: the memoized connection is
// closed and dropped, and the next call reopens the same KP_DB_PATH.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import {
  claimWebhookKey,
  releaseWebhookKey,
  settleWebhookKey,
  sweepWebhookClaims,
  webhookClaimDigest,
} from "./webhook-claims.ts";

after(() => cleanupUnitDb());

const here = path.dirname(fileURLToPath(import.meta.url));
const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };

/** Drop every in-memory handle to the database; the next call reopens the same file. */
function restart(): void {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
}

const LEASE = 10 * 60_000;
const HORIZON = 7 * 24 * 60 * 60_000;
// A clock well clear of anything Date.now() will produce during the run, advanced per
// case so one case's sweep can never reach another's live rows.
let clock = Date.UTC(2031, 0, 1);
function freshClock(): number {
  clock += 10 * HORIZON;
  return clock;
}

function rowFor(key: string): { state: string; expires_at: number } | undefined {
  return ensureDb()
    .prepare(`SELECT state, expires_at FROM webhook_claims WHERE key = ?`)
    .get(webhookClaimDigest(key)) as { state: string; expires_at: number } | undefined;
}

test("case 1: a settled delivery stays settled across a process restart", () => {
  const t0 = freshClock();
  const key = "inbound:tok-case1:b:abc";
  assert.equal(claimWebhookKey(key, LEASE, t0), true, "the first delivery claims");
  settleWebhookKey(key, HORIZON, t0 + 1_000);
  restart();
  assert.equal(claimWebhookKey(key, LEASE, t0 + 2 * LEASE), false, "the post-restart replay is a duplicate");
  assert.equal(rowFor(key)?.state, "done");
});

test("case 2: a crash mid-work re-runs after the lease instead of losing the delivery", () => {
  const t0 = freshClock();
  const key = "edge:0011223344556677:42";
  assert.equal(claimWebhookKey(key, LEASE, t0), true);
  // never settled — the process died with the work half-done
  restart();
  assert.equal(claimWebhookKey(key, LEASE, t0 + LEASE - 1), false, "inside the lease the first run may still be alive");
  assert.equal(claimWebhookKey(key, LEASE, t0 + LEASE + 1), true, "past the lease the delivery is re-run, not dropped");
  assert.equal(rowFor(key)?.state, "inflight");
});

test("case 3: the mark is a uniqueness-enforced write (ON CONFLICT + a changes check)", () => {
  const t0 = freshClock();
  const key = "agent-report:tok-case3:h:evt-1";
  assert.equal(claimWebhookKey(key, LEASE, t0), true);
  assert.equal(claimWebhookKey(key, LEASE, t0 + 5), false, "a second claim inside the lease loses");
  assert.equal(
    (ensureDb().prepare(`SELECT COUNT(*) AS c FROM webhook_claims WHERE key = ?`).get(webhookClaimDigest(key)) as { c: number }).c,
    1,
  );
  // The structural half: one INSERT that the PRIMARY KEY arbitrates, decided by
  // `changes` — a SELECT-then-INSERT would let two racing writers both win.
  const src = readFileSync(path.join(here, "webhook-claims.ts"), "utf8");
  const claimFn = src.slice(src.indexOf("export function claimWebhookKey"));
  const body = claimFn.slice(0, claimFn.indexOf("\n}\n"));
  assert.match(body, /ON CONFLICT\s*\(\s*key\s*\)\s*DO UPDATE/);
  assert.match(body, /\.changes\s*===\s*1/);
  assert.doesNotMatch(body, /SELECT/i, "the claim decides from the write, never from a prior read");
});

test("case 4: release() re-opens the key for the failure path", () => {
  const t0 = freshClock();
  const key = "inbound:tok-case4:b:def";
  assert.equal(claimWebhookKey(key, LEASE, t0), true);
  releaseWebhookKey(key);
  assert.equal(claimWebhookKey(key, LEASE, t0 + 5), true);
});

test("case 5: a settled key expires after the done-horizon, and the sweep bounds the table", () => {
  const t0 = freshClock();
  const key = "inbound:tok-case5:b:ghi";
  const stale = "inbound:tok-case5:b:stale";
  assert.equal(claimWebhookKey(key, LEASE, t0), true);
  settleWebhookKey(key, HORIZON, t0);
  assert.equal(claimWebhookKey(stale, LEASE, t0), true);
  settleWebhookKey(stale, HORIZON, t0);

  assert.equal(claimWebhookKey(key, LEASE, t0 + HORIZON - 1), false, "inside the horizon: still a duplicate");
  assert.ok(rowFor(stale), "precondition: the not-yet-expired row is there");

  // Past the horizon: the key is processed again, and the claim's own LAZY sweep
  // (nobody ever claims `stale` again) is what removes the other expired row.
  assert.equal(claimWebhookKey(key, LEASE, t0 + HORIZON + 5 * 60_000), true, "past the horizon: processed again");
  assert.equal(rowFor(stale), undefined, "expired rows do not accumulate");
  assert.ok(rowFor(key), "a live (re-claimed) row survives the sweep");

  // The explicit sweep is idempotent and reports what it removed.
  assert.equal(claimWebhookKey(stale, LEASE, t0 + HORIZON + 5 * 60_000), true);
  assert.equal(sweepWebhookClaims(t0 + HORIZON + 5 * 60_000 + LEASE + 1) >= 2, true, "both lapsed leases are swept");
  assert.equal(rowFor(stale), undefined);
});

test("case 9: no row carries the receiver's capability token", () => {
  const t0 = freshClock();
  const token = "whk_S3cretCapabilityToken_0123456789";
  const header = "provider-idem-key-verbatim-7f3a";
  assert.equal(claimWebhookKey(`inbound:${token}:x`, LEASE, t0), true);
  assert.equal(claimWebhookKey(`agent-report:${token}:h:${header}`, LEASE, t0), true);
  settleWebhookKey(`inbound:${token}:x`, HORIZON, t0);
  const rows = ensureDb().prepare(`SELECT * FROM webhook_claims`).all();
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(token), "the raw token must never be persisted");
  assert.ok(!dump.includes(header), "nor the provider's raw Idempotency-Key header");
  assert.match(webhookClaimDigest(`inbound:${token}:x`), /^[0-9a-f]{64}$/, "the stored key is a sha256 hex digest");
});
