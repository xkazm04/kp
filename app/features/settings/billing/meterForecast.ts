// Pace verdicts for a usage meter, and whether the plan card owes two dates.
// Pure and node:test-pinned (meterForecast.test.ts) — the rows that render them are .tsx.
//
// A meter used to say "180 of 300 used" and nothing else, so 60% on day 5 and 60% on
// day 28 read the same. This folds the meter and its allowance window
// (billingOverview.allowanceWindow — the SAME key the debit lands under) into one
// closed verdict:
//
//   unlimited           no limit to run out of
//   depleted            nothing left right now — a fact, not a forecast (the existing
//                       pack / upgrade CTA carries it)
//   tooEarly            too little calendar or too little usage to project honestly
//   onPace              the linear projection to the reset stays within capacity
//   runsOutBeforeReset  it does not, and here is roughly when
//   overageProjected    HIRES ONLY: past the allowance is billed as overage and never
//                       blocks (plans.ts), so it must not be worded as "runs out"
//
// Linear pace over elapsed days is the whole model, and it is stated as such in the
// copy ("at this pace"). Capacity is what is left to spend plus what has been spent:
// the included remainder and the pack credits on hand.

import type { MeterOverview } from "@/app/_lib/billing";

export type ForecastMeter = Pick<MeterOverview, "meter" | "limit" | "used" | "credits"> & {
  /** MeterOverview's remaining (included remainder + credits). Derived when absent. */
  remaining?: number | null;
};
export type ForecastWindow = { start: string; resetsAt: string; asOf: string };

export type MeterForecast =
  | { kind: "unlimited" }
  | { kind: "depleted" }
  | { kind: "tooEarly" }
  | { kind: "onPace" }
  | { kind: "runsOutBeforeReset"; runsOutAt: string; daysBeforeReset: number }
  | { kind: "overageProjected" };

/** Small-sample floor: fewer whole days than this since the window opened, or fewer
 *  units than this used, and the verdict is "too early to tell" — never a projected
 *  date from one data point or one afternoon. */
export const FORECAST_MIN_DAYS = 3;
export const FORECAST_MIN_USED = 2;

/** Debited but never gated (plans.ts): overage is billed, a hire is never refused. */
const NEVER_GATED = new Set<string>(["hires"]);

const DAY_MS = 86_400_000;

export function meterForecast(meter: ForecastMeter, window: ForecastWindow): MeterForecast {
  if (meter.limit === null) return { kind: "unlimited" };
  const remaining = meter.remaining ?? Math.max(0, meter.limit - meter.used) + Math.max(0, meter.credits);
  const capacity = meter.used + remaining;
  const neverGated = NEVER_GATED.has(meter.meter);

  // Facts before forecasts.
  if (neverGated && meter.used > meter.limit) return { kind: "overageProjected" };
  if (!neverGated && remaining <= 0) return { kind: "depleted" };

  const start = Date.parse(window.start);
  const reset = Date.parse(window.resetsAt);
  const asOf = Date.parse(window.asOf);
  const elapsedDays = (asOf - start) / DAY_MS;
  if (!(elapsedDays >= FORECAST_MIN_DAYS) || meter.used < FORECAST_MIN_USED || !(reset > asOf)) return { kind: "tooEarly" };

  const perDay = meter.used / elapsedDays;
  const projected = perDay * ((reset - start) / DAY_MS);
  if (projected <= capacity) return { kind: "onPace" };
  if (neverGated) return { kind: "overageProjected" };

  const runsOut = asOf + (remaining / perDay) * DAY_MS;
  return {
    kind: "runsOutBeforeReset",
    runsOutAt: new Date(runsOut).toISOString(),
    daysBeforeReset: Math.max(0, Math.floor((reset - runsOut) / DAY_MS)),
  };
}

/** Does the plan card owe two dates? The PAID period end (the provider's anniversary)
 *  and the ALLOWANCE reset (the 1st, UTC) are different facts that coincide only for a
 *  subscription anchored on the 1st. When they coincide one line says both; when
 *  either is missing there is nothing to contrast. Compared by UTC calendar day. */
export function planDatesView(input: { paidPeriodEnd: string | null; resetsAt: string | null }): { diverge: boolean } {
  if (!input.paidPeriodEnd || !input.resetsAt) return { diverge: false };
  const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
  return { diverge: day(input.paidPeriodEnd) !== day(input.resetsAt) };
}
