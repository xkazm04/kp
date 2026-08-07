// #4 — lifecycle webhook delivery must be RELIABLE: a non-2xx response, a timeout, or
// a network error is a FAILURE (not "delivered"), and it is persisted to a durable,
// retryable, operator-visible ledger so `candidate.hired` is never silently lost.
//
// Three proofs, each with its non-vacuity:
//   A. deliver() maps a 500 / network error → not-delivered (pre-fix returned
//      {delivered:true, status:500} for ANY response — the status/reason asserts
//      below fail against pre-fix, and can't pass vacuously if the guard blocked fetch).
//   B. the ledger records a failure as retryable, a success clears it, and MAX
//      attempts dead-letters it (pre-fix had NO ledger at all).
//   C. dispatchAtsEvent writes exactly one failed+retryable ledger row on a failed
//      delivery (pre-fix only console.error'd → listAtsDeliveries() would be empty).
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { deliver, dispatchAtsEvent, retryDueAtsDeliveries } from "./ats-egress.ts";
import {
  MAX_ATTEMPTS,
  finalizeAtsDelivery,
  getAtsDelivery,
  listAtsDeliveries,
  listDueAtsDeliveries,
  recordAtsDeliveryStart,
} from "./ats-delivery-store.ts";
import { createPipelineEntry } from "./db.ts";

after(() => cleanupUnitDb());

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

// A — deliver() response mapping. Uses example.com (a stable public resolver anchor)
// so the SSRF guard passes and fetch (mocked) is actually reached. The status/reason
// asserts fail LOUDLY (not vacuously) if DNS ever blocks the fetch.
test("deliver treats a non-2xx receiver response (500) as a FAILURE, carrying the status", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const r = await withFetch(
    (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    () => deliver("ping", { ping: true })
  );
  assert.equal(r.delivered, false);
  if (!r.delivered) assert.equal(r.status, 500, "the receiver's status is captured (proves fetch was reached)");
});

test("deliver treats a network error / timeout as a FAILURE", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const r = await withFetch(
    (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch,
    () => deliver("ping", { ping: true })
  );
  assert.equal(r.delivered, false);
  if (!r.delivered) assert.match(r.reason, /socket hang up/);
});

test("deliver reports delivered only on a 2xx", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const r = await withFetch(
    (async () => ({ ok: true, status: 202 })) as unknown as typeof fetch,
    () => deliver("ping", { ping: true })
  );
  assert.equal(r.delivered, true);
  if (r.delivered) assert.equal(r.status, 202);
});

// B — the durable ledger semantics (fully hermetic; no network).
test("delivery ledger: a failure is recorded as retryable; a success clears it", () => {
  const now = new Date("2026-07-09T00:00:00.000Z");
  const id = recordAtsDeliveryStart("candidate.hired", "pe-led-1");
  assert.equal(getAtsDelivery(id)?.status, "pending");

  finalizeAtsDelivery(id, { delivered: false, status: 500, reason: "webhook endpoint responded 500" }, now);
  let row = getAtsDelivery(id);
  assert.equal(row?.status, "failed", "a 500 is recorded as failed, not delivered");
  assert.equal(row?.attempts, 1);
  assert.equal(row?.lastStatus, 500);
  assert.ok(row?.nextAttemptAt && row.nextAttemptAt > now.toISOString(), "a future retry is scheduled (retryable)");

  const later = new Date(now.getTime() + 3600_000).toISOString();
  assert.ok(listDueAtsDeliveries(later).some((d) => d.id === id), "becomes due once the backoff window elapses");
  assert.equal(listDueAtsDeliveries(now.toISOString()).some((d) => d.id === id), false, "not due before backoff elapses");

  finalizeAtsDelivery(id, { delivered: true, status: 200 }, new Date(now.getTime() + 7200_000));
  row = getAtsDelivery(id);
  assert.equal(row?.status, "delivered");
  assert.equal(row?.nextAttemptAt, null);
  assert.equal(listDueAtsDeliveries(later).some((d) => d.id === id), false, "a delivered row is off the queue");
});

test("delivery ledger: after MAX_ATTEMPTS a failure becomes a terminal dead-letter (no longer due)", () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-led-2");
  const base = new Date("2026-07-09T00:00:00.000Z");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    finalizeAtsDelivery(id, { delivered: false, status: 503, reason: "down" }, new Date(base.getTime() + i * 1000));
  }
  const row = getAtsDelivery(id);
  assert.equal(row?.status, "failed");
  assert.equal(row?.attempts, MAX_ATTEMPTS);
  assert.equal(row?.nextAttemptAt, null, "dead-letter: no more auto-retries");
  const far = new Date(base.getTime() + 10 * 24 * 3600_000).toISOString();
  assert.equal(listDueAtsDeliveries(far).some((d) => d.id === id), false, "a dead-letter is not in the due list");
});

// C — dispatch wiring, hermetic: a `.invalid` host (RFC 6761 — never resolves) makes
// deliver fail at the DNS stage with no network, so we prove dispatch persists the
// failure without a live receiver.
test("dispatchAtsEvent records a failed delivery as a durable retryable ledger row (no silent loss)", async () => {
  setAtsConfig({ webhookUrl: "https://kp-nonexistent-webhook.invalid/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({ candidateId: "c-ats-led", candidateLabel: "ATS Ledger", jobId: "job-led", jobTitle: "Role" });

  const before = listAtsDeliveries().length;
  await dispatchAtsEvent("candidate.hired", entry.id);

  const rows = listAtsDeliveries();
  assert.equal(rows.length, before + 1, "dispatch wrote exactly one ledger row");
  const row = rows.find((r) => r.entryId === entry.id);
  assert.equal(row?.status, "failed", "a failed delivery is recorded as failed, not delivered");
  assert.equal(row?.attempts, 1);
  assert.ok(row?.nextAttemptAt, "it is retryable (a retry is scheduled)");
  assert.ok(
    listDueAtsDeliveries(new Date(Date.now() + 3600_000).toISOString()).some((d) => d.id === row?.id),
    "the failed dispatch is in the retry queue"
  );

  // The retry sweep is a no-op right now (backoff window hasn't elapsed) — proving the
  // schedule is respected — but exists as the replay mechanism.
  const summary = await retryDueAtsDeliveries(new Date());
  assert.equal(summary.due, 0, "not yet due, so the immediate sweep does nothing");
});
