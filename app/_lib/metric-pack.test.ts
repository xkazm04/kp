import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetricPack, buildMetricPackStrings, renderMetricPack, MIN_SAMPLE, MIN_OPEN_ROLES } from "./metric-pack.ts";
import type { MetricPackInput } from "./metric-pack.ts";
import { namespaceTranslator } from "./catalog-translator.ts";

const AT = "2026-07-30T10:00:00.000Z";

// F15 — the pack takes its copy as a parameter, so the tests feed it the REAL
// catalog (the same call the route makes). That pins every `analytics.metricPack.*`
// key: a missing message fails here rather than printing a raw key path onto a
// document a buyer reads.
const EN = buildMetricPackStrings(await namespaceTranslator("en", "analytics.metricPack"));
const CS = buildMetricPackStrings(await namespaceTranslator("cs", "analytics.metricPack"));

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
  const pack = buildMetricPack(input(), AT, EN);
  assert.equal(pack.certifiable, true);
  assert.deepEqual(pack.caveats, []);
  assert.equal(byKey(pack, "time_to_hire").value, 21);
  assert.equal(byKey(pack, "cost_per_hire").value, 18000);
  assert.equal(byKey(pack, "recruiter_hours_saved").value, 64);
  assert.equal(byKey(pack, "recruiter_capacity").value, 6); // 18 roles / 3 recruiters
});

test("time-to-hire prefers the MEDIAN and says which it used", () => {
  // One stalled req drags a mean for months; the median is what a recruiter recognises.
  const pack = buildMetricPack(input(), AT, EN);
  assert.equal(byKey(pack, "time_to_hire").value, 21);
  assert.match(byKey(pack, "time_to_hire").basis, /Median/);

  const noMedian = buildMetricPack(input({ medianTimeToHireDays: null }), AT, EN);
  assert.equal(byKey(noMedian, "time_to_hire").value, 33);
  assert.match(byKey(noMedian, "time_to_hire").basis, /Mean/);
});

test("a thin sample yields a REAL value that is explicitly not publishable", () => {
  // The failure this whole module exists to prevent: a headline number off two hires.
  const pack = buildMetricPack(input({ hired: 2 }), AT, EN);
  const tth = byKey(pack, "time_to_hire");
  assert.equal(tth.status, "thin");
  assert.equal(tth.value, 21, "a thin metric is still shown — suppressing it would be its own dishonesty");
  assert.equal(tth.sample, 2);
  assert.equal(pack.certifiable, false);
  assert.ok(pack.caveats.some((c) => c.includes("Time to hire") && c.includes("2 observation")));
});

test("missing data is NOT MEASURABLE and never fabricates a zero", () => {
  const pack = buildMetricPack(input({ costPerHireCzk: null, automationRoi: null, capacity: null }), AT, EN);
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
  const justUnder = buildMetricPack(input({ automationRoi: { hoursSaved: 9, hoursSavedPerHire: null, pctOfManualBaseline: null, totalActions: MIN_SAMPLE * 5 - 1 } }), AT, EN);
  assert.equal(byKey(justUnder, "recruiter_hours_saved").status, "thin");

  const atBar = buildMetricPack(input({ automationRoi: { hoursSaved: 9, hoursSavedPerHire: null, pctOfManualBaseline: null, totalActions: MIN_SAMPLE * 5 } }), AT, EN);
  assert.equal(byKey(atBar, "recruiter_hours_saved").status, "measured");

  const quietQuarter = buildMetricPack(input({ capacity: { openRoles: MIN_OPEN_ROLES - 1, recruiters: 1 } }), AT, EN);
  assert.equal(byKey(quietQuarter, "recruiter_capacity").status, "thin");
});

test("capacity with no recruiters is not measurable rather than a divide-by-zero", () => {
  const pack = buildMetricPack(input({ capacity: { openRoles: 10, recruiters: 0 } }), AT, EN);
  assert.equal(byKey(pack, "recruiter_capacity").status, "not_measurable");
  assert.equal(byKey(pack, "recruiter_capacity").value, null);
});

test("every metric states a basis — an unstatable metric cannot be defended", () => {
  const pack = buildMetricPack(input({ costPerHireCzk: null, automationRoi: null, capacity: null }), AT, EN);
  for (const m of pack.metrics) assert.ok(m.basis.length > 10, `${m.key} has no basis`);
});

