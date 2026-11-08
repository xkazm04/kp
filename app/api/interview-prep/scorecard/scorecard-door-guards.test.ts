// Guards on the human scorecard POST (scan 2026-11-08, findings 5, 7 and 8).
// Drives the real handler against an isolated DB, as stage-role.test.ts does.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { saveInterviewPrep } = await import("../../../_lib/interview-prep.ts");
const { createPipelineEntry, getPipelineEntry, setApproval } = await import("../../../_lib/db/pipeline.ts");
const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

let seq = 0;
function preppedAt(stage: string): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `sc-guard-c${seq}`,
    candidateLabel: `Scorecard Guard ${seq}`,
    jobId: `sc-guard-job-${seq}`,
    jobTitle: "Scorecard Guard Test",
    stage,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, { scenario: "guards" });
  return entry.id;
}

async function post(entryId: string, body: () => unknown): Promise<Response> {
  const url = new URL(`http://localhost/api/interview-prep/scorecard?entry=${encodeURIComponent(entryId)}`);
  return (await POST({ nextUrl: url, headers: new Headers(), json: async () => body() } as never)) as unknown as Response;
}


// ── finding 5: the gate is a compare-and-swap ────────────────────────────────

test("a decision card that lands between the read and the gate write is not overwritten", async () => {
  const id = preppedAt("Interview");
  const res = await post(id, () => ({
    // The `ratings` getter runs AFTER the route has read the entry's approval kind
    // and before it writes: it stands in for another session landing in that gap.
    get ratings() {
      setApproval(id, "offer_review", "{}");
      return [{ competency: "Ownership", rating: 4 }];
    },
    recommendation: "advance",
  }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { gated: boolean }).gated, false, "no gate was opened");
  assert.equal(getPipelineEntry(id)!.approvalKind, "offer_review", "the other decision survives");
});

test("with nothing in the gap the gate still opens (control)", async () => {
  const id = preppedAt("Interview");
  const res = await post(id, () => ({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" }));
  assert.equal(((await res.json()) as { gated: boolean }).gated, true);
  assert.equal(getPipelineEntry(id)!.approvalKind, "scorecard_review");
});
