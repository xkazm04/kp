// The preparation is the staleness window. The ATS consent gate runs while the
// record is BUILT (getAtsRecordResult → buildAtsRecord), and the record is then
// carried across an AWAITED preparation step — the delivery-time SSRF re-vet
// (dynamic `import("node:dns/promises")` + a real A/AAAA lookup) and the signing
// secret decrypt — before the one irreversible step in this flow: the POST of
// candidate PII to a third-party receiver.
//
// So an erasure that lands after the gate and before the POST is mirrored anyway:
// the gate saw a live candidate, the wire saw their name. The probe makes that
// window deterministic rather than lucky — `dispatchAtsEvent` is synchronous up to
// `await deliver(...)`, whose first suspension is the DNS lookup, so control
// returns to this test with the record already built and the fetch not yet issued.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { dispatchAtsEvent } from "./ats-egress.ts";
import { listAtsDeliveries } from "./ats-delivery-store.ts";
import { createPipelineEntry } from "./db.ts";
import { anonymizeEntry, getPipelineEntry, recordEntryConsent } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

/** Capture every body that reaches the wire, and let the caller act between the
 *  record build and the POST. Returns the bodies seen. */
async function withCapturingFetch(fn: () => Promise<void>): Promise<string[]> {
  const bodies: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ""));
    return { ok: true, status: 200 } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return bodies;
}

// THE FALSIFIER. An erasure committed INSIDE the preparation window must not be
// mirrored. Pre-fix the consent gate's verdict is minutes old by wire time (here:
// one DNS round trip old) and the husk is POSTed.
test("an erasure landing INSIDE the preparation window is not mirrored to the receiver", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-race",
    candidateLabel: "Racing Person",
    jobId: "job-race",
    jobTitle: "Role",
  });

  // POSITIVE CONTROL 1a — the fixture is live when the record is built, so the
  // consent gate really does pass and a record really is produced.
  assert.equal(getPipelineEntry(entry.id)?.anonymizedAt ?? null, null, "mid-state: live at record-build time");

  const bodies = await withCapturingFetch(async () => {
    // Synchronous prefix: ledger row opened, record built (gate passed). The
    // returned promise is parked on the SSRF re-vet's DNS lookup.
    const inFlight = dispatchAtsEvent("candidate.hired", entry.id);
    assert.ok(anonymizeEntry(entry.id, "erasure"), "the erasure commits inside the window");
    // POSITIVE CONTROL 1b — a paired tie cannot mean "the mutation never ran".
    assert.notEqual(
      getPipelineEntry(entry.id)?.anonymizedAt ?? null,
      null,
      "mid-state: anonymized BEFORE the fetch was issued"
    );
    await inFlight;
  });

  assert.ok(
    !bodies.some((b) => b.includes("Racing Person")),
    "the erased candidate's identifying label never left the process"
  );
  assert.equal(bodies.length, 0, "nothing reached the wire after the erasure");
  const row = listAtsDeliveries().find((d) => d.entryId === entry.id);
  assert.equal(row?.status, "failed", "the refusal is still operator-VISIBLE");
  assert.equal(row?.nextAttemptAt, null, "…and terminal: an erasure will not become mirrorable by waiting");
  assert.match(row?.lastError ?? "", /anonymized/, "and it says why");
});

// POSITIVE CONTROL 2 / THE FLOOR — the freshness re-read must not turn the happy
// path into a refusal, and a DNS-blocked fetch must not make "no leak" look like a
// pass. A live entry still reaches the receiver with its record.
test("a live entry still delivers (the re-read is not a new refusal door)", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-live",
    candidateLabel: "Living Person",
    jobId: "job-live",
    jobTitle: "Role",
  });
  const bodies = await withCapturingFetch(async () => {
    await dispatchAtsEvent("candidate.hired", entry.id);
  });
  assert.equal(bodies.length, 1, "the POST happened (non-vacuity: the guard did not block the wire)");
  assert.ok(bodies[0].includes("Living Person"), "and it carried the record");
  const row = listAtsDeliveries().find((d) => d.entryId === entry.id);
  assert.equal(row?.status, "delivered", "the ledger says delivered");
});

// The same window, the other half of the gate: consent EXPIRING mid-preparation. The
// prepared body carries the real name and contact, which the gate would now withhold, so
// the delivery is refused and left RETRYABLE — the retry rebuilds the body masked. The
// re-read never edits the prepared body: those bytes are what the idempotency key promised.
test("consent expiring INSIDE the preparation window refuses the over-disclosing body, retryably", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-expiry",
    candidateLabel: "Expiring Person",
    jobId: "job-expiry",
    jobTitle: "Role",
  });
  assert.equal(getPipelineEntry(entry.id)?.consentExpiresAt ?? null, null, "mid-state: no consent row yet, so PII is releasable");

  const bodies = await withCapturingFetch(async () => {
    const inFlight = dispatchAtsEvent("candidate.hired", entry.id);
    // An expiry that has already passed, committed inside the window.
    assert.ok(recordEntryConsent(entry.id, "probe", -1), "the consent record commits inside the window");
    assert.ok(
      (getPipelineEntry(entry.id)?.consentExpiresAt ?? "") < new Date().toISOString(),
      "mid-state: consent is expired BEFORE the fetch was issued"
    );
    await inFlight;
  });

  assert.ok(!bodies.some((b) => b.includes("Expiring Person")), "the unmasked label never left the process");
  assert.equal(bodies.length, 0, "nothing reached the wire");
  const row = listAtsDeliveries().find((d) => d.entryId === entry.id);
  assert.equal(row?.status, "failed", "operator-visible");
  assert.notEqual(row?.nextAttemptAt, null, "…and RETRYABLE: the next attempt rebuilds the body masked");
  assert.match(row?.lastError ?? "", /over-discloses/, "and it says why");
});
