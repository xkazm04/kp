// Guards on the human scorecard POST (scan 2026-11-08, findings 5, 7 and 8).
// Drives the real handler against an isolated DB, as stage-role.test.ts does.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { saveInterviewPrep } = await import("../../../_lib/interview-prep.ts");
const { createPipelineEntry, getPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
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
  // A real Request: the route reads its body through readJsonWithLimit, off the stream.
  const request = Object.assign(new Request(url, { method: "POST", body: JSON.stringify(body()) }), { nextUrl: url });
  return (await POST(request as never)) as unknown as Response;
}


// ── finding 12: the body is capped before it is parsed ───────────────────────

test("an oversized scorecard body is a 413 and files nothing", async () => {
  const { getInterviewPrep } = await import("../../../_lib/interview-prep.ts");
  const { readHumanScorecards } = await import("../../../_lib/human-scorecard-set.ts");
  const id = preppedAt("Interview");
  const res = await post(id, () => ({ ratings: [{ competency: "Ownership", rating: 4 }], summary: "x".repeat(200_000) }));
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { code: string }).code, "PAYLOAD_TOO_LARGE");
  assert.deepEqual(readHumanScorecards(getInterviewPrep(id)!.payload), []);
});

// ── finding 5: the gate is a compare-and-swap ────────────────────────────────

test("a decision card that lands between the read and the gate write is not overwritten", async () => {
  const id = preppedAt("Interview");
  // The body is a byte stream (readJsonWithLimit), so it cannot carry a lazy getter into the gap. A trigger
  // does the same job: the route's own write of the card (an UPDATE of interview_preps) runs
  // AFTER it read the entry's approval kind and BEFORE its setApproval, and the trigger makes
  // another session's offer_review land right there.
  const { ensureDb } = await import("../../../_lib/db/core.ts");
  const db = ensureDb();
  db.exec(`CREATE TRIGGER gap_${id.replace(/\W/g, "_")} AFTER UPDATE ON interview_preps WHEN NEW.entry_id = '${id}'
    BEGIN UPDATE pipeline_entries SET approval_kind = 'offer_review', approval_detail = '{}' WHERE id = '${id}'; END`);
  const res = await post(id, () => ({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" }));
  db.exec(`DROP TRIGGER gap_${id.replace(/\W/g, "_")}`);
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

// ── finding 7: only a number or a numeric string is a rating ─────────────────

test("null, empty, whitespace and boolean ratings are omitted as unrated; numbers and numeric strings count", async () => {
  const { getInterviewPrep } = await import("../../../_lib/interview-prep.ts");
  const { readHumanScorecards } = await import("../../../_lib/human-scorecard-set.ts");
  const id = preppedAt("Interview");
  const res = await post(id, () => ({
    ratings: [
      { competency: "A-null", rating: null },
      { competency: "B-empty", rating: "" },
      { competency: "C-blank", rating: "  " },
      { competency: "D-false", rating: false },
      { competency: "E-true", rating: true },
      { competency: "F-num", rating: 4 },
      { competency: "G-str", rating: "3" },
    ],
  }));
  assert.equal(res.status, 200);
  const records = readHumanScorecards(getInterviewPrep(id)!.payload);
  const kept = records.flatMap((r) => (r.ratings ?? []).map((x) => [x.competency, x.rating]));
  assert.deepEqual(kept, [["F-num", 4], ["G-str", 3]]);
});

// ── finding 8: active entries only; a verdict on nothing gates nothing ────────

test("a closed entry takes no scorecard: refused, nothing filed, nothing sealed", async () => {
  const { getInterviewPrep } = await import("../../../_lib/interview-prep.ts");
  const { readHumanScorecards } = await import("../../../_lib/human-scorecard-set.ts");
  const { markEntryStatus } = await import("../../../_lib/offers-store.ts");
  const { listDecisionRecords } = await import("../../../_lib/decision-record-store.ts");
  const id = preppedAt("Interview");
  assert.ok(markEntryStatus(id, "rejected"), "precondition: the entry is closed");

  const res = await post(id, () => ({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" }));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "INTERVIEW_ENTRY_NOT_ACTIVE");
  assert.deepEqual(readHumanScorecards(getInterviewPrep(id)!.payload), []);
  assert.deepEqual(listDecisionRecords({ candidateRef: id }), []);
  assert.equal(getPipelineEntry(id)!.approvalKind, null);
});

test("a recommendation with no usable rating is filed but does not open the gate", async () => {
  const id = preppedAt("Interview");
  const res = await post(id, () => ({ ratings: [{ competency: "Ownership", rating: null }], recommendation: "advance" }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { gated: boolean }).gated, false);
  assert.equal(getPipelineEntry(id)!.approvalKind, null);
});

test("the seal carries the actor humanActor() resolves, not a hard-coded role", async () => {
  const { humanActor } = await import("../../../_lib/auth/operator-approver.ts");
  const { listDecisionRecords } = await import("../../../_lib/decision-record-store.ts");
  const id = preppedAt("Interview");
  await post(id, () => ({ ratings: [{ competency: "Ownership", rating: 4 }], recommendation: "advance" }));
  const seal = listDecisionRecords({ candidateRef: id }).find((r) => r.kind === "human_scorecard");
  assert.ok(seal, "the scorecard is sealed");
  assert.equal(seal.actor, await humanActor());
});
