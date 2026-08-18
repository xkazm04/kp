// Pure derivation logic for DecisionsAiReviewCard: parses the entry's
// approvalDetail JSON and computes the card's kind flags, the labeled
// pricing basis (OO-L2-10 / REC-01) and the screening confidence band. Split
// out of the card component so the JSX shell stays under the 200-line cap.
import { type Entry, type Offer, type Scorecard, type Screening } from "@/app/features/shared/decisionsTypes";

export type ParsedApproval = Screening & Scorecard & Offer;

export function useAiReviewCardLogic(entry: Entry) {
  let parsed: ParsedApproval | null = null;
  try {
    parsed = entry.approvalDetail ? (JSON.parse(entry.approvalDetail) as ParsedApproval) : null;
  } catch {
    parsed = null;
  }
  const kind = entry.approvalKind;
  const isScorecard = kind === "scorecard_review";
  const isOffer = kind === "offer_review";
  // ONE labeled pricing basis (OO-L2-10 / REC-01): the salary was priced by a
  // FRESH fit check at draft time — a different producer from the header's
  // canonical match score, so it renders under its own label, never as a second
  // bare "Match N/100". offer-v3 payloads carry it structured (matchBasis);
  // persisted offer-v2 drafts are recovered from their deterministic rationale
  // template ("Match N/100 places the offer…" — always template-generated, so
  // the parse is reliable); anything else falls back to the stored prose.
  const legacyBasis =
    isOffer && typeof parsed?.matchBasis !== "number" && typeof parsed?.rationale === "string"
      ? /^Match (\d+)\/100 /.exec(parsed.rationale)
      : null;
  const pricingBasis = isOffer
    ? typeof parsed?.matchBasis === "number"
      ? parsed.matchBasis
      : legacyBasis
        ? Number(legacyBasis[1])
        : null
    : null;
  // UNPRICED DRAFTS (draft_offer's FAIL SAFE, pipeline/jobfit/automation.py). When the
  // active market configures no seniority band AND the posting carries none, the drafter
  // deliberately proposes NO figure: recommended / salaryMin / salaryMax come back null
  // together, the candidate letter names no number, and the draft is routed to the human
  // offer_review gate precisely so a recruiter sets the real one. The card used to render
  // those nulls through `Number(x ?? 0).toLocaleString()` — a literal "0" headline and a
  // 0–0 band meter — i.e. it fabricated the one number nobody was willing to invent, on
  // exactly the drafts that exist because the number is unknown. So: no figure and no
  // meter unless the payload genuinely carries them.
  const unpriced = isOffer && parsed != null && parsed.recommended == null;
  const hasBand = isOffer && parsed != null && parsed.salaryMin != null && parsed.salaryMax != null;

  // AUTO1 — a supervised-clock reject queued for ratification. Same screening
  // payload shape; the tag names what clicking Reject actually does (apply +
  // email the rejection) so the reviewer knows this card IS the adverse action.
  const isQueuedReject = kind === "rejection_review";
  // DEC1 — a human-conducted interview's scorecard reaches this queue too; the
  // tag names the source so the reviewer knows whose judgment they're ratifying.
  const isHumanScorecard = isScorecard && parsed?.source === "human";

  // UAT KAT-L1-004 (rec 2) / RECON-06 (rec 2) — THE MODEL'S SELF-REPORT, and why
  // it is no longer called "confidence" and no longer carries a tone band.
  //
  // The screening/queued-reject payload carries a 0-100 scalar the MODEL WROTE
  // ABOUT ITSELF: asked for a verdict, it also states how sure it feels. Nothing
  // measured it. It is evidence about the model, not about the candidate and not
  // about the world — no outcome, no holdout, no base rate stands behind it.
  //
  // This value used to be returned with a `confidenceTone` (moss / amber / coral,
  // banded at SCREENING_CONFIDENCE_BAND) that the card painted into a meter. Tone
  // + meter is the grammar this app reserves for MEASURED quantities, so a number
  // with nothing behind it rendered exactly like the calibration curve that has a
  // cohort behind it. The tone is gone with the meter; what survives is the number
  // and a label that says whose number it is (see DecisionsAiReviewCard).
  //
  // It is NOT replaced by a measured statistic here: the honest measured sibling
  // is the per-band advance rate, a COHORT property computed on the calibration
  // surface. Printing a cohort rate on a single candidate's card would swap one
  // mis-scoped claim for another, so this card quotes the model and says so, and
  // the measured number stays where its cohort is.
  //
  // Scorecards (a {level,reason} band) and offers (none) carry no such scalar, so
  // both are excluded; an absent value renders nothing at all.
  const modelSelfReport = !isOffer && !isScorecard && typeof parsed?.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null;

  return { parsed, kind, isScorecard, isOffer, unpriced, hasBand, pricingBasis, isQueuedReject, isHumanScorecard, modelSelfReport };
}
