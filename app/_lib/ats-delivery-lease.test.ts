// Leased ATS delivery claims — a crash mid-POST must not strand a hire in `pending`.
//
// Every attempt of an `ats_delivery` row passes through `pending`, and before the lease
// every exit from `pending` was a call from the SAME process that entered it. A deploy,
// OOM or crash during the awaited deliver() left the row pending forever: never due,
// never dead, never pruned, refused by the operator's Replay door, and invisible to GET.
//
// The claim is now a LEASE: a random token + a deadline written atomically with the
// status flip. The retry sweep reclaims expired leases first (one conditional UPDATE per
// row, `changes === 0` = someone else got there), a reclaimed row re-sends under the SAME
// Idempotency-Key (the row id) so the receiving ATS dedupes, and only the lease holder
// may finalize — a zombie finalizer that outlived its lease loses politely.
//
// NON-VACUITY: pre-change there is no ATS_DELIVERY_LEASE_MS, no reclaimExpiredAtsLeases,
// no openAtsDelivery / leaseAtsDelivery, finalize takes no token, and GET has no
// `stranded` — every case below fails on import or on its first assert.
//
// ORDER MATTERS: the reclaim sweep reaps every expired row in this file's throwaway DB,
// so the "nothing to reap" case runs first, on the earliest clock.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { dispatchAtsEvent, retryDueAtsDeliveries } from "./ats-egress.ts";
import {
  ATS_DELIVERY_LEASE_MS,
  MAX_ATTEMPTS,
  countDeadAtsDeliveries,
  countStrandedAtsDeliveries,
  finalizeAtsDelivery,
  getAtsDelivery,
  leaseAtsDelivery,
  listAtsDeliveries,
  listDueAtsDeliveries,
  openAtsDelivery,
  pruneAtsDeliveries,
  reclaimExpiredAtsLeases,
  recordAtsDeliveryStart,
  requeueAtsDelivery,
} from "./ats-delivery-store.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { IDEMPOTENCY_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./ats-webhook.ts";
import { GET } from "../api/ats/deliveries/route.ts";

after(() => cleanupUnitDb());

const at = (iso: string, plusMs = 0) => new Date(Date.parse(iso) + plusMs);

test("case 2 — a live attempt inside its lease is never reaped", () => {
  const T = "2026-01-01T00:00:00.000Z";
  const id = recordAtsDeliveryStart("candidate.hired", "pe-lease-live", at(T));
  const before = getAtsDelivery(id);
  assert.equal(reclaimExpiredAtsLeases(at(T, ATS_DELIVERY_LEASE_MS - 1)), 0, "nothing has expired yet");
  const row = getAtsDelivery(id);
  assert.equal(row?.status, "pending");
  assert.deepEqual(row, before, "the live row is untouched");
  // Clean up so this row does not leak into later cases' counts.
  assert.equal(reclaimExpiredAtsLeases(at(T, ATS_DELIVERY_LEASE_MS + 1)), 1);
});

test("case 1 — a row opened and never finalized is reclaimed as a failed, due attempt", () => {
  const T = "2026-02-01T00:00:00.000Z";
  const id = recordAtsDeliveryStart("candidate.hired", "pe-lease-crash", at(T));
  const now = at(T, ATS_DELIVERY_LEASE_MS + 1);
  assert.equal(listDueAtsDeliveries(now.toISOString()).some((d) => d.id === id), false, "stranded: not due before the reclaim");
  assert.ok(reclaimExpiredAtsLeases(now) >= 1);
  const row = getAtsDelivery(id);
  assert.equal(row?.status, "failed");
  assert.equal(row?.attempts, 1, "the lost attempt is counted — it may have landed");
  assert.equal(row?.nextAttemptAt, now.toISOString(), "due immediately");
  assert.match(row?.lastError ?? "", /abandoned/i, "last_error names an abandoned attempt");
  assert.ok(listDueAtsDeliveries(now.toISOString()).some((d) => d.id === id), "and it is on the due list");
});

