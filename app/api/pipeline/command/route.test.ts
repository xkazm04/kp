// Handler-level coverage for /api/pipeline/command against an ISOLATED
// throwaway DB (testing/unit-db.ts must stay the first project import).
//
// Pins the backlog #37 guard: "advance top N" advances UP TO Offer and STOPS —
// an Offer-stage entry is never bare-advanced to Hired (Hired is OUTCOME-bearing
// and reachable only through the candidate accepting an extended offer, the same
// 422 semantics as /api/pipeline/[id]), and a DRAFTED offer (offer_review
// approval + payload) survives untouched instead of being destroyed by the
// generic one-stage advance. The held candidates are REPORTED (`heldAtOffer`)
// so part of the requested N is never silently swallowed.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval } from "../../../_lib/db/pipeline.ts";

after(() => cleanupUnitDb());
before(() => {
  // The command bar ranks ALL active entries by score — start from an empty
  // board so the demo seed (65 scored entries) can't outrank the fixtures.
  ensureDb().prepare(`DELETE FROM pipeline_entries`).run();
});

const post = (body: unknown): Promise<Response> =>
  POST(
    new NextRequest("http://localhost/api/pipeline/command", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

let seq = 0;
function entryFixture(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cmd-c${seq}`,
    candidateLabel: `Command Candidate ${seq}`,
    jobId: `cmd-job-${seq}`,
    jobTitle: "Command Test Role",
    ...overrides,
  });
  return entry;
}

test("advance top N stops at Offer: no silent Hired, the drafted offer is preserved, and the hold is reported", async () => {
  const screened = entryFixture({ stage: "Screened", matchScore: 90 });
  const interview = entryFixture({ stage: "Interview", matchScore: 85 });
  const atOffer = entryFixture({ stage: "Offer", matchScore: 95 });
  const draftedOffer = JSON.stringify({ subject: "Offer", body: "Hi", recommended: 120000, currency: "CZK" });
  setApproval(atOffer.id, "offer_review", draftedOffer);

  // Preview first (no confirm): the full top-3 set is shown, nothing mutates.
  const preview = await post({ text: "advance top 3" });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.mutating, true);
  assert.equal(previewBody.total, 3, "the Offer-stage candidate is part of the affected set, not hidden");
  assert.match(previewBody.description, /up to Offer/, "the preview says advancing stops at Offer");
  assert.equal(getPipelineEntry(atOffer.id)!.stage, "Offer", "preview must not mutate");

  // Execute.
  const res = await post({ text: "advance top 3", confirm: true });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.executed, true);
  assert.equal(body.count, 2, "only the two pre-Offer candidates advance");
  assert.equal(body.heldAtOffer, 1, "the Offer-stage candidate is reported as awaiting the offer flow");

  // The pre-Offer candidates moved exactly one stage.
  assert.equal(getPipelineEntry(screened.id)!.stage, "Interview");
  assert.equal(getPipelineEntry(interview.id)!.stage, "Offer");

  // The Offer-stage candidate: no phantom hire, the drafted offer intact.
  const held = getPipelineEntry(atOffer.id)!;
  assert.equal(held.stage, "Offer", "never bare-advanced to Hired");
  assert.equal(held.approvalKind, "offer_review", "the drafted offer approval survives");
  assert.equal(held.approvalDetail, draftedOffer, "the drafted offer payload survives byte-for-byte");
  const advances = listPipelineEventsForEntry(atOffer.id).filter(
    (e) => e.kind === "advanced" || e.kind === "auto_advanced"
  );
  assert.deepEqual(advances, [], "no advance event may be written for a held Offer-stage entry");
});

test("advance top N with no Offer-stage targets reports no holds", async () => {
  // The previous test left: screened@Interview, interview@Offer(no draft), atOffer@Offer.
  // Scope this run to 1 — the top-scored target is at Offer, so it holds; then
  // verify a pure pre-Offer set reports heldAtOffer absent.
  const fresh = entryFixture({ stage: "Accepted", matchScore: 99 });
  const res = await post({ text: "advance top 1", confirm: true });
  const body = await res.json();
  assert.equal(body.count, 1, "the single top candidate (pre-Offer) advances");
  assert.equal(body.heldAtOffer, undefined, "no holds → the field is omitted");
  assert.equal(getPipelineEntry(fresh.id)!.stage, "Screened");
});

test("reject below N rejects the FULL matched cohort, not just the 50 rendered preview rows (pipeline-board-candidate-drawer #2)", async () => {
  ensureDb().prepare(`DELETE FROM pipeline_entries`).run();
  // 60 Screened candidates below the line — more than the 50-row preview cap.
  const ids: string[] = [];
  for (let i = 0; i < 60; i += 1) ids.push(entryFixture({ stage: "Screened", matchScore: 40 }).id);

  // Preview: rows capped at 50, but total AND matchedIds cover all 60.
  const preview = await (await post({ text: "reject below 60%" })).json();
  assert.equal(preview.total, 60, "the preview counts every match");
  assert.equal(preview.preview.length, 50, "only the rendered rows are capped");
  assert.equal(preview.matchedIds.length, 60, "matchedIds is the FULL previewed set, not the render cap");

  // Confirm binding to matchedIds rejects all 60 (pre-fix, binding to the 50 rows
  // left 10 active with a "50 rejected" success message).
  const done = await (await post({ text: "reject below 60%", confirm: true, confirmIds: preview.matchedIds })).json();
  assert.equal(done.count, 60, "every matched candidate is rejected, not just the previewed 50");
  const stillActive = ids.filter((id) => getPipelineEntry(id)!.status === "active").length;
  assert.equal(stillActive, 0, "no matched candidate is silently left active");
});
