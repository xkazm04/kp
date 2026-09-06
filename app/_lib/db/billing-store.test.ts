// Store-level contracts for the money tables that no other suite pins: the
// compare-and-swap on `billing_state`, the bound on the alert worklist, and the
// retention horizon on the provider-event payloads.
//
// The org axis lives in billing-tenancy.test.ts; the reducer's decisions in
// billing/reduce.test.ts; the whole stack via a fake gateway in billing-gate.test.ts.
// This file is about the WRITE ITSELF — what happens when two writers meet, and what
// happens to rows nobody looks at again.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  BILLING_ALERT_LIST_DEFAULT_LIMIT,
  BILLING_ALERT_LIST_MAX_LIMIT,
  BILLING_EVENT_PAYLOAD_RETENTION_DAYS,
  getBillingState,
  insertBillingEvent,
  listBillingAlerts,
  pruneBillingEventPayloads,
  recordBillingAlert,
  upsertBillingState,
} from "./billing.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- billing_state is a compare-and-swap, not a blind overwrite -------------------
//
// The webhook's staleness guards (sync.ts → subscriptionWriteIsStale and friends) are a
// read→compute→write: they SELECT the current row, decide from it, and then write. The
// UPDATE used to re-assert nothing, so a second writer that landed in between was
// overwritten without a trace — no error, no failing test, and a paying customer
// regressed to a snapshot an earlier decision had approved. `.claude/CLAUDE.md` gives
// two legal strategies for that shape; this store takes the compensating precondition
// (`DO UPDATE … WHERE updated_at IS ?` + a `res.changes === 0` skip), which leaves the
// ingest transaction in sync.ts untouched.

test("an out-of-order second writer does NOT clobber the newer state", () => {
  // The seed both writers read.
  upsertBillingState({ plan: "starter", status: "active", provider: "polar", providerSubscriptionId: "sub_cas" });
  const read = getBillingState();
  assert.ok(read, "seed row must exist");

  // Writer B — the NEWER decision — lands first and wins.
  const bWon = upsertBillingState({
    plan: "growth",
    status: "active",
    provider: "polar",
    providerSubscriptionId: "sub_cas",
    expectedUpdatedAt: read.updatedAt,
  });
  assert.equal(bWon, true);
  assert.equal(getBillingState()?.plan, "growth");

  // Writer A — an OLDER delivery whose decision was computed from the SAME read — now
  // tries to apply. NON-VACUITY: with the old blind `ON CONFLICT DO UPDATE` this write
  // lands and the customer drops to free; here the precondition rejects it.
  const aWon = upsertBillingState({
    plan: "free",
    status: "none",
    provider: "polar",
    expectedUpdatedAt: read.updatedAt,
  });
  assert.equal(aWon, false, "a write computed from a superseded row must be DROPPED");
  assert.equal(getBillingState()?.plan, "growth", "the newer state survives");
  assert.equal(getBillingState()?.status, "active");
});

test("`expectedUpdatedAt: null` means 'I read no row' — an existing row makes it a skip", () => {
  const before = getBillingState();
  assert.ok(before, "previous test left a row");
  const won = upsertBillingState({ plan: "free", status: "none", provider: "polar", expectedUpdatedAt: null });
  assert.equal(won, false, "a first-write decision must not overwrite a row that appeared meanwhile");
  assert.equal(getBillingState()?.plan, before.plan);
});

test("an ABSENT expectedUpdatedAt is an unconditional write (fixtures, seeds, tests)", () => {
  const won = upsertBillingState({ plan: "starter", status: "active", provider: "polar" });
  assert.equal(won, true);
  assert.equal(getBillingState()?.plan, "starter");
});

test("the CAS token always MOVES, so two writes in the same millisecond cannot alias", () => {
  const first = getBillingState();
  assert.ok(first);
  // Back-to-back synchronous writes: ISO strings are millisecond-resolution, so without
  // the advance in upsertBillingState both would stamp the same `updated_at` and a third
  // writer holding the FIRST token would match a row it never read.
  upsertBillingState({ plan: "growth", status: "active", provider: "polar", expectedUpdatedAt: first.updatedAt });
  const second = getBillingState();
  assert.ok(second);
  assert.ok(second.updatedAt > first.updatedAt, `updated_at must advance (${first.updatedAt} → ${second.updatedAt})`);
});

