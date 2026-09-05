// P1-5: the normalized ATS candidate-record mapper.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { ATS_SCHEMA_VERSION, AtsRecordRefusedError, buildAtsRecord, type AtsEntryInput } from "./ats-record.ts";

function entry(over: Partial<AtsEntryInput> = {}): AtsEntryInput {
  return {
    id: "e1",
    candidateId: "c1",
    candidateLabel: "Ada Lovelace",
    jobId: "j1",
    jobTitle: "Staff Engineer",
    stage: "Hired",
    status: "hired",
    matchScore: 88,
    roleFamily: "software_engineering",
    archetype: "ic_senior",
    contact: "ada@example.com",
    createdAt: "2026-06-01T00:00:00.000Z",
    stageChangedAt: "2026-06-10T00:00:00.000Z",
    ...over,
  };
}

test("maps the core fields + carries the schema version and export stamp", () => {
  const r = buildAtsRecord({ entry: entry(), exportedAt: "2026-06-20T12:00:00.000Z" });
  assert.equal(r.schemaVersion, ATS_SCHEMA_VERSION);
  assert.equal(r.exportedAt, "2026-06-20T12:00:00.000Z");
  assert.equal(r.candidate.ref, "e1");
  assert.equal(r.candidate.displayName, "Ada Lovelace");
  assert.equal(r.role.title, "Staff Engineer");
  assert.equal(r.pipeline.stage, "Hired");
  assert.equal(r.pipeline.matchScore, 88);
  assert.equal(r.decision, null);
  assert.equal(r.offer, null);
});

test("job record overrides the denormalized title and supplies company", () => {
  const r = buildAtsRecord({
    entry: entry({ jobTitle: "stale title" }),
    job: { id: "j1", title: "Staff Software Engineer", company: "Acme Corp" },
  });
  assert.equal(r.role.title, "Staff Software Engineer");
  assert.equal(r.role.company, "Acme Corp");
});

test("a human decision is not flagged automated; the sealed hash is the audit ref", () => {
  const r = buildAtsRecord({
    entry: entry(),
    decision: {
      kind: "hired",
      actor: "human:recruiter",
      reasonCode: "advance",
      contentHash: "abc123",
      policyVersion: "offer/v1",
      createdAt: "2026-06-10T09:00:00.000Z",
    },
  });
  assert.ok(r.decision);
  assert.equal(r.decision.automated, false);
  assert.equal(r.decision.sealedRecordHash, "abc123");
});

test("an auto: / system actor is flagged automated", () => {
  const auto = buildAtsRecord({
    entry: entry(),
    decision: { kind: "auto_rejected", actor: "auto:screen-wave", reasonCode: "reject", contentHash: "h", policyVersion: "p", createdAt: "t" },
  });
  assert.equal(auto.decision?.automated, true);
  const system = buildAtsRecord({
    entry: entry(),
    decision: { kind: "x", actor: "system", reasonCode: "r", contentHash: "h", policyVersion: "p", createdAt: "t" },
  });
  assert.equal(system.decision?.automated, true);
});

test("offer comp is carried through as currency + amount + status", () => {
  const r = buildAtsRecord({ entry: entry(), offer: { currency: "USD", salary: 180000, status: "accepted" } });
  assert.deepEqual(r.offer, { currency: "USD", amount: 180000, status: "accepted" });
});

test("nulls degrade safely (label-only stub, no job/decision/offer)", () => {
  const r = buildAtsRecord({
    entry: entry({ jobId: null, jobTitle: null, candidateId: null, matchScore: null, contact: null, roleFamily: null }),
  });
  assert.equal(r.role.title, null);
  assert.equal(r.role.company, null);
  assert.equal(r.pipeline.matchScore, null);
  assert.equal(r.candidate.candidateId, null);
  assert.equal(r.exportedAt, null);
});

// THE CONSENT GATE. Before this, nothing on the egress path consulted consent at all:
// the record carried displayName, contact and matchScore to a third-party endpoint on the
// strength of the row having been scrubbed by the periodic anonymize sweep. That is
// safety incidental to another feature's timing. The gate lives in the mapper — the one
// function every egress path funnels through — and reads the SHARED predicates
// (consent.ts), so it cannot drift from the /api/analyses, timeline and outreach gates.
//
// NON-VACUITY: pre-change the mapper had no consent input at all, so every assertion
// below reads back the raw label/contact (and the anonymized case builds a full record
// of a person kp has erased).
const NOW = Date.parse("2026-06-20T12:00:00.000Z");

test("an ANONYMIZED entry is REFUSED — an erased candidate is never mirrored to an ATS", () => {
  assert.throws(
    () => buildAtsRecord({ entry: entry({ anonymizedAt: "2026-06-19T00:00:00.000Z" }), nowMs: NOW }),
    (e: unknown) => e instanceof AtsRecordRefusedError && e.reason === "anonymized",
    "the refusal is a typed decision the caller can dead-letter, not a generic throw"
  );
});

test("an EXPIRED consent masks the name, drops the contact, and SAYS it withheld them", () => {
  const r = buildAtsRecord({
    entry: entry({ consentGivenAt: "2025-01-01T00:00:00.000Z", consentExpiresAt: "2026-01-01T00:00:00.000Z" }),
    nowMs: NOW,
  });
  assert.equal(r.candidate.displayName, "Ada L.", "masked exactly as the anonymize sweep would have masked it");
  assert.equal(r.candidate.contact, null, "an expired lawful basis must never export a deliverable address");
  assert.equal(r.candidate.piiWithheld, true, "a receiver can tell a redacted record from a sparse one");
  assert.equal(r.pipeline.matchScore, 88, "the retained, non-identifying recruitment record still egresses");
});

test("a LIVE consent exports the full record — the gate must not over-scrub", () => {
  const r = buildAtsRecord({
    entry: entry({ consentGivenAt: "2026-01-01T00:00:00.000Z", consentExpiresAt: "2099-01-01T00:00:00.000Z" }),
    nowMs: NOW,
  });
  assert.equal(r.candidate.displayName, "Ada Lovelace");
  assert.equal(r.candidate.contact, "ada@example.com");
  assert.equal(r.candidate.piiWithheld, false);
});

test("an entry with NO consent columns is not treated as withheld (pre-consent rows still mirror)", () => {
  const r = buildAtsRecord({ entry: entry(), nowMs: NOW });
  assert.equal(r.candidate.contact, "ada@example.com");
  assert.equal(r.candidate.piiWithheld, false);
});
