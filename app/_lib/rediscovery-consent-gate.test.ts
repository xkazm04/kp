// Cross-role outreach consent gate (bug-ui-scan #1). Rediscovery "Reach out"
// mints a FRESH pipeline entry under a different role whose consent columns are
// blank; a per-ENTRY consent read then reports that person contactable even when
// their ORIGINAL consent expired or they were anonymized/erased — a GDPR/e-privacy
// re-contact the suppression gate exists to block. These pin that outreach is
// gated at the durable CANDIDATE identity (candidate_id) instead.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the FIRST
// project import — it sets KP_DB_PATH before any db-path consumer evaluates).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  anonymizeEntry,
  createPipelineEntry,
  hasEvent,
  recordEntryConsent,
} from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { dispatchOutreach } from "./comms-dispatch.ts";
import {
  candidateConsentSnapshots,
  candidateOutreachSuppression,
} from "./rediscovery-alert-store.ts";
import { resolveCandidateConsent } from "./rediscovery-relevance.ts";
import { outreachSuppressionReason, type ConsentSnapshot } from "./consent.ts";

after(() => cleanupUnitDb());

const DRAFT = { subject: "A role you'd be great for", body: "We'd love to talk." };

// Rediscover a candidate under a NEW role: mint the fresh per-role entry the
// "Reach out" route would create (blank consent), returning that entry.
function rediscoverInto(candidateId: string, jobId: string) {
  return createPipelineEntry({
    candidateId,
    candidateLabel: `Cand ${candidateId}`,
    jobId,
    jobTitle: `Role ${jobId}`,
    stage: "Screened",
  }).entry;
}

// ---- pure reducer: the most-restrictive candidate consent -------------------

test("resolveCandidateConsent: an EXPIRED grant + a blank fresh entry ⇒ suppressed (the exact rediscovery defect)", () => {
  const now = Date.parse("2026-07-10T00:00:00.000Z");
  const expired: ConsentSnapshot = {
    givenAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:00:00.000Z", // lapsed before `now`
    anonymizedAt: null,
  };
  const blankFreshEntry: ConsentSnapshot = { givenAt: null, expiresAt: null, anonymizedAt: null };

  // Pre-fix behavior: reading ONLY the fresh entry ⇒ "none" ⇒ contactable.
  assert.equal(outreachSuppressionReason(blankFreshEntry, now), null);
  // Fixed behavior: reduced across the candidate's entries ⇒ expired ⇒ suppressed.
  assert.equal(
    outreachSuppressionReason(resolveCandidateConsent([blankFreshEntry, expired]), now),
    "consent_expired"
  );
});

test("resolveCandidateConsent: anonymization on ANY entry is terminal and wins", () => {
  const now = Date.now();
  const anon: ConsentSnapshot = { givenAt: null, expiresAt: null, anonymizedAt: "2026-05-01T00:00:00.000Z" };
  const active: ConsentSnapshot = { givenAt: "2026-06-01T00:00:00.000Z", expiresAt: "2030-01-01T00:00:00.000Z", anonymizedAt: null };
  assert.equal(outreachSuppressionReason(resolveCandidateConsent([active, anon]), now), "anonymized");
});

test("resolveCandidateConsent: a NEWER valid renewal among lapsed grants restores contactability", () => {
  const now = Date.parse("2026-07-10T00:00:00.000Z");
  const lapsed: ConsentSnapshot = { givenAt: "2024-01-01T00:00:00.000Z", expiresAt: "2025-01-01T00:00:00.000Z", anonymizedAt: null };
  const renewed: ConsentSnapshot = { givenAt: "2026-06-01T00:00:00.000Z", expiresAt: "2027-06-01T00:00:00.000Z", anonymizedAt: null };
  assert.equal(outreachSuppressionReason(resolveCandidateConsent([lapsed, renewed]), now), null);
});

test("resolveCandidateConsent: no grants anywhere ⇒ recruiter-sourced ⇒ contactable", () => {
  const blank: ConsentSnapshot = { givenAt: null, expiresAt: null, anonymizedAt: null };
  assert.equal(outreachSuppressionReason(resolveCandidateConsent([blank, blank]), Date.now()), null);
  assert.equal(outreachSuppressionReason(resolveCandidateConsent([]), Date.now()), null);
});