test("sync.ts passes the precondition through on BOTH write paths", () => {
  // A source guard, because the store's CAS is only worth anything if the ONE caller
  // that races (the webhook apply) actually opts in. CRLF-normalized: this checkout is
  // CRLF on Windows while the worktree may be LF.
  const src = readFileSync(path.join(here, "..", "billing", "sync.ts"), "utf8").replace(/\r\n/g, "\n");
  const passes = [...src.matchAll(/expectedUpdatedAt: prior\?\.updatedAt \?\? null/g)];
  assert.equal(passes.length, 2, "set_subscription and clear_subscription must both re-assert the row they read");
  assert.equal([...src.matchAll(/upsertBillingState\(/g)].length, 2, "a third write path would need its own precondition");
});

// ---- the alert worklist is BOUNDED ------------------------------------------------

test("listBillingAlerts clamps its limit and never reads the whole table", () => {
  for (let i = 0; i < 12; i += 1) {
    recordBillingAlert({ kind: "unmapped_product", detail: `dark subscription ${i}`, providerRef: `unmapped:sub_${i}` });
  }
  // NON-VACUITY: the query had no LIMIT at all, so this returned all 12.
  assert.equal(listBillingAlerts({ limit: 5 }).length, 5);
  // Newest first — a bounded page must be the page an operator wants.
  assert.equal(listBillingAlerts({ limit: 1 })[0].detail, "dark subscription 11");
  // Nonsense is clamped rather than trusted: 0 and negatives floor at one row, a huge
  // ask is capped at the ceiling (fewer rows exist here, so it simply returns them all).
  assert.equal(listBillingAlerts({ limit: 0 }).length, 1);
  assert.equal(listBillingAlerts({ limit: -20 }).length, 1);
  assert.equal(listBillingAlerts({ limit: Number.NaN }).length, 12);
  assert.equal(listBillingAlerts({ limit: 10_000 }).length, 12);
  // And the default is itself a bound, not "everything".
  assert.ok(BILLING_ALERT_LIST_DEFAULT_LIMIT > 0 && BILLING_ALERT_LIST_DEFAULT_LIMIT <= BILLING_ALERT_LIST_MAX_LIMIT);
  assert.equal(listBillingAlerts().length, 12);
});

// ---- provider-event payloads have a horizon ---------------------------------------

test("aged provider payloads are blanked while the idempotency row survives", () => {
  assert.equal(insertBillingEvent("evt_old", "subscription.active", JSON.stringify({ secret: "old body" })), true);
  assert.equal(insertBillingEvent("evt_recent", "subscription.active", JSON.stringify({ secret: "recent body" })), true);
  // Backdate one delivery past the window. (The store stamps `received_at` itself, so
  // ageing a row is the only way to reach the boundary from a test.)
  const aged = new Date(Date.now() - (BILLING_EVENT_PAYLOAD_RETENTION_DAYS + 1) * 86_400_000).toISOString();
  ensureDb().prepare(`UPDATE billing_events SET received_at = ? WHERE id = 'evt_old'`).run(aged);

  assert.equal(pruneBillingEventPayloads(), 1, "exactly the aged delivery");
  const rows = ensureDb().prepare(`SELECT id, payload_json FROM billing_events ORDER BY id`).all() as Array<{
    id: string;
    payload_json: string;
  }>;
  assert.deepEqual(rows.map((r) => r.id), ["evt_old", "evt_recent"], "the ROW is the idempotency gate — it is never deleted");
  assert.equal(rows.find((r) => r.id === "evt_old")?.payload_json, "");
  assert.match(rows.find((r) => r.id === "evt_recent")?.payload_json ?? "", /recent body/);

  // The gate still holds for the blanked delivery: a very late redelivery must not
  // re-apply a plan change just because its body aged out.
  assert.equal(insertBillingEvent("evt_old", "subscription.active", "{}"), false);

  // Idempotent: a second sweep over the same rows changes nothing.
  assert.equal(pruneBillingEventPayloads(), 0);
});
