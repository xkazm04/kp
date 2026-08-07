// Re-extend terms consistency (offers-onboarding #1) — against an ISOLATED
// throwaway DB (testing/unit-db.ts must stay the FIRST project import so KP_DB_PATH
// is set before any store opens a connection).
//
// The bug: a re-extend after a draft edit re-dispatched the offer letter from the
// FRESH draft (e.g. corrected 100k -> 120k) while getOrCreateOpenOffer reused the
// stale open row verbatim — so the BINDING accept page (offer-finalize.offerView ->
// OfferClient renders offer.salary/currency) still showed the OLD figure. A
// candidate could accept terms that differ from the letter they were sent.
//
// The invariant these tests pin: the terms shown on the accept page are exactly the
// terms the most recently dispatched letter was minted from. The route mints BOTH
// from one draft — getOrCreateOpenOffer({ salary: Number(draft.recommended), ... })
// for the stored offer-of-record AND dispatchOffer(entry, draft, ...) for the letter
// — so `offerView(token).salary === Number(draft.recommended)` is exactly "accept
// page terms == dispatched letter terms".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { POST } from "../api/pipeline/[id]/route.ts";
import { createPipelineEntry, getPipelineEntry, setApproval } from "./db/pipeline.ts";
import { createOffer, getOfferByToken, getOrCreateOpenOffer, markOfferResponded } from "./offers-store.ts";
import { offerView } from "./offer-finalize.ts";
import { listDecisionRecords } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

const post = (id: string, body: unknown): Promise<Response> =>
  POST(
    new NextRequest(`http://localhost/api/pipeline/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );

let seq = 0;
function entryAtOffer() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `rx-c${seq}`,
    candidateLabel: `Reextend Candidate ${seq}`,
    jobId: `rx-job-${seq}`,
    jobTitle: "Reextend Test Role",
    stage: "Offer",
    contact: `rx-c${seq}@example.com`,
  });
  return entry;
}

/** The offer letter and the stored offer-of-record are BOTH minted from the draft;
 *  this mirrors exactly what the route feeds dispatchOffer / getOrCreateOpenOffer,
 *  so it names "the dispatched letter's terms" in a way the test can compare. */
function draftFor(recommended: number, currency: string) {
  return {
    subject: `Your offer — Reextend Test Role`,
    body: `We are delighted to offer you ${recommended.toLocaleString("en-US")} ${currency} per year.`,
    recommended,
    currency,
  };
}

/** Extend (or re-extend) the drafted offer through the REAL route and return the
 *  candidate token the accept page is reached by. Re-drafts the approval first, since
 *  the previous extend consumed it (setApproval(null)). */
async function extendWithDraft(entryId: string, recommended: number, currency: string): Promise<string> {
  setApproval(entryId, "offer_review", JSON.stringify(draftFor(recommended, currency)));
  const res = await post(entryId, { action: "accept" });
  assert.equal(res.status, 200, "approving a drafted offer must extend it (200)");
  const body = await res.json();
  assert.equal(body.offerExtended, true, "the offer_review accept extends, not hires");
  return String(body.link).split("/offer/")[1];
}

test("re-extending with corrected compensation makes the accept page match the freshly dispatched letter — not the original", async () => {
  const entry = entryAtOffer();

  // First extend at 100,000 USD — this is the letter the candidate first receives.
  const firstDraft = draftFor(100_000, "USD");
  const token = await extendWithDraft(entry.id, firstDraft.recommended, firstDraft.currency);
  const afterFirst = offerView(token)!;
  assert.equal(afterFirst.salary, 100_000, "accept page shows the first letter's figure");
  assert.equal(afterFirst.currency, "USD");

  // Recruiter realizes the number was wrong, corrects the draft to 120,000 and
  // re-extends. A re-extend re-sends the SAME link (idempotent) — never a new one.
  const fixedDraft = draftFor(120_000, "USD");
  const token2 = await extendWithDraft(entry.id, fixedDraft.recommended, fixedDraft.currency);
  assert.equal(token2, token, "a re-extend re-sends the SAME candidate link");

  // THE INVARIANT: the accept page's terms equal the most recently dispatched
  // letter's terms (fixedDraft), NOT the original (firstDraft).
  const view = offerView(token)!;
  assert.equal(view.salary, Number(fixedDraft.recommended), "accept page == the corrected letter's compensation");
  assert.equal(view.currency, fixedDraft.currency);
  assert.notEqual(view.salary, Number(firstDraft.recommended), "the stale figure must NOT survive the re-extend");
  // The candidate is still able to act (the corrected offer is live, same token).
  assert.equal(getOfferByToken(token)!.status, "extended");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "extending is not hiring");

  // The corrected terms are also recorded in the decision SoR (the finding noted the
  // re-seal was skipped on re-extend). Newest offer_terms record reflects 120,000.
  const latestTerms = listDecisionRecords({ candidateRef: entry.id }).find((r) => r.kind === "offer_terms");
  assert.ok(latestTerms, "the corrected offer terms were sealed into the decision chain");
  assert.match(latestTerms!.rationale, /120000|120,000/, "the sealed record names the corrected figure");
});

test("a pure idempotent re-extend (unchanged terms) reuses the row verbatim — same token, no update", () => {
  const entry = entryAtOffer();
  const input = {
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "USD",
    salary: 90_000,
    payload: { recommended: 90_000, currency: "USD" },
  };
  const first = getOrCreateOpenOffer(input);
  const second = getOrCreateOpenOffer(input);
  assert.equal(first.created, true);
  assert.deepEqual(
    { created: second.created, updated: second.updated, token: second.offer.token },
    { created: false, updated: false, token: first.offer.token },
    "unchanged terms: no new row, no update, same link"
  );
});

test("an already-accepted offer is never rewritten into a different amount; the old token keeps its recorded terms", () => {
  const entry = entryAtOffer();
  const first = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "USD",
    salary: 100_000,
    payload: { recommended: 100_000, currency: "USD" },
    ttlDays: null,
  });
  const claimed = markOfferResponded(first.token, "accepted");
  assert.ok(claimed.claimed, "the offer is accepted at 100k");

  // A later re-extend at a different amount must NOT reach back and mutate the
  // accepted row — there is no OPEN offer, so a genuinely NEW one is minted.
  const next = getOrCreateOpenOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "USD",
    salary: 120_000,
    payload: { recommended: 120_000, currency: "USD" },
  });
  assert.equal(next.created, true, "a re-extend after acceptance mints a fresh offer, not a rewrite");
  assert.notEqual(next.offer.token, first.token, "the new terms live on a new token");
  // The already-accepted token still resolves to its OWN recorded 100k — never the
  // new figure — so a superseded link never serves stale-vs-live-mismatched terms.
  const accepted = offerView(first.token)!;
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.salary, 100_000, "the accepted token keeps the terms it was accepted at");
});
