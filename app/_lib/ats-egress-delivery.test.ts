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
import {
  SIGNATURE_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
  TIMESTAMP_HEADER,
  verifyWebhookSignature,
} from "./ats-webhook.ts";

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

// A2 — the SSRF boundary vets ONLY the URL we dial. With the default `redirect:
// "follow"` a vetted public host could answer `302 Location: http://169.254.169.254/…`
// (or a 307 to 127.0.0.1, replaying method + the signed PII body) and undici would dial
// that address with no re-vetting. NON-VACUITY: pre-fix `init.redirect` is undefined and
// the reason is "webhook endpoint responded 0" — both asserts below fail.
test("deliver never FOLLOWS a redirect (a vetted host must not become a redirector into the LAN)", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  let init: RequestInit | undefined;
  const r = await withFetch(
    (async (_url: unknown, i: RequestInit) => {
      init = i;
      // What the fetch spec produces for redirect:"manual" — an opaque-redirect
      // response: status 0, ok false, no headers.
      return { ok: false, status: 0, type: "opaqueredirect" };
    }) as unknown as typeof fetch,
    () => deliver("ping", { ping: true })
  );
  assert.equal(init?.redirect, "manual", "the POST must be issued with redirect:'manual' — a followed 3xx bypasses the resolve-and-reject guard entirely");
  assert.equal(r.delivered, false, "a redirect is not an acceptance");
  if (!r.delivered) {
    assert.match(r.reason, /redirect/i, "the operator is told the endpoint redirected, not given a bogus status");
    assert.equal(r.status, undefined, "0 is not an HTTP status — the ledger must not record it as one");
  }
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

// D — MULTI-TENANCY. `ats_config`/`ats_delivery` are deliberately org-level (one
// deployment-wide mirror of every team, tenancy.ts), but the record BUILD is
// workspace-scoped. Pre-fix `getAtsRecord(entryId)` was unscoped → it resolved against
// the DEFAULT workspace, returned null for a team-b entry, and dispatch returned BEFORE
// recordAtsDeliveryStart: `candidate.hired` never fired for any non-default team AND
// left nothing in GET /api/ats/deliveries. Hermetic (a `.invalid` host never resolves).
//
// NON-VACUITY, two independent halves:
//   • the row-count assert fails pre-fix (no ledger row at all);
//   • the `doesNotMatch` assert fails if only the open-and-fail half is applied
//     (the row would exist, but carrying `not found in workspace "workspace"`).
test("dispatchAtsEvent mirrors a NON-DEFAULT team's hire — never a silent, ledger-less no-op", async () => {
  setAtsConfig({ webhookUrl: "https://kp-nonexistent-webhook.invalid/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-ats-team-b",
    candidateLabel: "Team B Hire",
    jobId: "job-team-b",
    jobTitle: "Role",
    workspaceId: "team-b",
  });
  assert.equal(entry.workspaceId, "team-b", "the fixture really is outside the default tenant");

  const before = listAtsDeliveries().length;
  await dispatchAtsEvent("candidate.hired", entry.id);

  const rows = listAtsDeliveries();
  assert.equal(rows.length, before + 1, "a team-b hire opens a ledger row (pre-fix: dispatch returned before the ledger — nothing at all)");
  const row = rows.find((r) => r.entryId === entry.id);
  assert.equal(row?.status, "failed", "the unreachable receiver is recorded as failed");
  assert.ok(row?.nextAttemptAt, "and it is retryable");
  assert.doesNotMatch(
    row?.lastError ?? "",
    /not found in workspace/,
    "the record BUILT for team-b — the failure is the unreachable host, not an unresolvable entry"
  );
});

test("dispatchAtsEvent FAILS a visible ledger row when the entry cannot be resolved (never a silent return)", async () => {
  setAtsConfig({ webhookUrl: "https://kp-nonexistent-webhook.invalid/hook", events: ["candidate.hired"] });
  const before = listAtsDeliveries().length;
  await dispatchAtsEvent("candidate.hired", "pe-does-not-exist");
  const rows = listAtsDeliveries();
  assert.equal(rows.length, before + 1, "an unmirrorable hire is still recorded (pre-fix: `if (!record) return` — invisible)");
  const row = rows.find((r) => r.entryId === "pe-does-not-exist");
  assert.equal(row?.status, "failed");
  assert.match(row?.lastError ?? "", /not found in workspace/, "and it says WHY, instead of a delivery that never happened");
});

// E — the retry sweep had the identical unscoped read, so it would finalize a LIVE
// non-default-team entry with the false terminal reason "pipeline entry no longer
// exists" (and dead-letter it after MAX_ATTEMPTS). `ats_delivery` carries no tenant
// column (org-level by design), so the sweep re-derives it from the entry id.
test("the retry sweep re-resolves a non-default team's entry instead of declaring it gone", async () => {
  setAtsConfig({ webhookUrl: "https://kp-nonexistent-webhook.invalid/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-ats-retry-b",
    candidateLabel: "Retry B",
    jobId: "job-retry-b",
    jobTitle: "Role",
    workspaceId: "team-b",
  });
  const id = recordAtsDeliveryStart("candidate.hired", entry.id);
  // Backdate the failure so its backoff window has already elapsed and it is due now.
  finalizeAtsDelivery(id, { delivered: false, reason: "transient" }, new Date(Date.now() - 3600_000));

  const summary = await retryDueAtsDeliveries(new Date());
  assert.ok(summary.due >= 1, "the backdated row is due");
  const row = getAtsDelivery(id);
  assert.equal(row?.attempts, 2, "the sweep made a second attempt");
  assert.doesNotMatch(
    row?.lastError ?? "",
    /no longer exists/,
    "a LIVE team-b entry must never be finalized with a false terminal reason"
  );
});

// D — the delivery is REPLAY-PROOF. The signature used to cover the body alone, so it
// never expired: a captured delivery could be re-sent verbatim at any later moment and
// still verify. deliver() now stamps one instant into the envelope's `sentAt`, the
// X-Kp-Timestamp header AND the HMAC input, and a receiver checks the stated skew.
//
// NON-VACUITY: pre-change the header did not exist (the first assert fails) and the
// signature was `signWebhookBody(secret, body)` with no timestamp, so verifying under
// the timestamped scheme fails — and the replay assert fails too, because a body-only
// signature verifies forever, which is the defect.
test("deliver stamps one instant into sentAt, the timestamp header and the signature — and a replay of it is refused", async () => {
  // A secret has to be STORED for a signature to be produced at all, and the store
  // refuses to persist one in clear (ats-secret.ts) — so the at-rest key is set here.
  process.env.KP_ATS_SECRET_KEY = "unit-test-ats-key";
  setAtsConfig({ webhookUrl: "https://example.com/hook", webhookSecret: "whsec-unit", events: ["candidate.hired"] });
  let seen: { headers: Record<string, string>; body: string } | null = null;
  const r = await withFetch(
    (async (_url: unknown, init: { headers: Record<string, string>; body: string }) => {
      seen = { headers: init.headers, body: init.body };
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch,
    () => deliver("ping", { ping: true })
  );
  assert.equal(r.delivered, true, "the mocked receiver accepted it (proves fetch was reached)");
  assert.ok(seen, "fetch must have been called");
  const { headers, body } = seen as unknown as { headers: Record<string, string>; body: string };

  // The header rides…
  const stamp = headers[TIMESTAMP_HEADER];
  assert.ok(stamp, `${TIMESTAMP_HEADER} must be sent on every delivery`);
  // …and it is the SAME instant the envelope carries, so a receiver can cross-check the
  // two after parsing.
  assert.equal(JSON.parse(body).sentAt, stamp);

  // The signature verifies under the timestamped scheme at that instant…
  const sig = headers[SIGNATURE_HEADER];
  const now = Date.parse(stamp);
  assert.equal(verifyWebhookSignature("whsec-unit", body, sig, { timestamp: stamp, nowMs: now }), true);
  // …and NOT under the old body-only one, so the sender really did move.
  assert.equal(verifyWebhookSignature("whsec-unit", body, sig), false);

  // THE REPLAY: the identical captured bytes, re-sent past the tolerance window.
  assert.equal(
    verifyWebhookSignature("whsec-unit", body, sig, {
      timestamp: stamp,
      nowMs: now + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000,
    }),
    false,
    "a captured delivery replayed past the window must no longer verify",
  );
});
