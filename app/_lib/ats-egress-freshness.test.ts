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
import { dispatchAtsEvent, retryDueAtsDeliveries } from "./ats-egress.ts";
import { listAtsDeliveries } from "./ats-delivery-store.ts";
import {
  actOnPipelineEntry,
  anonymizeEntry,
  createPipelineEntry,
  getPipelineEntry,
  recordEntryConsent,
  reinstatePipelineEntry,
} from "./db/pipeline.ts";

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

// ---------------------------------------------------------------------------------------
// F-3 — THE WINDOW THE FRESHNESS CHECK DID NOT COVER: the TRANSITION, not just consent.
//
// `retryDueAtsDeliveries` rebuilds the record from CURRENT entry state ("a mirror wants the
// latest") and the check gated only consent and existence. So a candidate reinstated
// between attempt 1 and attempt 2 was POSTed again as `candidate.rejected` — under the
// first attempt's Idempotency-Key, with a body saying `pipeline.status: "active"`. A
// receiver that had already rejected them sees the "same" delivery; one that had not is
// told to reject somebody kp has put back in the funnel.
//
// NON-VACUITY for each case is stated inline. Pre-fix: (a) the retry POSTs and the row
// goes on retrying; (b) and (c) are unchanged by the fix and are its floor.
// ---------------------------------------------------------------------------------------

/** Capture bodies AND choose the receiver's answer, so a first attempt can fail and
 *  schedule a retry. */
async function withFetchAnswering(ok: boolean, fn: () => Promise<void>): Promise<string[]> {
  const bodies: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ""));
    return { ok, status: ok ? 200 : 500 } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return bodies;
}

/** A really-rejected entry: the status the `candidate.rejected` event asserts. */
function rejectedEntry(key: string) {
  const { entry } = createPipelineEntry({
    candidateId: `c-${key}`,
    candidateLabel: `Reinstated Person ${key}`,
    jobId: `job-${key}`,
    jobTitle: "Role",
  });
  assert.ok(actOnPipelineEntry(entry.id, "reject", undefined, { actor: "human", actorRef: "human:Unit Recruiter" }));
  assert.equal(getPipelineEntry(entry.id)?.status, "rejected", "fixture: the entry really is rejected");
  return entry;
}

/** Well past the first backoff window, so the sweep picks the row up. */
const laterThanAnyBackoff = () => new Date(Date.now() + 3600_000);

// (a) THE FALSIFIER.
test("a REINSTATED candidate is not re-mirrored as candidate.rejected on the retry — the row dies terminally", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.rejected"] });
  const entry = rejectedEntry("reinstate");

  // Attempt 1: the receiver 500s, so the row is failed-and-RETRYABLE.
  const first = await withFetchAnswering(false, () => dispatchAtsEvent("candidate.rejected", entry.id));
  assert.equal(first.filter((b) => b.includes(entry.id)).length, 1, "attempt 1 reached the wire (otherwise this proves nothing)");
  const opened = listAtsDeliveries(500).find((d) => d.entryId === entry.id);
  assert.equal(opened?.status, "failed", "mid-state: attempt 1 failed");
  assert.notEqual(opened?.nextAttemptAt, null, "mid-state: and is queued for a retry");

  // A recruiter overrules the machine between the two attempts.
  assert.ok(reinstatePipelineEntry(entry.id, undefined, "human:Unit Recruiter"), "the reinstatement commits between attempts");
  assert.equal(getPipelineEntry(entry.id)?.status, "active", "mid-state: the candidate is back in the funnel");

  const second = await withFetchAnswering(true, async () => {
    await retryDueAtsDeliveries(laterThanAnyBackoff());
  });
  assert.equal(
    second.filter((b) => b.includes(entry.id)).length,
    0,
    "the retry sent NOTHING: a reject kp has withdrawn is not restated to the receiver"
  );
  const row = listAtsDeliveries(500).find((d) => d.entryId === entry.id);
  assert.equal(row?.status, "failed", "the drop is still operator-VISIBLE");
  assert.equal(row?.nextAttemptAt, null, "…and TERMINAL: a reinstatement will not become mirrorable by waiting");
  assert.match(row?.lastError ?? "", /no longer "rejected"/, "and the reason names the status that no longer holds");
  assert.match(row?.lastError ?? "", /reinstated or reopened/, "…and says the transition was reversed");
  assert.ok(
    !(row?.lastError ?? "").includes("Reinstated Person"),
    "the ledger reason carries NO candidate PII — entry id and the closed status vocabulary only"
  );
});