test("the rendered page carries status and basis, not bare numbers", () => {
  const md = renderMetricPack(buildMetricPack(input({ hired: 2 }), AT, EN), EN);
  assert.match(md, /THIN SAMPLE/);
  assert.match(md, /Not publication-ready/);
  assert.match(md, /Median days from first contact/);
  // The anti-vendor-metric disclaimer must survive into the shareable artifact.
  // Brand-agnostic on purpose: the claim under test is that the pack refuses to
  // manufacture a "% better than before" number, not what the product is called.
  // Pinning the literal name made a product rename in the catalogue fail a test
  // about metric honesty, which tells the next reader nothing true.
  assert.match(md, /does not compute an improvement percentage against a pre-\w+ baseline/);
});

test("a certifiable pack renders without the warning block", () => {
  const md = renderMetricPack(buildMetricPack(input(), AT, EN), EN);
  assert.doesNotMatch(md, /Not publication-ready/);
  assert.match(md, /Every metric above is measured/);
  assert.match(md, /all time|last 90 days/);
});

test("candidate NPS joins the pack only once a response exists", () => {
  // A "candidate experience" row on a workspace that has never asked is noise, not a gap
  // — so absence means no row, rather than a not_measurable one.
  const none = buildMetricPack(input({ candidateNps: { score: null, responses: 0 } }), AT, EN);
  assert.equal(none.metrics.some((m) => m.key === "candidate_nps"), false);

  // A real score off four responses: the pack SHOWS it and labels it thin, rather than
  // hiding it. Callers pass candidate-nps's rawScore precisely so this stays possible.
  const thin = buildMetricPack(input({ candidateNps: { score: -25, responses: 4 } }), AT, EN);
  assert.equal(byKey(thin, "candidate_nps").status, "thin");
  assert.equal(byKey(thin, "candidate_nps").value, -25);
  assert.equal(thin.certifiable, false);

  const solid = buildMetricPack(input({ candidateNps: { score: 42, responses: 30 } }), AT, EN);
  assert.equal(byKey(solid, "candidate_nps").value, 42);
  assert.equal(byKey(solid, "candidate_nps").status, "measured");
  assert.equal(solid.certifiable, true);
});

test("F15 — the whole document localizes, scaffolding AND basis prose", () => {
  // The failure this guards: headings from the catalog over English basis sentences.
  // `basis` travels INSIDE the pack, so it has to be resolved at build time or the
  // artifact ships half-translated.
  const cs = renderMetricPack(buildMetricPack(input({ hired: 2 }), AT, CS), CS);
  assert.doesNotMatch(cs, /Median days from first contact/);
  assert.doesNotMatch(cs, /THIN SAMPLE/);
  assert.doesNotMatch(cs, /Not publication-ready/);
  // Czech needs one/few/other agreement on every count the basis sentences carry.
  assert.match(cs, /2 přijetí/);
});

// ---------------------------------------------------------------------------
// The time-to-hire sample is the population the STATISTIC was measured over.
// db/analytics.ts computes the median/mean only over terminal rows that ALSO
// carry both timestamps and a non-negative duration, so it is narrower than
// `hired`. Sampling with `hired` published a certifiable pack off a thin sample —
// on the shipped corpus 9 hires, 5 measurable, MIN_SAMPLE 8: 9 clears the floor
// and 5 does not, so the pack's own headline broke its own contract.
// ---------------------------------------------------------------------------

test("time_to_hire is sampled over the measured population, not the hire count", () => {
  const pack = buildMetricPack(input({ hired: 9, timeToHireSamples: 5 }), AT, EN);
  const tth = byKey(pack, "time_to_hire");
  assert.equal(tth.sample, 5, "the sample is the measurable set, not `hired`");
  assert.equal(tth.status, "thin", `${MIN_SAMPLE} is the floor; 5 may not read as measured`);
  assert.equal(tth.value, 21, "the VALUE is unchanged — only the claim about it is");
  assert.match(tth.basis, /over 5 hires/, "the basis names the measured N, not the bigger one");
  assert.equal(pack.certifiable, false, "a pack resting on a thin sample is not publishable");
  assert.ok(
    pack.caveats.some((c) => c.includes("5 observations")),
    "the thin caveat names the real sample, not the hire count"
  );
});

test("an absent timeToHireSamples falls back to `hired` (existing callers unchanged)", () => {
  const withField = byKey(buildMetricPack(input({ hired: 9, timeToHireSamples: 9 }), AT, EN), "time_to_hire");
  const without = byKey(buildMetricPack(input({ hired: 9 }), AT, EN), "time_to_hire");
  assert.deepEqual(without, withField);
  assert.equal(without.status, "measured", `9 still clears MIN_SAMPLE ${MIN_SAMPLE}`);
});
