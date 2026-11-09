// The human scorecard door answers a coded 503 when its decision record cannot be
// sealed — never a 200 with only a server log behind it (council robustness-1). The seal
// failure is the REAL one decision-not-sealed.test.ts uses: the default chain is keyed,
// then the key is unset, so every seal throws. Restoring the key makes the retry land,
// and the retry re-files under the same (author, stage) key: one record, one artifact.
//
// Its own file (own process, own throwaway DB): it breaks the default chain.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { saveInterviewPrep, getInterviewPrep } = await import("../../../_lib/interview-prep.ts");
const { readHumanScorecards } = await import("../../../_lib/human-scorecard-set.ts");
const { createPipelineEntry, getPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { listDecisionRecords, sealDecisionRecord } = await import("../../../_lib/decision-record-store.ts");
const { POST } = await import("./route.ts");

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

function prepped(label: string): string {
  const { entry } = createPipelineEntry({
    candidateId: `sc-seal-${label}`,
    candidateLabel: `Scorecard Seal ${label}`,
    jobId: `sc-seal-job-${label}`,
    jobTitle: "Scorecard Seal Test",
    stage: "Interview",
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, { scenario: "seal" });
  return entry.id;
}

async function post(entryId: string): Promise<Response> {
  const url = new URL(`http://localhost/api/interview-prep/scorecard?entry=${encodeURIComponent(entryId)}`);
  const body = JSON.stringify({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" });
  return (await POST(Object.assign(new Request(url, { method: "POST", body }), { nextUrl: url }) as never)) as unknown as Response;
}

process.env[KEY_ENV] = "scorecard-seal-test-key";
const keying = prepped("keying");
sealDecisionRecord({
  kind: "advanced",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: keying,
  rationale: "keys the chain for this test",
  reasonCode: "accept",
  inputs: {},
});

test("a failed seal answers the coded 503 and opens no gate; the retry files one scorecard and seals once", async () => {
  const id = prepped("main");
  delete process.env[KEY_ENV];

  const refused = await post(id);
  assert.equal(refused.status, 503, "a verdict with no record is not a 200");
  assert.equal(((await refused.json()) as { code?: string }).code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal(getPipelineEntry(id)!.approvalKind, null, "the Decisions gate did not open");
  assert.equal(listDecisionRecords({ candidateRef: id }).length, 0);

  process.env[KEY_ENV] = "scorecard-seal-test-key";
  const retried = await post(id);
  assert.equal(retried.status, 200);
  assert.equal(((await retried.json()) as { gated: boolean }).gated, true);
  assert.equal(listDecisionRecords({ candidateRef: id }).filter((r) => r.kind === "human_scorecard").length, 1, "exactly one sealed record");
  assert.equal(readHumanScorecards(getInterviewPrep(id)!.payload).length, 1, "exactly one filed scorecard, no duplicate");
});