// (b) THE FLOOR. An entry whose rejection still stands retries exactly as before, and the
// redelivery is byte-identical — the transition re-assert must not become a new door that
// swallows legitimate retries (the companion of ats-egress-delivery.test.ts's idempotency
// case, which pins the same promise for `candidate.hired`).
test("an UNCHANGED rejected entry still retries, byte-identically", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.rejected"] });
  const entry = rejectedEntry("unchanged");

  const first = await withFetchAnswering(false, () => dispatchAtsEvent("candidate.rejected", entry.id));
  const mineFirst = first.filter((b) => b.includes(entry.id));
  assert.equal(mineFirst.length, 1, "attempt 1 reached the wire");
  assert.equal(getPipelineEntry(entry.id)?.status, "rejected", "mid-state: nothing reversed the rejection");

  const second = await withFetchAnswering(true, async () => {
    await retryDueAtsDeliveries(laterThanAnyBackoff());
  });
  const mineSecond = second.filter((b) => b.includes(entry.id));
  assert.equal(mineSecond.length, 1, "the retry still happened");
  assert.equal(mineSecond[0], mineFirst[0], "and is byte-identical — a receiver can still dedupe on the body alone");
  const row = listAtsDeliveries(500).find((d) => d.entryId === entry.id);
  assert.equal(row?.status, "delivered", "the ledger says delivered");
});

// (c) THE ORDER. An erasure landing between the attempts must keep the outcome it had
// before this fix existed: terminal, with the ANONYMIZED reason — not the transition one.
// (An anonymized entry's status is untouched by the scrub, so both doors are open at once
// and only the order of the checks decides which answer the operator reads.)
test("an ERASED entry still dead-letters with the anonymized reason, not the transition one", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.rejected"] });
  const entry = rejectedEntry("erased");

  const first = await withFetchAnswering(false, () => dispatchAtsEvent("candidate.rejected", entry.id));
  assert.equal(first.filter((b) => b.includes(entry.id)).length, 1, "attempt 1 reached the wire");
  assert.ok(anonymizeEntry(entry.id, "erasure"), "the erasure commits between the attempts");

  const second = await withFetchAnswering(true, async () => {
    await retryDueAtsDeliveries(laterThanAnyBackoff());
  });
  assert.equal(second.filter((b) => b.includes(entry.id)).length, 0, "nothing was sent");
  const row = listAtsDeliveries(500).find((d) => d.entryId === entry.id);
  assert.equal(row?.status, "failed", "operator-visible");
  assert.equal(row?.nextAttemptAt, null, "…and terminal, exactly as before this fix");
  assert.match(row?.lastError ?? "", /anonymized/, "the ERASURE is the reason the operator reads");
});

// The table itself: the rule is keyed by event, and `offer.declined` — the other merit
// terminal a re-add can reopen (db/pipeline.ts: "only rejected, declined is reopenable") —
// is covered by the same door. `candidate.hired` and `offer.accepted` deliberately are
// NOT; see EVENT_REQUIRES_STATUS in ats-egress.ts and ADR 0013 for why each is left.
test("offer.declined is held to its own status too", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["offer.declined"] });
  const { entry } = createPipelineEntry({
    candidateId: "c-declined",
    candidateLabel: "Declining Person",
    jobId: "job-declined",
    jobTitle: "Role",
  });
  // A `declined` entry whose status is then NOT declined is the only state this asserts;
  // the entry is left `active`, which is exactly what a reopened decline looks like.
  assert.equal(getPipelineEntry(entry.id)?.status, "active", "fixture: not declined");

  const bodies = await withFetchAnswering(true, () => dispatchAtsEvent("offer.declined", entry.id));
  assert.equal(bodies.filter((b) => b.includes(entry.id)).length, 0, "an entry that is not declined mirrors no decline");
  const row = listAtsDeliveries(500).find((d) => d.entryId === entry.id);
  assert.equal(row?.nextAttemptAt, null, "terminal");
  assert.match(row?.lastError ?? "", /no longer "declined"/, "and it says which status it wanted");
});