test("case 3 — a zombie finalizer holding an expired token cannot overwrite the new holder", () => {
  const T = "2026-03-01T00:00:00.000Z";
  const opened = openAtsDelivery("candidate.hired", "pe-lease-zombie", at(T));
  const tokenA = opened.token;
  assert.equal(typeof tokenA, "string");
  const t1 = at(T, ATS_DELIVERY_LEASE_MS + 1);
  assert.ok(reclaimExpiredAtsLeases(t1) >= 1);
  const tokenB = leaseAtsDelivery(opened.id, 1, t1);
  assert.ok(tokenB, "the sweep re-claims the reclaimed row");
  assert.notEqual(tokenB, tokenA);
  const held = getAtsDelivery(opened.id);

  assert.equal(finalizeAtsDelivery(opened.id, { delivered: true, status: 200 }, tokenA, t1), false, "token A lost its lease");
  assert.deepEqual(getAtsDelivery(opened.id), held, "the row keeps B's state");

  assert.equal(finalizeAtsDelivery(opened.id, { delivered: true, status: 200 }, tokenB!, t1), true, "the holder finishes it");
  assert.equal(getAtsDelivery(opened.id)?.status, "delivered");
  assert.equal(
    finalizeAtsDelivery(opened.id, { delivered: false, reason: "late" }, tokenB!, t1),
    false,
    "a finished lease cannot be finalized twice"
  );
});

test("case 4 — a reclaim that exhausts the ladder dead-letters, and Replay can revive it", () => {
  const T = "2026-04-01T00:00:00.000Z";
  const id = recordAtsDeliveryStart("candidate.hired", "pe-lease-dead", at(T));
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    finalizeAtsDelivery(id, { delivered: false, reason: "down" }, at(T, i));
  }
  assert.ok(leaseAtsDelivery(id, MAX_ATTEMPTS - 1, at(T, 10)), "the last attempt is claimed");
  const deadBefore = countDeadAtsDeliveries();
  const now = at(T, 10 + ATS_DELIVERY_LEASE_MS + 1);
  assert.ok(reclaimExpiredAtsLeases(now) >= 1);
  const row = getAtsDelivery(id);
  assert.equal(row?.status, "failed");
  assert.equal(row?.attempts, MAX_ATTEMPTS);
  assert.equal(row?.nextAttemptAt, null, "dead-letter");
  assert.equal(countDeadAtsDeliveries(), deadBefore + 1, "the dead-letter count sees it");
  assert.equal(requeueAtsDelivery(id, now), "ok", "the existing Replay door revives it");
  assert.equal(getAtsDelivery(id)?.nextAttemptAt, now.toISOString());
});

test("case 4b — Replay on a STRANDED pending row answers ok; on a LIVE lease it is refused", () => {
  const T = "2026-04-15T00:00:00.000Z";
  const stranded = recordAtsDeliveryStart("candidate.hired", "pe-lease-replay-stranded", at(T));
  const live = recordAtsDeliveryStart("candidate.hired", "pe-lease-replay-live", at(T, ATS_DELIVERY_LEASE_MS));
  const now = at(T, ATS_DELIVERY_LEASE_MS + 1);
  assert.equal(requeueAtsDelivery(stranded, now), "ok", "pre-change: not-replayable, forever");
  assert.ok(listDueAtsDeliveries(now.toISOString()).some((d) => d.id === stranded), "and it is due");
  assert.equal(requeueAtsDelivery(live, now), "not-replayable", "a live attempt is never hijacked");
  assert.equal(getAtsDelivery(live)?.status, "pending");
  reclaimExpiredAtsLeases(at(T, 3 * ATS_DELIVERY_LEASE_MS));
});

test("case 6 — two reclaims racing on one expired row: exactly one wins, attempts moves once", () => {
  const T = "2026-05-01T00:00:00.000Z";
  const id = recordAtsDeliveryStart("candidate.hired", "pe-lease-race", at(T));
  const now = at(T, ATS_DELIVERY_LEASE_MS + 1);
  const first = reclaimExpiredAtsLeases(now);
  const second = reclaimExpiredAtsLeases(now);
  assert.equal(first, 1, "one reclaim owns the row");
  assert.equal(second, 0, "the other finds it already moved (changes === 0)");
  assert.equal(getAtsDelivery(id)?.attempts, 1, "incremented once, not twice");
});