// ---- real DB: the gate resolves against candidate_id across roles -----------

test("EXPIRED-consent candidate is suppressed from a fresh cross-role rediscovery outreach", async () => {
  const cand = "gate-expired";
  const x = createPipelineEntry({ candidateId: cand, candidateLabel: "Expired Person", jobId: "roleX", jobTitle: "Role X" }).entry;
  recordEntryConsent(x.id, "apply", -400); // granted, but already lapsed
  const y = rediscoverInto(cand, "roleY"); // the fresh, blank-consent re-contact entry

  // Non-vacuity: the fresh entry's OWN snapshot (what the pre-fix gate read) is
  // "none" ⇒ contactable — so pre-fix code WOULD send.
  assert.equal(
    outreachSuppressionReason({ givenAt: y.consentGivenAt, expiresAt: y.consentExpiresAt, anonymizedAt: y.anonymizedAt }),
    null,
    "pre-fix per-entry read must be contactable — otherwise the test proves nothing"
  );

  // The candidate-level gate (folding the fresh entry's snapshot in) suppresses.
  assert.equal(candidateOutreachSuppression(cand, { givenAt: y.consentGivenAt, expiresAt: y.consentExpiresAt, anonymizedAt: y.anonymizedAt }), "consent_expired");

  const result = await dispatchOutreach(y, DRAFT);
  assert.deepEqual(result, { sent: false, reason: "consent_expired" });
  assert.equal(listOutboxFiltered({ ref: y.id, kind: "outreach" }).length, 0, "no outreach email may be queued");
  assert.equal(hasEvent(y.id, "outreach_sent"), false, "no outreach_sent marker on a suppressed send");
  assert.equal(hasEvent(y.id, "outreach_suppressed"), true, "the refusal is audited, not silent");
});

test("ANONYMIZED candidate is suppressed from a fresh cross-role rediscovery outreach", async () => {
  const cand = "gate-anon";
  const x = createPipelineEntry({ candidateId: cand, candidateLabel: "Scrubbed Person", jobId: "roleX", jobTitle: "Role X" }).entry;
  anonymizeEntry(x.id, "erasure"); // Art.17 erasure on the original entry
  const y = rediscoverInto(cand, "roleY");

  const result = await dispatchOutreach(y, DRAFT);
  assert.deepEqual(result, { sent: false, reason: "anonymized" });
  assert.equal(listOutboxFiltered({ ref: y.id, kind: "outreach" }).length, 0);
  assert.equal(hasEvent(y.id, "outreach_sent"), false);
});

test("a candidate with VALID consent is still contactable (no over-suppression / no regression)", async () => {
  const cand = "gate-valid";
  const x = createPipelineEntry({ candidateId: cand, candidateLabel: "Valid Person", jobId: "roleX", jobTitle: "Role X" }).entry;
  recordEntryConsent(x.id, "apply", 365); // live consent
  const y = rediscoverInto(cand, "roleY");

  assert.equal(candidateOutreachSuppression(cand, { givenAt: y.consentGivenAt, expiresAt: y.consentExpiresAt, anonymizedAt: y.anonymizedAt }), null);
  const result = await dispatchOutreach(y, DRAFT);
  assert.deepEqual(result, { sent: true });
  assert.equal(listOutboxFiltered({ ref: y.id, kind: "outreach" }).length, 1, "the outreach email is queued");
  assert.equal(hasEvent(y.id, "outreach_sent"), true);
});

test("a purely recruiter-sourced candidate (no consent record anywhere) is contactable", async () => {
  const cand = "gate-sourced";
  const y = rediscoverInto(cand, "roleY");
  assert.deepEqual(candidateConsentSnapshots(cand).length > 0, true, "the entry exists");
  assert.equal(candidateOutreachSuppression(cand, { givenAt: y.consentGivenAt, expiresAt: y.consentExpiresAt, anonymizedAt: y.anonymizedAt }), null);
  const result = await dispatchOutreach(y, DRAFT);
  assert.deepEqual(result, { sent: true });
});
