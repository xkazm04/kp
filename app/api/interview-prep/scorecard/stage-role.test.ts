// The human scorecard POST opens the Interview→Offer gate by ROLE, not by the
// column name "Interview". A workspace that renamed or split that column used
// to save the verdict and return `gated: false` forever, so a human-led round
// never reached Decisions. `stage-ai-actions.ts` already resolved this class of
// bug for the candidate-modal actions; this file drives the real POST the same
// way interview-prep-tenancy.test.ts does, against a custom axis.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any
// store resolves db-path.ts).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { saveInterviewPrep } = await import("../../../_lib/interview-prep.ts");
const { createPipelineEntry, getPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { setDecisionConfig } = await import("../../../_lib/decision-config-store.ts");
const { PIPELINE_STAGES_DEFAULT } = await import("../../../_lib/decision-config-schema.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

let seq = 0;

function preppedAt(stage: string): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `scorecard-role-c${seq}`,
    candidateLabel: `Scorecard Role ${seq}`,
    jobId: `scorecard-role-job-${seq}`,
    jobTitle: "Scorecard Role Test",
    stage,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, { scenario: "role-gate" });
  return entry.id;
}

function withAxis(axis: { stages: { id: string; label: string; role: string }[] }, fn: () => Promise<void>): Promise<void> {
  setDecisionConfig("pipelineStages", axis, undefined, "team");
  return fn().finally(() => {
    setDecisionConfig("pipelineStages", PIPELINE_STAGES_DEFAULT as unknown as Record<string, unknown>, undefined, "team");
  });
}

async function postRecommendation(entryId: string): Promise<Response> {
  const url = new URL(`http://localhost/api/interview-prep/scorecard?entry=${encodeURIComponent(entryId)}`);
  return (await POST({
    nextUrl: url,
    headers: new Headers(),
    json: async () => ({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" }),
  } as never)) as unknown as Response;
}

test("an active entry on a renamed interview-role column gates into scorecard_review", async () => {
  await withAxis(
    {
      stages: [
        { id: "Accepted", label: "Accepted", role: "entry" },
        { id: "Screened", label: "Screened", role: "screening" },
        { id: "Loop", label: "Loop", role: "interview" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Hired", label: "Hired", role: "terminal" },
      ],
    },
    async () => {
      const id = preppedAt("Loop");
      const res = await postRecommendation(id);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; gated: boolean };
      assert.equal(body.ok, true);
      assert.equal(body.gated, true, "a role=interview column whose id is not Interview still opens the gate");
      const row = getPipelineEntry(id);
      assert.ok(row);
      assert.equal(row.approvalKind, "scorecard_review");
    },
  );
});

test("an active entry on a column still named Interview with role custom does not gate", async () => {
  await withAxis(
    {
      stages: [
        { id: "Accepted", label: "Accepted", role: "entry" },
        { id: "Screened", label: "Screened", role: "screening" },
        { id: "Interview", label: "Interview", role: "custom" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Hired", label: "Hired", role: "terminal" },
      ],
    },
    async () => {
      const id = preppedAt("Interview");
      const res = await postRecommendation(id);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; gated: boolean };
      assert.equal(body.ok, true);
      assert.equal(body.gated, false, "keeping the name Interview without the interview role must not open the gate");
      const row = getPipelineEntry(id);
      assert.ok(row);
      assert.equal(row.approvalKind, null);
    },
  );
});
