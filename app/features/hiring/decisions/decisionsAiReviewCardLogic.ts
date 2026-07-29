// Pure derivation logic for DecisionsAiReviewCard: parses the entry's
// approvalDetail JSON and computes the card's kind flags, the labeled
// pricing basis (OO-L2-10 / REC-01) and the screening confidence band. Split
// out of the card component so the JSX shell stays under the 200-line cap.
import { SCREENING_CONFIDENCE_BAND, type Entry, type Offer, type Scorecard, type Screening } from "@/app/features/shared/decisionsTypes";

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
  // AUTO1 — a supervised-clock reject queued for ratification. Same screening
  // payload shape; the tag names what clicking Reject actually does (apply +
  // email the rejection) so the reviewer knows this card IS the adverse action.
  const isQueuedReject = kind === "rejection_review";
  // DEC1 — a human-conducted interview's scorecard reaches this queue too; the
  // tag names the source so the reviewer knows whose judgment they're ratifying.
  const isHumanScorecard = isScorecard && parsed?.source === "human";

  // Direction 1 — the compact confidence band on the card itself. This is the
  // AI's numeric confidence in ITS screening verdict (screening/queued-reject
  // payloads carry a 0-100 scalar); a scorecard's confidence is a {level,reason}
  // band shown elsewhere, and an offer has none — so both are excluded, and an
  // absent value renders no band (no chrome). The fuller match confidence band +
  // score breakdown live one click away in the analysis modal (onInspect).
  const screeningConfidence = !isOffer && !isScorecard && typeof parsed?.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null;
  // Tone tracks how load-bearing the click is: a low-confidence advance/reject is
  // the wrong-click risk this band exists to flag. Tokens only (both themes).
  const confidenceTone =
    screeningConfidence == null
      ? ""
      : screeningConfidence >= SCREENING_CONFIDENCE_BAND.high
        ? "bg-moss"
        : screeningConfidence >= SCREENING_CONFIDENCE_BAND.medium
          ? "bg-amber-400"
          : "bg-coral";

  return { parsed, kind, isScorecard, isOffer, pricingBasis, isQueuedReject, isHumanScorecard, screeningConfidence, confidenceTone };
}
