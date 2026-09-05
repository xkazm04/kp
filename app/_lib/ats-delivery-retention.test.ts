// The delivery ledger's THREE unguarded edges, pinned:
//   A. the CLAIM — two sweeps read the same due list, and without a compare-and-swap on
//      (status, attempts) both deliver the row (a duplicate hire in the customer's ATS).
//   B. RETENTION — `ats_delivery` had no DELETE anywhere in the tree, so a row per
//      attempt-set of every mirrored event accrued forever, each naming a candidate's
//      pipeline entry.
//   C. the STATUS CAST — mapRow cast the TEXT column straight to the union, so a
//      hand-edited or future-version row handed every reader a value outside the type.
//
// NON-VACUITY: pre-change claimAtsDelivery and pruneAtsDeliveries did not exist, and the
// bogus-status row read back as `"bogus"` — the assertions below fail on all three counts.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store module
// resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import {
  DELIVERY_RETENTION_DAYS,
  claimAtsDelivery,
  finalizeAtsDelivery,
  getAtsDelivery,
  listAtsDeliveries,
  pruneAtsDeliveries,
  recordAtsDeliveryStart,
} from "./ats-delivery-store.ts";

after(() => cleanupUnitDb());

const DAY_MS = 86_400_000;

// A — the claim.
test("a due row can be claimed exactly once; a stale attempt count never claims it", () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-claim-1");
  finalizeAtsDelivery(id, { delivered: false, reason: "transient" }, new Date(Date.now() - 3600_000));
  const row = getAtsDelivery(id)!;
  assert.equal(row.status, "failed");

  assert.equal(claimAtsDelivery(id, row.attempts), true, "the first sweep owns the attempt");
  assert.equal(claimAtsDelivery(id, row.attempts), false, "a concurrent sweep is refused — it must skip, not deliver");
  assert.equal(getAtsDelivery(id)?.status, "pending", "the claimed row leaves the due list for the duration");
});

test("a claim against an attempt count the row has moved past is refused", () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-claim-2");
  finalizeAtsDelivery(id, { delivered: false, reason: "transient" }, new Date(Date.now() - 3600_000));
  assert.equal(claimAtsDelivery(id, 99), false, "the sweep read a version of this row that no longer exists");
});

// B — retention.
test("the retention sweep drops TERMINAL rows past the window and keeps live work", () => {
  const old = new Date(Date.now() - (DELIVERY_RETENTION_DAYS + 1) * DAY_MS);
  const recent = new Date(Date.now() - 1000);

  const delivered = recordAtsDeliveryStart("candidate.hired", "pe-ret-delivered");
  finalizeAtsDelivery(delivered, { delivered: true, status: 200 }, old);

  const deadLetter = recordAtsDeliveryStart("candidate.hired", "pe-ret-dead");
  // Six failures exhaust MAX_ATTEMPTS, so the row dead-letters (next_attempt_at NULL).
  for (let i = 0; i < 6; i++) finalizeAtsDelivery(deadLetter, { delivered: false, reason: "down" }, old);

  const retryable = recordAtsDeliveryStart("candidate.hired", "pe-ret-retryable");
  finalizeAtsDelivery(retryable, { delivered: false, reason: "transient" }, old);

  const pending = recordAtsDeliveryStart("candidate.hired", "pe-ret-pending");
  const fresh = recordAtsDeliveryStart("candidate.hired", "pe-ret-fresh");
  finalizeAtsDelivery(fresh, { delivered: true, status: 200 }, recent);

  const dropped = pruneAtsDeliveries();
  assert.ok(dropped >= 2, `the two terminal, aged rows are dropped (got ${dropped})`);
  assert.equal(getAtsDelivery(delivered), null, "an aged delivered row is history, not state");
  assert.equal(getAtsDelivery(deadLetter), null, "an aged dead-letter goes with it");
  assert.ok(getAtsDelivery(retryable), "a still-scheduled failure is LIVE WORK, however old — never swept");
  assert.ok(getAtsDelivery(pending), "an in-flight attempt owns its row");
  assert.ok(getAtsDelivery(fresh), "and a recent delivery is still inside the window");
});

// C — the status guard.
test("a row whose status is not in the vocabulary reads as failed instead of leaking the raw value", () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-bogus-status");
  const d = new Database(UNIT_DB_PATH);
  try {
    d.pragma("busy_timeout = 5000");
    d.prepare(`UPDATE ats_delivery SET status = 'zombie' WHERE id = ?`).run(id);
  } finally {
    d.close();
  }
  const row = listAtsDeliveries(500).find((r) => r.id === id);
  assert.equal(row?.status, "failed", "fail closed: visible to the operator, inventing no retry budget");
});
