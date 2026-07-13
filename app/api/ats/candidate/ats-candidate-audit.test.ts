// bug-ui-scan-2026-07-09 (ats-integration-egress #5): the per-candidate PII export must
// leave an audit trail. This pins the pure audit-descriptor builder the route writes via
// recordEvent — the "ats_export" kind, the entry it is filed against, and a PII-light
// detail that reflects WHAT egressed without copying the PII into the audit row.
//
// NON-VACUITY: pre-fix the route did NO logging and this builder did not exist — the fix
// is the descriptor + the route write. These assertions pin the descriptor CONTRACT (kind,
// entry, detail reflecting decision/offer presence) so a future edit can't hollow it out.
// Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtsExportAudit, ATS_EXPORT_EVENT_KIND } from "./ats-candidate-audit.ts";
import type { AtsCandidateRecord } from "@/app/_lib/ats-record.ts";

function record(over: Partial<AtsCandidateRecord> = {}): AtsCandidateRecord {
  return {
    schemaVersion: "kp.ats.v1",
    exportedAt: "2026-07-09T00:00:00.000Z",
    candidate: { ref: "entry-1", candidateId: "cand-1", displayName: "Ada Byron", contact: "ada@x.io", archetype: "builder" },
    role: { jobId: "job-1", title: "Engineer", company: "Kp", family: "eng" },
    pipeline: { stage: "Offer", status: "active", matchScore: 88, enteredAt: null, stageChangedAt: null },
    decision: null,
    offer: null,
    ...over,
  };
}

test("the audit is filed against the exported entry under the ats_export kind", () => {
  const a = buildAtsExportAudit("entry-1", record());
  assert.equal(a.kind, "ats_export");
  assert.equal(a.kind, ATS_EXPORT_EVENT_KIND);
  assert.equal(a.entryId, "entry-1");
  assert.equal(a.candidateLabel, "Ada Byron", "the candidate label rides on the audit row (as other pipeline events do)");
});

test("the detail reflects the schema version and whether a decision/offer egressed", () => {
  const withBoth = buildAtsExportAudit("entry-1", record({
    decision: {
      kind: "hired", reasonCode: "accept", actor: "human:rec", automated: false,
      sealedRecordHash: "abc", policyVersion: "v1", decidedAt: "2026-07-09T00:00:00.000Z",
    },
    offer: { currency: "USD", amount: 100000, status: "accepted" },
  }));
  assert.match(withBoth.detail, /kp\.ats\.v1/);
  assert.match(withBoth.detail, /(?<!no-)decision/, "a present decision is recorded as 'decision'");
  assert.match(withBoth.detail, /(?<!no-)offer/, "a present offer is recorded as 'offer'");

  const withNeither = buildAtsExportAudit("entry-1", record());
  assert.match(withNeither.detail, /no-decision/);
  assert.match(withNeither.detail, /no-offer/);
});

test("the detail is PII-light — it does not copy the candidate's contact into the audit row", () => {
  const a = buildAtsExportAudit("entry-1", record({ candidate: { ...record().candidate, contact: "secret@pii.io" } }));
  assert.ok(!a.detail.includes("secret@pii.io"), "raw contact PII must not be duplicated into the detail");
});
