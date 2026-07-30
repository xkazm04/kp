import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetricPack, renderMetricPack, MIN_SAMPLE, MIN_OPEN_ROLES } from "./metric-pack.ts";
import type { MetricPackInput } from "./metric-pack.ts";

const AT = "2026-07-30T10:00:00.000Z";

const input = (over: Partial<MetricPackInput> = {}): MetricPackInput => ({
  hired: 12,
  medianTimeToHireDays: 21,
  avgTimeToHireDays: 33,
  costPerHireCzk: 18000,
  automationRoi: { hoursSaved: 64, hoursSavedPerHire: 5.3, pctOfManualBaseline: 12, totalActions: 210 },
  capacity: { openRoles: 18, recruiters: 3 },
  windowDays: 90,
  ...over,
});

const byKey = (p: ReturnType<typeof buildMetricPack>, k: string) => p.metrics.find((m) => m.key === k)!;

test("a healthy workspace produces a certifiable pack", () => {
  const pack = buildMetricPack(input(), AT);
  assert.equal(pack.certifiable, true);
  assert.deepEqual(pack.caveats, []);
  assert.equal(byKey(pack, "time_to_hire").value, 21);
  assert.equal(byKey(pack, "cost_per_hire").value, 18000);
  assert.equal(byKey(pack, "recruiter_hours_saved").value, 64);
  assert.equal(byKey(pack, "recruiter_capacity").value, 6); // 18 roles / 3 recruiters
});

test("time-to-hire prefers the MEDIAN and says which it used", () => {
  // One stalled req drags a mean for months; the median is what a recruiter recognises.
  const pack = buildMetricPack(input(), AT);
  assert.equal(byKey(pack, "time_to_hire").value, 21);
  assert.match(byKey(pack, "time_to_hire").basis, /Median/);

  const noMedian = buildMetricPack(input({ medianTimeToHireDays: null }), AT);
  assert.equal(byKey(noMedian, "time_to_hire").value, 33);
  assert.match(byKey(noMedian, "time_to_hire").basis, /Mean/);
});

test("a thin sample yields a REAL value that is explicitly not publishable", () => {
  // The failure this whole module exists to prevent: a headline number off two hires.
  const pack = buildMetricPack(input({ hired: 2 }), AT);
  const tth = byKey(pack, "time_to_hire");
  assert.equal(tth.status, "thin");
  assert.equal(tth.value, 21, "a thin metric is still shown — suppressing it would be its own dishonesty");
  assert.equal(tth.sample, 2);
  assert.equal(pack.certifiable, false);
  assert.ok(pack.caveats.some((c) => c.includes("time_to_hire") && c.includes("2 observation")));
});

test("missing data is NOT MEASURABLE and never fabricates a zero", () => {
  const pack = buildMetricPack(input({ costPerHireCzk: null, automationRoi: null, capacity: null }), AT);
  for (const key of ["cost_per_hire", "recruiter_hours_saved", "recruiter_capacity"]) {
    const m = byKey(pack, key);
    assert.equal(m.status, "not_measurable", key);
    assert.equal(m.value, null, `${key} must be null, not 0`);
  }
  assert.equal(pack.certifiable, false);
});

test("sample thresholds are the stated ones, per metric", () => {
  // Hours-saved is sampled in ACTIONS, not hires — a team accrues hundreds of automated
  // actions before its first hire closes, so hires would gate it wrongly.
  const justUnder = buildMetricPack(
    input({ automationRoi: { hoursSaved: 9, hoursSavedPerHire: null, pctOfManualBaseline: null, totalActions: MIN_SAMPLE * 5 - 1 } }),
    AT
  );
  assert.equal(byKey(justUnder, "recruiter_hours_saved").status, "thin");

  const atBar = buildMetricPack(
    input({ automationRoi: { hoursSaved: 9, hoursSavedPerHire: null, pctOfManualBaseline: null, totalActions: MIN_SAMPLE * 5 } }),
    AT
  );
  assert.equal(byKey(atBar, "recruiter_hours_saved").status, "measured");

  const quietQuarter = buildMetricPack(input({ capacity: { openRoles: MIN_OPEN_ROLES - 1, recruiters: 1 } }), AT);
  assert.equal(byKey(quietQuarter, "recruiter_capacity").status, "thin");
});

test("capacity with no recruiters is not measurable rather than a divide-by-zero", () => {
  const pack = buildMetricPack(input({ capacity: { openRoles: 10, recruiters: 0 } }), AT);
  assert.equal(byKey(pack, "recruiter_capacity").status, "not_measurable");
  assert.equal(byKey(pack, "recruiter_capacity").value, null);
});

test("every metric states a basis — an unstatable metric cannot be defended", () => {
  const pack = buildMetricPack(input({ costPerHireCzk: null, automationRoi: null, capacity: null }), AT);
  for (const m of pack.metrics) assert.ok(m.basis.length > 10, `${m.key} has no basis`);
});

test("the rendered page carries status and basis, not bare numbers", () => {
  const md = renderMetricPack(buildMetricPack(input({ hired: 2 }), AT));
  assert.match(md, /THIN SAMPLE/);
  assert.match(md, /Not publication-ready/);
  assert.match(md, /Median days from first contact/);
  // The anti-vendor-metric disclaimer must survive into the shareable artifact.
  assert.match(md, /does not compute an improvement percentage against a pre-kp baseline/);
});

test("a certifiable pack renders without the warning block", () => {
  const md = renderMetricPack(buildMetricPack(input(), AT));
  assert.doesNotMatch(md, /Not publication-ready/);
  assert.match(md, /Every metric above is measured/);
  assert.match(md, /all time|last 90 days/);
});

test("candidate NPS joins the pack only once a response exists", () => {
  // A "candidate experience" row on a workspace that has never asked is noise, not a gap
  // — so absence means no row, rather than a not_measurable one.
  const none = buildMetricPack(input({ candidateNps: { score: null, responses: 0 } }), AT);
  assert.equal(none.metrics.some((m) => m.key === "candidate_nps"), false);

  // A real score off four responses: the pack SHOWS it and labels it thin, rather than
  // hiding it. Callers pass candidate-nps's rawScore precisely so this stays possible.
  const thin = buildMetricPack(input({ candidateNps: { score: -25, responses: 4 } }), AT);
  assert.equal(byKey(thin, "candidate_nps").status, "thin");
  assert.equal(byKey(thin, "candidate_nps").value, -25);
  assert.equal(thin.certifiable, false);

  const solid = buildMetricPack(input({ candidateNps: { score: 42, responses: 30 } }), AT);
  assert.equal(byKey(solid, "candidate_nps").value, 42);
  assert.equal(byKey(solid, "candidate_nps").status, "measured");
  assert.equal(solid.certifiable, true);
});
