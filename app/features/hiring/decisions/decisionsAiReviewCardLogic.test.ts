// Pins the AI review card's derivation — the module that decides whether a
// salary number prints at all, and the only pure module in this directory that
// had no test.
//
// Three behaviours matter enough to break a build over: the payload parse (a
// malformed approvalDetail must not throw a card off the screen), the legacy
// offer-v2 rationale recovery (a persisted draft's pricing basis is recovered
// from a deterministic template, so the regex is load-bearing), and the
// `unpriced` fail-safe (draft_offer deliberately proposes NO figure when no
// band is configured; the card used to render that as a literal "0" headline —
// it fabricated the one number nobody was willing to invent, on exactly the
// drafts that exist because the number is unknown).
//
// `useAiReviewCardLogic` is named as a hook but calls none — it is a pure
// derivation over one entry, so it is exercised directly here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { useAiReviewCardLogic } from "./decisionsAiReviewCardLogic.ts";
import type { Entry } from "@/app/features/shared/decisionsTypes";

const entry = (approvalKind: string, detail: unknown): Entry =>
  ({
    id: "e1",
    approvalKind,
    approvalDetail: typeof detail === "string" ? detail : detail === undefined ? undefined : JSON.stringify(detail),
  }) as unknown as Entry;

// ---- the payload parse --------------------------------------------------------

test("a well-formed payload parses through", () => {
  const l = useAiReviewCardLogic(entry("offer_review", { recommended: 95000, salaryMin: 80000, salaryMax: 110000, matchBasis: 78 }));
  assert.equal(l.parsed?.recommended, 95000);
  assert.equal(l.isOffer, true);
  assert.equal(l.hasBand, true);
  assert.equal(l.pricingBasis, 78);
});

test("malformed JSON is null, never a throw — a broken payload must not take the card down", () => {
  const l = useAiReviewCardLogic(entry("offer_review", "{not json"));
  assert.equal(l.parsed, null);
  assert.equal(l.hasBand, false);
  assert.equal(l.pricingBasis, null);
  assert.equal(l.unpriced, false, "with NOTHING parsed there is no draft to call unpriced");
});

test("an absent approvalDetail parses to null without touching JSON.parse", () => {
  assert.equal(useAiReviewCardLogic(entry("screening_review", undefined)).parsed, null);
});

// ---- the legacy (offer-v2) basis recovery -------------------------------------

test("a v2 draft's pricing basis is recovered from its deterministic rationale", () => {
  const l = useAiReviewCardLogic(entry("offer_review", { recommended: 90000, rationale: "Match 72/100 places the offer mid-band." }));
  assert.equal(l.pricingBasis, 72);
});

test("the structured matchBasis wins over the prose whenever it is present", () => {
  const l = useAiReviewCardLogic(entry("offer_review", { recommended: 90000, matchBasis: 81, rationale: "Match 72/100 places the offer mid-band." }));
  assert.equal(l.pricingBasis, 81, "v3 payloads are not re-parsed out of their own prose");
});

test("prose that is not the template yields no basis — a number is never guessed out of free text", () => {
  assert.equal(useAiReviewCardLogic(entry("offer_review", { recommended: 90000, rationale: "Strong match at 72/100." })).pricingBasis, null);
  assert.equal(useAiReviewCardLogic(entry("offer_review", { recommended: 90000, rationale: "match 72/100 places the offer" })).pricingBasis, null);
});

test("a scorecard or screening card never carries a pricing basis, whatever its prose says", () => {
  assert.equal(useAiReviewCardLogic(entry("scorecard_review", { rationale: "Match 72/100 places the offer mid-band." })).pricingBasis, null);
  assert.equal(useAiReviewCardLogic(entry("screening_review", { rationale: "Match 72/100 places the offer mid-band." })).pricingBasis, null);
});

// ---- the unpriced fail-safe ---------------------------------------------------

test("a draft with no recommended figure is UNPRICED, and shows neither figure nor meter", () => {
  const l = useAiReviewCardLogic(entry("offer_review", { recommended: null, salaryMin: null, salaryMax: null }));
  assert.equal(l.unpriced, true);
  assert.equal(l.hasBand, false, "no meter without a real band");
});

test("a priced draft missing one end of the band is priced, but still has no meter", () => {
  const l = useAiReviewCardLogic(entry("offer_review", { recommended: 90000, salaryMin: 80000, salaryMax: null }));
  assert.equal(l.unpriced, false);
  assert.equal(l.hasBand, false, "half a band is not a band — a 80000..null meter is a fabricated range");
});

test("unpriced is an OFFER property: a screening card is never called unpriced", () => {
  assert.equal(useAiReviewCardLogic(entry("screening_review", { confidence: 60 })).unpriced, false);
});

// ---- the kind flags and the model's self-report -------------------------------

test("the queued-reject and human-scorecard tags name what the card actually is", () => {
  assert.equal(useAiReviewCardLogic(entry("rejection_review", { confidence: 70 })).isQueuedReject, true);
  assert.equal(useAiReviewCardLogic(entry("scorecard_review", { source: "human" })).isHumanScorecard, true);
  assert.equal(useAiReviewCardLogic(entry("scorecard_review", { source: "ai" })).isHumanScorecard, false);
});

test("the model's self-report is clamped and rounded, and only offered where the payload carries one", () => {
  assert.equal(useAiReviewCardLogic(entry("screening_review", { confidence: 87.4 })).modelSelfReport, 87);
  assert.equal(useAiReviewCardLogic(entry("screening_review", { confidence: 140 })).modelSelfReport, 100);
  assert.equal(useAiReviewCardLogic(entry("screening_review", { confidence: -5 })).modelSelfReport, 0);
  assert.equal(useAiReviewCardLogic(entry("screening_review", {})).modelSelfReport, null);
  assert.equal(useAiReviewCardLogic(entry("offer_review", { confidence: 80 })).modelSelfReport, null, "offers carry no such scalar");
  assert.equal(useAiReviewCardLogic(entry("scorecard_review", { confidence: 80 })).modelSelfReport, null, "nor do scorecards");
});
