// The keyless offer door: draft_offer on POST /api/pipeline/[id]. A recruiter's own terms
// (or the job's band midpoint) reach the SAME offer_review approval an AI draft does, and
// only that approval extends the offer, so offer-policy still decides what may be minted.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as actionPost } from "./[id]/route.ts";
import { closeEntriesByJobId, createPipelineEntry, getPipelineEntry, setApproval } from "../../_lib/db/pipeline.ts";
import { insertJob } from "../../_lib/job-ingest.ts";
import { draftManualOffer, manualOfferFigure } from "../../_lib/offer-manual-draft.ts";
import { DEFAULT_WORKSPACE_ID, createWorkspace } from "../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryAt(stage: string, band: [number, number] | null = [80_000, 100_000], workspaceId?: string): string {
  seq += 1;
  const jobId = `manual-offer-job-${seq}`;
  insertJob(
    { id: jobId, title: "Manual Offer Role", seniority: "medior", requirements: [], languages: [], ...(band ? { salaryBand: band } : {}) } as never,
    undefined,
    "published",
    workspaceId ?? DEFAULT_WORKSPACE_ID
  );
  const { entry } = createPipelineEntry({
    candidateId: `manual-offer-c${seq}`,
    candidateLabel: `Manual Offer Candidate ${seq}`,
    jobId,
    jobTitle: "Manual Offer Role",
    stage,
    ...(workspaceId ? { workspaceId } : {}),
  });
  return entry.id;
}

async function draft(id: string, extra: Record<string, unknown> = {}): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/pipeline/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "draft_offer", ...extra }),
    headers: { "content-type": "application/json" },
  });
  return (await actionPost(request, { params: Promise.resolve({ id }) })) as unknown as Response;
}

const detailOf = (id: string) => JSON.parse(getPipelineEntry(id)?.approvalDetail ?? "{}") as Record<string, unknown>;

test("the figure is what the recruiter typed, else the band midpoint, else nothing", () => {
  assert.equal(manualOfferFigure(95_000, [80_000, 100_000]), 95_000);
  assert.equal(manualOfferFigure("", [80_000, 100_000]), 90_000);
  assert.equal(manualOfferFigure(undefined, [80_000, 100_000]), 90_000);
  assert.equal(manualOfferFigure("", null), null, "no band is no figure, never an invented one");
});

test("an empty figure drafts the job's band midpoint and parks it for a human", async () => {
  const id = entryAt("Offer");
  const res = await draft(id, { salary: "" });
  assert.equal(res.status, 200);
  assert.equal(getPipelineEntry(id)?.approvalKind, "offer_review");
  const d = detailOf(id);
  assert.equal(d.recommended, 90_000);
  assert.equal(d.salaryMin, 80_000);
  assert.equal(d.salaryMax, 100_000);
  assert.equal(d.verdictSource, "template", "the card must not read this as a model's judgment");
  assert.equal(getPipelineEntry(id)?.stage, "Offer", "drafting moves nobody");
});

test("a typed figure wins over the band", async () => {
  const id = entryAt("Offer");
  assert.equal((await draft(id, { salary: 97_500 })).status, 200);
  assert.equal(detailOf(id).recommended, 97_500);
});

test("with no band and no figure the draft is unpriced rather than invented", async () => {
  const id = entryAt("Offer", null);
  assert.equal((await draft(id)).status, 200);
  assert.equal(detailOf(id).recommended, null);
});

