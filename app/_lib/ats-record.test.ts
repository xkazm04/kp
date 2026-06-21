// P1-5: the normalized ATS candidate-record mapper.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { ATS_SCHEMA_VERSION, buildAtsRecord, type AtsEntryInput } from "./ats-record.ts";

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
