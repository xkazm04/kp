// Council-lite r1 (value, goal 4): what the ATS receives about a decision used to be a
// code and a hash. The sealed rationale now rides in decision.rationale — additive, so
// kp.ats.v1 stands — for the reason codes whose prose is server-built from the candidate's
// own facts; everything else, and any consent-withheld record, carries rationale null plus
// rationaleWithheld true.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtsRecord, ATS_SCHEMA_VERSION, type AtsEntryInput } from "./ats-record.ts";

function entry(over: Partial<AtsEntryInput> = {}): AtsEntryInput {
  return {
    id: "e1",
    candidateId: "c1",
    candidateLabel: "Ada Lovelace",
    jobId: "j1",
    jobTitle: "Engineer",
    stage: "Screening",
    status: "rejected",
    matchScore: 31,
    roleFamily: null,
    archetype: null,
    contact: "ada@example.com",
    createdAt: "2026-06-01T00:00:00.000Z",
    stageChangedAt: null,
    ...over,
  };
}

const decision = (reasonCode: string, rationale: string | undefined, kind = "k") => ({
  kind,
  actor: "auto:screen-wave",
  reasonCode,
  rationale,
  contentHash: "h",
  policyVersion: "p",
  createdAt: "t",
});

test("a screening rejection leaves with its reason, with the schema version unchanged", () => {
  const why = "Auto-rejected · bottom 20% of 40 → 8 (rank 40) and match 31 < 50 threshold. · approved by Petra";
  const r = buildAtsRecord({ entry: entry(), decision: decision("reject", why, "auto_rejected") });
  assert.equal(r.decision?.rationale, why);
  assert.equal(r.decision?.rationaleWithheld, false);
  assert.equal(r.schemaVersion, "kp.ats.v1");
  assert.equal(ATS_SCHEMA_VERSION, "kp.ats.v1");
});

test("a scored (match verdict) decision leaves with its reason", () => {
  const why = "match_fit tier=strong best=a:90 worst=b:40 skills=5/1/2 score=82 scorer=v3";
  const r = buildAtsRecord({ entry: entry(), decision: decision("match_fit", why) });
  assert.equal(r.decision?.rationale, why);
});

test("a decision with no sealed rationale is null and NOT flagged withheld", () => {
  const r = buildAtsRecord({ entry: entry(), decision: decision("reject", undefined) });
  assert.equal(r.decision?.rationale, null);
  assert.equal(r.decision?.rationaleWithheld, false);
});

test("group-eval prose (names the runner-up) and free-text accept detail are withheld", () => {
  const lead = decision("lead", "3 candidate(s) for Engineer. Recommended lead: Ada (fit 90). Grace Hopper is within the band.");
  const r = buildAtsRecord({ entry: entry(), decision: lead });
  assert.equal(r.decision?.rationale, null);
  assert.equal(r.decision?.rationaleWithheld, true);
  assert.ok(!JSON.stringify(r).includes("Grace"));
  const accept = buildAtsRecord({ entry: entry(), decision: decision("accept", "Call Bob on 555-0100") });
  assert.equal(accept.decision?.rationale, null);
  assert.equal(accept.decision?.rationaleWithheld, true);
});

test("a piiWithheld record carries no name or contact through the rationale", () => {
  const why = "Offer extended: 90000 EUR for Engineer. Ada Lovelace ada@example.com";
  const r = buildAtsRecord({
    entry: entry({ consentGivenAt: "2024-01-01T00:00:00.000Z", consentExpiresAt: "2024-06-01T00:00:00.000Z" }),
    decision: decision("offer", why),
    nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(r.candidate.piiWithheld, true, "NON-VACUITY: the record really is consent-withheld");
  assert.equal(r.decision?.rationale, null);
  assert.equal(r.decision?.rationaleWithheld, true);
  const wire = JSON.stringify(r);
  assert.ok(!wire.includes("Ada Lovelace") && !wire.includes("ada@example.com"));
});
