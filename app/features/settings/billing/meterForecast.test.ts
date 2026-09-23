// Pace verdicts for a usage meter, and the plan card's two dates (challenge-r05
// billing-plan-and-spend/B). Pure: node:test cannot load the .tsx that renders them.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mod from "./meterForecast.ts";

type Forecast = { kind: string; runsOutAt?: string; daysBeforeReset?: number };
type Meter = { meter: string; limit: number | null; used: number; credits: number; remaining?: number | null };
type Win = { start: string; resetsAt: string; asOf: string };
const api = mod as unknown as {
  meterForecast: (meter: Meter, window: Win) => Forecast;
  planDatesView: (input: { paidPeriodEnd: string | null; resetsAt: string | null }) => { diverge: boolean };
};

// September 2026 has 30 days: "day N of 30" = N whole days elapsed since the 1st.
const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 1);
function dayOf30(n: number): Win {
  return {
    start: new Date(START).toISOString(),
    resetsAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
    asOf: new Date(START + n * DAY).toISOString(),
  };
}

test("pace: 180 of 300 by day 12 runs out around day 20, before the reset", () => {
  const f = api.meterForecast({ meter: "ai_candidates", limit: 300, used: 180, credits: 0 }, dayOf30(12));
  assert.equal(f.kind, "runsOutBeforeReset");
  assert.ok(f.runsOutAt, "a run-out verdict carries its date");
  const day = (Date.parse(f.runsOutAt) - START) / DAY;
  assert.ok(day >= 19.5 && day <= 20.5, `runs out on ~day 20, got day ${day}`);
  assert.ok(Date.parse(f.runsOutAt) < Date.UTC(2026, 9, 1));
  assert.equal(f.daysBeforeReset, 10, "day 20 of a 30-day window is 10 days before reset");
});

test("on pace: 2 of 10 by day 25 projects 2.4 and claims no date", () => {
  const f = api.meterForecast({ meter: "job_posts", limit: 10, used: 2, credits: 0 }, dayOf30(25));
  assert.deepEqual(f, { kind: "onPace" });
});

test("small-sample honesty: under 3 days elapsed, or under 2 units used, is too early", () => {
  // 2.5 days in, burning fast: still no date from so little calendar.
  const early = { ...dayOf30(0), asOf: new Date(START + 2.5 * DAY).toISOString() };
  assert.deepEqual(api.meterForecast({ meter: "ai_candidates", limit: 25, used: 20, credits: 0 }, early), { kind: "tooEarly" });
  // One data point, however late: never a projected date from it.
  assert.deepEqual(api.meterForecast({ meter: "job_posts", limit: 2, used: 1, credits: 0 }, dayOf30(4)), { kind: "tooEarly" });
  assert.deepEqual(api.meterForecast({ meter: "case_designs", limit: 5, used: 0, credits: 0 }, dayOf30(20)), { kind: "tooEarly" });
});

test("credits extend capacity; null is unlimited; a spent minutes meter is depleted", () => {
  // 10 used by day 10 projects 30: against the 10 included it would run out, against
  // 10 included + 20 pack credits it lands exactly on capacity.
  assert.deepEqual(api.meterForecast({ meter: "interview_minutes", limit: 10, used: 10, credits: 20 }, dayOf30(10)), { kind: "onPace" });
  const tight = api.meterForecast({ meter: "interview_minutes", limit: 10, used: 10, credits: 19 }, dayOf30(10));
  assert.equal(tight.kind, "runsOutBeforeReset", "one credit short of the projection runs out");
  assert.deepEqual(api.meterForecast({ meter: "ai_candidates", limit: null, used: 900, credits: 0 }, dayOf30(10)), { kind: "unlimited" });
  assert.deepEqual(
    api.meterForecast({ meter: "interview_minutes", limit: 30, used: 30, credits: 0, remaining: 0 }, dayOf30(10)),
    { kind: "depleted" }
  );
  // Depleted is a fact, not a forecast: it wins over the small-sample floor.
  assert.deepEqual(api.meterForecast({ meter: "interview_minutes", limit: 0, used: 0, credits: 0, remaining: 0 }, dayOf30(1)), { kind: "depleted" });
});

test("hires never block: past the allowance is projected overage, never 'runs out'", () => {
  assert.deepEqual(api.meterForecast({ meter: "hires", limit: 2, used: 2, credits: 0 }, dayOf30(10)), { kind: "overageProjected" });
  // Already over (remaining 0) is still overage, not depleted — a candidate accepting
  // an offer is never refused for quota (plans.ts).
  assert.deepEqual(api.meterForecast({ meter: "hires", limit: 1, used: 3, credits: 0, remaining: 0 }, dayOf30(1)), { kind: "overageProjected" });
  assert.deepEqual(api.meterForecast({ meter: "hires", limit: 10, used: 2, credits: 0 }, dayOf30(20)), { kind: "onPace" });
  for (const n of [3, 10, 29]) {
    for (const used of [2, 5, 50]) {
      const k = api.meterForecast({ meter: "hires", limit: 2, used, credits: 0, remaining: Math.max(0, 2 - used) }, dayOf30(n)).kind;
      assert.ok(k !== "runsOutBeforeReset" && k !== "depleted", `hires said ${k}`);
    }
  }
});

test("two dates, honestly: the plan card names both only when they differ", () => {
  assert.deepEqual(api.planDatesView({ paidPeriodEnd: "2026-10-14T00:00:00Z", resetsAt: "2026-10-01T00:00:00Z" }), { diverge: true });
  assert.deepEqual(api.planDatesView({ paidPeriodEnd: "2026-10-01T00:00:00Z", resetsAt: "2026-10-01T00:00:00.000Z" }), { diverge: false });
  // No paid period (free / no subscription): nothing to contrast with.
  assert.deepEqual(api.planDatesView({ paidPeriodEnd: null, resetsAt: "2026-10-01T00:00:00Z" }), { diverge: false });
  // An older server without the window: one line, as before.
  assert.deepEqual(api.planDatesView({ paidPeriodEnd: "2026-10-14T00:00:00Z", resetsAt: null }), { diverge: false });
});
