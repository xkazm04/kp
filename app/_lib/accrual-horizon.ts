// The ACCRUAL HORIZON: when a figure is refused for a thin sample, how many more
// observations it needs and, at the recent pace, roughly when it will have them.
//
// Registry: recruiting/small-sample-honesty-in-hiring-analytics, technique
// state-the-accrual-horizon, step 5 — "answer the question the refusal provokes:
// the count needed, the current rate of accrual, and the resulting date". A refusal
// with a date attached is a plan; without one it is an excuse.
//
// Honest in three ways a bare "ETA" is not, each a named `reason` with no date:
//   no-pace            nothing has accrued recently (or no pace is measured for this
//                      unit), so any date would be invented
//   window-too-narrow  a SLIDING window's sample is bounded by pace x window: at
//                      this pace a `windowDays` window never holds `need`, so the
//                      only honest advice is to widen it
//   not-accruing       the figure does not grow with time (a point-in-time ratio),
//                      so waiting is not the remedy and no date applies
//
// Pure and dependency-free so the metric pack and, next, the forecast band's floor
// refusal can share one rule for "how far, and when".

export type AccrualReason = "no-pace" | "window-too-narrow" | "not-accruing";

export type AccrualHorizon = {
  /** Observations still needed to reach the floor (0 when it is met). */
  more: number;
  /** Whole weeks until the floor is reached at `perWeek`, rounded UP; null with a reason. */
  etaWeeks: number | null;
  /** Epoch ms of that week boundary; null with a reason. */
  etaDate: number | null;
  reason: AccrualReason | null;
};

const WEEK_MS = 7 * 86_400_000;
// Float slack so 3 / 1.5 is 2 weeks, not 3 — rounding up must not punish the ULP.
const EPS = 1e-9;

export function accrualHorizon(i: {
  have: number;
  need: number;
  /** Observations accrued per week recently; null/0/negative means no pace. */
  perWeek: number | null | undefined;
  /** The pack's sliding window in days, or null for all time. */
  windowDays: number | null | undefined;
  nowMs: number;
  /** False for a figure that does not grow with time. Default true. */
  accrues?: boolean;
}): AccrualHorizon {
  const more = Math.max(0, Math.ceil(i.need - Math.max(0, i.have)));
  if (more === 0) return { more: 0, etaWeeks: 0, etaDate: i.nowMs, reason: null };
  if (i.accrues === false) return { more, etaWeeks: null, etaDate: null, reason: "not-accruing" };
  const pace = i.perWeek;
  if (pace == null || !Number.isFinite(pace) || pace <= 0) return { more, etaWeeks: null, etaDate: null, reason: "no-pace" };
  // A sliding window holds at most pace x (window in weeks) in steady state. Below the
  // floor, the count never gets there however long the reader waits.
  if (i.windowDays != null && (i.windowDays / 7) * pace + EPS < i.need) {
    return { more, etaWeeks: null, etaDate: null, reason: "window-too-narrow" };
  }
  const etaWeeks = Math.max(1, Math.ceil(more / pace - EPS));
  return { more, etaWeeks, etaDate: i.nowMs + etaWeeks * WEEK_MS, reason: null };
}
