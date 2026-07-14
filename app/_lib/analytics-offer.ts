// Offer-leg conversion (Direction 1 — "measure the offer leg"). The funnel stops
// meaning anything after Interview: offers extended, accepted, declined and
// expired are ALREADY recorded as pipeline events (offer_sent / offer_accepted /
// offer_declined / offer_expired) but never aggregated — so there is no offer
// acceptance rate, and the hire forecast projects with no acceptance-probability
// input. Pure + import-free: the DB layer hands over the per-kind counts it
// already GROUP-BYs (windowed, sim-excluded, workspace-scoped), and every rate +
// the honesty gate derive here where they are unit-testable and deterministic.

// The minimum number of offers before an acceptance rate is shown. Offers are the
// rarest pipeline event, so this floor sits well below the calibration outcomes
// gate (MIN_CALIBRATION_OUTCOMES = 20) — but a "handful of offers" must never mint
// a headline rate the recruiter over-reads. Echoed to the UI so it can render the
// honest "K of MIN offers" gate line, mirroring the calibration panel's idiom.
export const MIN_OFFERS = 5;

// The four offer-lifecycle event kinds this module folds. offer_sent = extended
// (comms-dispatch), the three others are the terminal resolutions.
export type OfferCounts = { extended: number; accepted: number; declined: number; expired: number };

export type OfferConversion = {
  extended: number; // offers sent (offer_sent events)
  accepted: number;
  declined: number;
  expired: number;
  // Extended offers with no terminal event yet (>= 0). A live offer, not a loss.
  pending: number;
  // Rates over the denominator, whole-percent, null below the min-offers gate.
  acceptRatePct: number | null;
  declineRatePct: number | null;
  expireRatePct: number | null;
  // The accept rate as a 0..1 fraction for the forecast; null below the gate so
  // the projection stays byte-identical to its pre-offer behaviour.
  acceptRate: number | null;
  // n = the gate denominator = max(extended, resolved), so a missing offer_sent
  // trail (legacy rows) can never push a rate past 100%. enoughData = n >= min.
  n: number;
  minOffers: number;
  enoughData: boolean;
};

function clampCount(x: number): number {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/** Fold the four offer-event counts into the offer-leg conversion, honesty-gated
 *  on the minimum-offers floor. Denominator = max(extended, resolved) so the rates
 *  are bounded to [0, 100] even when the offer_sent trail under-counts the
 *  terminal events (older offers logged only their resolution). */
export function offerConversion(counts: OfferCounts, minOffers: number = MIN_OFFERS): OfferConversion {
  const accepted = clampCount(counts.accepted);
  const declined = clampCount(counts.declined);
  const expired = clampCount(counts.expired);
  const resolved = accepted + declined + expired;
  const extended = Math.max(clampCount(counts.extended), resolved);
  const pending = Math.max(0, extended - resolved);
  const n = extended;
  const enoughData = n >= minOffers;
  const pct = (x: number): number | null => (enoughData && n > 0 ? Math.round((x / n) * 100) : null);
  return {
    extended,
    accepted,
    declined,
    expired,
    pending,
    acceptRatePct: pct(accepted),
    declineRatePct: pct(declined),
    expireRatePct: pct(expired),
    acceptRate: enoughData && n > 0 ? accepted / n : null,
    n,
    minOffers,
    enoughData,
  };
}