test("case 7 — prune never deletes a pending row; GET reports `stranded` beside due and dead", async () => {
  const T = "2026-06-01T00:00:00.000Z";
  const pending = recordAtsDeliveryStart("candidate.hired", "pe-lease-prune", at(T));
  pruneAtsDeliveries(at(T, 400 * 86_400_000));
  assert.equal(getAtsDelivery(pending)?.status, "pending", "an in-flight row is never swept");

  assert.ok(countStrandedAtsDeliveries(new Date()) >= 1, "a pending row past its lease is stranded");
  assert.equal(countStrandedAtsDeliveries(at(T, 1)), 0, "inside its lease it is not");

  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { due: number; dead: number; stranded: number; deliveries: Record<string, unknown>[] };
  assert.equal(typeof body.due, "number");
  assert.equal(typeof body.dead, "number");
  assert.ok(body.stranded >= 1, "GET counts the stranded row");
  for (const d of body.deliveries) {
    assert.equal("leaseToken" in d || "lease_token" in d, false, "the lease token never leaves the store");
  }
  reclaimExpiredAtsLeases(new Date());
});

// Case 5 + the wire pin. A dispatch whose POST never returns IS a crash mid-POST from the
// ledger's point of view: the row is pending and nobody will finish it. The next sweep
// past the lease reclaims it and redelivers in the SAME sweep — and the redelivery is the
// same request: same Idempotency-Key, byte-identical body, same header set. Then the
// zombie's POST finally returns, and its finalize must lose.
test("case 5 — a stranded dispatch is reclaimed and redelivered in one sweep, byte-identical, same key", async () => {
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  setAtsConfig({ webhookUrl: "https://example.com/hook", webhookSecret: "whsec-lease", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({ candidateId: "c-lease", candidateLabel: "Lease Hire", jobId: "job-lease", jobTitle: "Role" });

  type Seen = { headers: Record<string, string>; body: string };
  const seen: Seen[] = [];
  let releaseZombie: (v: { ok: boolean; status: number }) => void = () => {};
  let reachedWire: () => void = () => {};
  const onWire = new Promise<void>((r) => (reachedWire = r));

  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init: Seen) => {
    seen.push({ headers: init.headers, body: init.body });
    reachedWire();
    return new Promise((resolve) => (releaseZombie = resolve));
  }) as unknown as typeof fetch;
  const zombie = dispatchAtsEvent("candidate.hired", entry.id);
  try {
    await onWire;
  } finally {
    globalThis.fetch = real;
  }
  const row = listAtsDeliveries().find((d) => d.entryId === entry.id);
  assert.ok(row, "the dispatch opened a ledger row");
  assert.equal(row.status, "pending", "and the process 'died' holding it");
  assert.equal(listDueAtsDeliveries(new Date(Date.now() + ATS_DELIVERY_LEASE_MS * 2).toISOString()).some((d) => d.id === row.id), false);

  globalThis.fetch = (async (_u: unknown, init: Seen) => {
    seen.push({ headers: init.headers, body: init.body });
    return { ok: true, status: 200 };
  }) as unknown as typeof fetch;
  try {
    await retryDueAtsDeliveries(new Date(Date.now() + ATS_DELIVERY_LEASE_MS + 1000));
  } finally {
    globalThis.fetch = real;
  }
  const mine = seen.filter((s) => s.body.includes(entry.id));
  assert.equal(mine.length, 2, "the lost attempt and the redelivery both reached the wire");
  const [lost, again] = mine;
  assert.equal(again.headers[IDEMPOTENCY_HEADER], String(row.id), "Idempotency-Key = the row id");
  assert.equal(again.headers[IDEMPOTENCY_HEADER], lost.headers[IDEMPOTENCY_HEADER], "the SAME key as the lost attempt");
  assert.equal(again.body, lost.body, "byte-identical body — the receiver dedupes");
  assert.equal(JSON.parse(again.body).idempotencyKey, String(row.id));
  assert.deepEqual(Object.keys(again.headers).sort(), Object.keys(lost.headers).sort(), "the same header set");
  for (const k of Object.keys(lost.headers)) {
    if (k === TIMESTAMP_HEADER || k === SIGNATURE_HEADER) continue; // per-attempt by design
    assert.equal(again.headers[k], lost.headers[k], `header ${k} unchanged`);
  }
  const delivered = getAtsDelivery(row.id);
  assert.equal(delivered?.status, "delivered");
  assert.equal(delivered?.attempts, 2, "the abandoned attempt + the redelivery");

  // The zombie's POST returns at last. Its finalize holds an expired token and must lose.
  releaseZombie({ ok: false, status: 500 });
  await zombie;
  assert.deepEqual(getAtsDelivery(row.id), delivered, "the zombie did not overwrite the redelivery");
});
