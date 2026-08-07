// Forward-looking hire projection for the analytics dashboard (idea-094b5870).
// Every other figure is backward-looking; this turns the inputs pipelineAnalytics
// already produces — weekly inflow velocity, the funnel's empirical conversion,
// and average time-to-hire — into "expected hires over the next N weeks" plus an
// expectation for the candidates already in flight. Pure + import-free so the
// projection math is unit-testable and deterministic.
//
// Two independent sources of future hires:
//   * INFLOW — candidates who will arrive over the horizon: weeklyVelocity × weeks
//     × overall conversion (hired-reach / first-reach).
//   * IN-FLIGHT — active candidates already in the pipeline, each credited the
//     empirical forward conversion from their CURRENT stage (hiredReach /
//     reach-at-their-stage), so someone at Interview counts for more than someone
//     just Accepted.

export type ForecastFunnelRow = { stage: string; reached: number; current: number };

export type ForecastInput = {
  // The momentum "added" series (new candidates per recent week).
  weeklyAdded: number[];
  // The funnel rows, Accepted-first … Hired-last (the last row is the hire stage;
  // the row BEFORE it is the offer stage — the last gate before a hire).
  funnel: ForecastFunnelRow[];
  avgTimeToHireDays: number | null;
  // Horizons (in weeks) to project inflow hires for.
  horizonsWeeks?: number[];
  // Direction 1 — the observed offer-acceptance probability (0..1) from the offer
  // event ledger, honesty-gated upstream (null below the min-offers floor). When
  // present it REPLACES the funnel-implied offer→hire leg so the projection rests
  // on the measured accept rate instead of a funnel-derived one; null → the math
  // is byte-identical to its pre-offer behaviour (below the gate = today).
  offerAcceptRate?: number | null;
};

export type Forecast = {
  weeklyVelocity: number; // mean new candidates / week (1 decimal)
  overallConversionPct: number | null; // hired-reach / first-reach, null when no cohort
  inFlightExpectedHires: number; // expected hires from candidates already active
  projected: { weeks: number; hires: number }[]; // inflow-driven hires per horizon
  etaDays: number | null; // average time-to-hire, the realization lag for inflow
  // Direction 1 — the accept rate (0..1) actually applied to the projection, or
  // null when none was supplied (or there was no offer leg to apply it to). Lets
  // the UI state its acceptance basis honestly ("assuming the observed NN%…").
  offerAcceptRate: number | null;
  // True when there's enough signal to project (a non-empty cohort that has
  // produced at least one hire). The UI shows a "not enough signal yet" state
  // otherwise rather than a misleading flat-zero forecast.
  hasSignal: boolean;
};

const DEFAULT_HORIZONS = [4, 8, 12];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function forecastHires(input: ForecastInput): Forecast {
  const { funnel, weeklyAdded, avgTimeToHireDays } = input;
  const horizons = input.horizonsWeeks ?? DEFAULT_HORIZONS;

  const weeklyVelocity = Math.round(mean(weeklyAdded) * 10) / 10;
  const first = funnel[0];
  const hire = funnel[funnel.length - 1];
  const firstReached = first?.reached ?? 0;
  const hiredReached = hire?.reached ?? 0;
  const overallConversion = firstReached > 0 ? hiredReached / firstReached : null;
  const overallConversionPct = overallConversion != null ? Math.round(overallConversion * 100) : null;

  // Direction 1 — the offer stage is the row before the hire stage (the last gate
  // before a hire). When an observed accept rate is supplied AND there is a real
  // offer leg to apply it to, the projection's offer→hire leg is rebuilt from the
  // MEASURED accept rate: (reach → offer) × observed-accept. A null rate (below
  // the gate, or no offer leg) leaves the offer-derived conversion untouched, so
  // the projection is byte-identical to its pre-offer behaviour.
  const offerRow = funnel.length >= 2 ? funnel[funnel.length - 2] : undefined;
  const offerReached = offerRow?.reached ?? 0;
  const applyAccept = input.offerAcceptRate != null && firstReached > 0 && offerReached > 0;
  const offerAcceptRate = applyAccept ? (input.offerAcceptRate as number) : null;
  const projectionConversion =
    offerAcceptRate != null ? (offerReached / firstReached) * offerAcceptRate : overallConversion;

  // In-flight: each active candidate credited the forward conversion from their
  // stage. The hire stage itself is already-hired, not in-flight, so skip it. When
  // an observed accept rate applies, candidates already AT the offer stage are
  // credited that measured rate directly rather than the funnel-derived one.
  let inFlight = 0;
  for (let i = 0; i < funnel.length - 1; i += 1) {
    const row = funnel[i];
    if (row.current <= 0 || row.reached <= 0) continue;
    const atOfferLeg = offerAcceptRate != null && i === funnel.length - 2;
    inFlight += atOfferLeg ? row.current * offerAcceptRate : row.current * (hiredReached / row.reached);
  }
  const inFlightExpectedHires = Math.round(inFlight * 10) / 10;

  const hasSignal = overallConversion != null && hiredReached > 0;
  const projected = horizons.map((weeks) => ({
    weeks,
    hires: hasSignal ? Math.round(weeklyVelocity * weeks * (projectionConversion as number) * 10) / 10 : 0,
  }));

  return {
    weeklyVelocity,
    overallConversionPct,
    inFlightExpectedHires,
    projected,
    etaDays: avgTimeToHireDays,
    hasSignal,
    offerAcceptRate,
  };
}