test("a band set in another market's unit prices nothing: the draft is unpriced and says why", async () => {
  const id = entryAt("Offer");
  const jobId = getPipelineEntry(id)?.jobId as string;
  // The same role, its band now stamped EUR/month (set while the team ran in de); the
  // default team runs in cz, so the band is another unit — never converted, never a midpoint.
  insertJob(
    { id: jobId, title: "Manual Offer Role", seniority: "medior", requirements: [], languages: [], salaryBand: [4_000, 5_000], bandCurrency: "EUR", bandPeriod: "month" } as never,
    undefined,
    "published",
    DEFAULT_WORKSPACE_ID
  );
  assert.equal((await draft(id, { salary: "" })).status, 200);
  const d = detailOf(id);
  assert.equal(d.recommended, null, "no figure is invented from a EUR band for a CZK offer");
  assert.equal(d.salaryMin, null);
  assert.equal(d.currency, "CZK", "the offer is in the market's currency");
  assert.equal(d.bandAbsence, "band_other_currency", "the reason is stated, coded");
});

test("offer-policy refuses a figure nobody can be offered, and nothing is parked", async () => {
  const id = entryAt("Offer");
  const res = await draft(id, { salary: -5 });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "OFFER_SALARY_INVALID");
  assert.equal(getPipelineEntry(id)?.approvalKind, null);
});

test("off the offer step the door refuses with its code", async () => {
  const id = entryAt("Interview");
  const res = await draft(id);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "OFFER_DRAFT_NOT_AVAILABLE");
  assert.equal(getPipelineEntry(id)?.approvalKind, null);
});

test("a decision already open on the entry is never overwritten", async () => {
  const id = entryAt("Offer");
  setApproval(id, "scorecard_review", '{"source":"human"}');
  const res = await draft(id);
  assert.equal(res.status, 409);
  assert.equal(getPipelineEntry(id)?.approvalKind, "scorecard_review");
  assert.equal(detailOf(id).source, "human");
});

test("another team's entry answers the same 404 as a missing one", async () => {
  const other = createWorkspace("Manual offer other team", "org-manual-offer");
  const id = entryAt("Offer", [80_000, 100_000], other.id);
  const res = await draft(id);
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, "PIPELINE_ENTRY_NOT_FOUND");
  assert.equal(getPipelineEntry(id, other.id)?.approvalKind, null);
});

test("a typed salary that is not a number or numeric string is refused, not coerced", async () => {
  for (const salary of [true, [5], { a: 1 }, "abc"]) {
    const id = entryAt("Offer");
    const res = await draft(id, { salary });
    assert.equal(res.status, 400, JSON.stringify(salary));
    assert.equal(((await res.json()) as { code: string }).code, "OFFER_SALARY_INVALID");
    assert.equal(getPipelineEntry(id)?.approvalKind, null);
  }
  const id = entryAt("Offer");
  assert.equal((await draft(id, { salary: "95000" })).status, 200, "a numeric string still passes");
  const nul = entryAt("Offer");
  assert.equal((await draft(nul, { salary: null })).status, 200, "null falls through to the band");
});

test("an oversized action body is a 413 before any action runs", async () => {
  const id = entryAt("Offer");
  const res = await draft(id, { pad: "x".repeat(70_000) });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { code: string }).code, "PAYLOAD_TOO_LARGE");
  assert.equal(getPipelineEntry(id)?.approvalKind, null);
});

test("an entry closed during the translator await gets no offer_review card", async () => {
  const id = entryAt("Offer");
  const jobId = getPipelineEntry(id)?.jobId as string;
  // The call runs synchronously up to its first await; change the entry there.
  const pending = draftManualOffer({ id, workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(closeEntriesByJobId(jobId), 1);
  const res = await pending;
  assert.equal(res.status, 409);
  assert.equal((res.body as { code: string }).code, "OFFER_DRAFT_NOT_AVAILABLE");
  assert.equal(getPipelineEntry(id)?.approvalKind, null);
});

test("a decision raised during the translator await is not overwritten", async () => {
  const id = entryAt("Offer");
  const pending = draftManualOffer({ id, workspaceId: DEFAULT_WORKSPACE_ID });
  setApproval(id, "scorecard_review", '{"source":"human"}');
  assert.equal((await pending).status, 409);
  assert.equal(getPipelineEntry(id)?.approvalKind, "scorecard_review");
});
