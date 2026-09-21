// Writer coverage for the pre-expiry consent reminder: expiring + unnotified
// notifies once; already-notified is a no-op; expired belongs to the anonymize
// sweep, not this one. unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { anonymizeExpiredConsents, createPipelineEntry, listConsentEvents, recordEntryConsent } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { recordCandidateOptOut } from "./outreach-state-store.ts";
import { notifyExpiringConsents } from "./consent-expiry-reminders.ts";

after(() => cleanupUnitDb());

let seq = 0;
function addEntry() {
  seq += 1;
  const { entry, created } = createPipelineEntry({
    candidateId: `consent-exp-${seq}`,
    candidateLabel: `Expiry Candidate ${seq}`,
    jobId: `consent-exp-job-${seq}`,
    jobTitle: "Expiry Test Role",
    contact: `expiry-${seq}@example.test`,
  });
  assert.equal(created, true);
  return entry;
}

function notifiedKinds(entryId: string): string[] {
  return listConsentEvents(entryId).map((e) => e.kind).filter((k) => k === "expiring_notified");
}

test("notifyExpiringConsents: expiring + unnotified notifies once; already-notified is a no-op", async () => {
  const entry = addEntry();
  recordEntryConsent(entry.id, "apply", 10); // 10 days out → inside the 30-day window

  assert.equal(await notifyExpiringConsents(), 1);
  assert.deepEqual(notifiedKinds(entry.id), ["expiring_notified"]);
  const rows = listOutboxFiltered({ ref: entry.id, kind: "consent_expiry" });
  assert.equal(rows.length, 1, "one candidate letter is enqueued");
  assert.match(rows[0].body ?? "", /Expiry Test Role/);
  assert.match(rows[0].body ?? "", /\/data\//, "letter carries the Art. 17 data door");
  assert.match(rows[0].body ?? "", /\/stop\//, "letter carries the opt-out door");

  assert.equal(await notifyExpiringConsents(), 0, "the claim persists — no duplicate notice");
  assert.equal(notifiedKinds(entry.id).length, 1);
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "consent_expiry" }).length, 1);
});

test("notifyExpiringConsents does not notify an expired consent — that is the anonymize sweep's job", async () => {
  const entry = addEntry();
  recordEntryConsent(entry.id, "apply", 0); // expires immediately

  assert.equal(await notifyExpiringConsents(), 0);
  assert.deepEqual(notifiedKinds(entry.id), []);
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "consent_expiry" }).length, 0);

  assert.equal(anonymizeExpiredConsents(), 1);
});

test("notifyExpiringConsents does not re-arm an opted-out recipient", async () => {
  const entry = addEntry();
  recordEntryConsent(entry.id, "apply", 10);
  recordCandidateOptOut(entry.id);

  assert.equal(await notifyExpiringConsents(), 0);
  assert.deepEqual(notifiedKinds(entry.id), []);
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "consent_expiry" }).length, 0);
});
