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

/** The projection's METHOD, named once so the UI can state it instead of printing a
 *  bare number. Inflow hires are a linear extrapolation: mean weekly inflow × the
 *  horizon × the empirical conversion. It is not a time-series model, it assumes the
 *  next N weeks look like the last few, and the range below is what says so. */
export const FORECAST_METHOD = "velocity-x-conversion" as const;

/** Minimum COMPLETED HIRES before the empirical conversion is allowed to drive a
 *  projection. Every sibling figure on this page gates (`BOTTLENECK_MIN_SAMPLE` = 3,
 *  the offer leg's min-offers floor, `MIN_CALIBRATION_OUTCOMES` = 20) and this one —
 *  the single largest number the tab prints — gated at ONE hire: a 1-of-40 funnel
 *  licensed "+7.5 hires over 12 weeks" to one decimal place. Three is the same floor
 *  the bottleneck uses, and for the same reason: below it one outcome IS the trend. */
export const MIN_FORECAST_HIRES = 3;

/** Minimum weeks that actually RECEIVED candidates before the velocity mean is
 *  allowed to be extrapolated forward. The mean is taken over every bucket (a quiet
 *  week is real evidence of a low rate), but a mean built from one or two active weeks
 *  is a burst, not a rate — and the 12-week horizon multiplies it by twelve. Four is a
 *  month of observed inflow, the shortest span over which "candidates per week" is a
 *  statement about the pipeline rather than about one good week. */
export const MIN_FORECAST_INFLOW_WEEKS = 4;

/** A projected horizon: the point estimate plus the band the inflow variance implies.
 *  `low`/`high` are the same arithmetic run at velocity ∓ one standard deviation of the
 *  weekly buckets, floored at zero (a negative weekly inflow is not a thing). */
export type ForecastHorizon = { weeks: number; hires: number; low: number; high: number };

export type Forecast = {
  method: typeof FORECAST_METHOD;
  weeklyVelocity: number; // mean new candidates / week (1 decimal)
  /** Population standard deviation of the weekly buckets (1 decimal) — the spread the
   *  range is built from, exposed so the UI can name its own uncertainty basis. */
  weeklyVelocityStdDev: number;
  overallConversionPct: number | null; // hired-reach / first-reach, null when no cohort
  inFlightExpectedHires: number; // expected hires from candidates already active
  projected: ForecastHorizon[]; // inflow-driven hires per horizon, with their range
  etaDays: number | null; // average time-to-hire, the realization lag for inflow
  // Direction 1 — the accept rate (0..1) actually applied to the projection, or
  // null when none was supplied (or there was no offer leg to apply it to). Lets
  // the UI state its acceptance basis honestly ("assuming the observed NN%…").
  offerAcceptRate: number | null;
  // True when there's enough signal to project: a non-empty cohort that has produced
  // at least MIN_FORECAST_HIRES hires, over at least MIN_FORECAST_INFLOW_WEEKS weeks
  // that actually received candidates. The UI shows a "not enough signal yet" state
  // otherwise rather than a misleading flat-zero forecast.
  hasSignal: boolean;
  /** What the floor was measured against, so the no-signal state can say what is
   *  missing ("2 of 3 hires, 1 of 4 weeks with new candidates") instead of refusing
   *  without a reason the reader can act on. */
  signal: { hires: number; inflowWeeks: number; minHires: number; minInflowWeeks: number };
};

const DEFAULT_HORIZONS = [4, 8, 12];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Population (not sample) standard deviation: the buckets ARE the whole observed
 *  span, not a draw from a larger set, and n-1 on a two-bucket window would inflate
 *  the band for no reason a reader could name. */
function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

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
  //
  // >= 3, not >= 2: on a two-row funnel `funnel[length - 2]` IS the entry row, so
  // offerReached === firstReached and the substitution below collapses to
  // `projectionConversion = observed-accept` — the whole pipeline read as if every
  // arrival reached an offer. validatePipelineStages (decision-config-schema.ts)
  // requires only entry + terminal, so a two-column board is a legal saved axis and
  // the funnel is built 1:1 from it: such a workspace with a measured 60 % accept
  // and 10 leads/week projected 72 hires at the 12-week horizon. A genuine offer
  // leg needs a row that is neither the entry nor the hire.
  const offerRow = funnel.length >= 3 ? funnel[funnel.length - 2] : undefined;
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

  // The floor. Two independent inputs feed the projection, so both are gated: the
  // conversion it multiplies by (hires) and the velocity it multiplies (weeks that
  // actually received candidates). Either alone is not enough — a hundred hires over
  // one burst week extrapolates that week twelve times, and four steady weeks with one
  // hire still divides by a cohort of one.
  const inflowWeeks = weeklyAdded.filter((n) => n > 0).length;
  const hasSignal =
    overallConversion != null && hiredReached >= MIN_FORECAST_HIRES && inflowWeeks >= MIN_FORECAST_INFLOW_WEEKS;

  const spread = stdDev(weeklyAdded);
  const weeklyVelocityStdDev = round1(spread);
  // The range is the SAME arithmetic at velocity ∓ one standard deviation. Floored at
  // zero on the low side: the pipeline cannot receive a negative number of candidates,
  // and a negative low bound would read as a forecast of un-hiring.
  const project = (v: number, weeks: number) =>
    hasSignal ? round1(Math.max(0, v) * weeks * (projectionConversion as number)) : 0;
  const projected: ForecastHorizon[] = horizons.map((weeks) => ({
    weeks,
    hires: project(weeklyVelocity, weeks),
    low: project(weeklyVelocity - spread, weeks),
    high: project(weeklyVelocity + spread, weeks),
  }));

  return {
    method: FORECAST_METHOD,
    weeklyVelocity,
    weeklyVelocityStdDev,
    overallConversionPct,
    inFlightExpectedHires,
    projected,
    etaDays: avgTimeToHireDays,
    hasSignal,
    signal: {
      hires: hiredReached,
      inflowWeeks,
      minHires: MIN_FORECAST_HIRES,
      minInflowWeeks: MIN_FORECAST_INFLOW_WEEKS,
    },
    offerAcceptRate,
  };
}
