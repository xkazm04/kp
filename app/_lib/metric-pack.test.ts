import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetricPack, buildMetricPackStrings, renderMetricPack, paceFromMomentum, MIN_SAMPLE, MIN_OPEN_ROLES } from "./metric-pack.ts";
import type { MetricPackInput } from "./metric-pack.ts";
import { namespaceTranslator } from "./catalog-translator.ts";

const AT = "2026-07-30T10:00:00.000Z";

// F15 — the pack takes its copy as a parameter, so the tests feed it the REAL
// catalog (the same call the route makes). That pins every `analytics.metricPack.*`
// key: a missing message fails here rather than printing a raw key path onto a
// document a buyer reads.
const EN = buildMetricPackStrings(await namespaceTranslator("en", "analytics.metricPack"));
const CS = buildMetricPackStrings(await namespaceTranslator("cs", "analytics.metricPack"), "cs");

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

test("a windowed pack's capacity basis is point-in-time and does not claim the window", () => {
  const pack = buildMetricPack(input({ windowDays: 90 }), AT, EN);
  const basis = byKey(pack, "recruiter_capacity").basis;
  assert.match(basis, /now|point-in-time|current/i);
  assert.doesNotMatch(basis, /over the last 90 days/i);
  assert.match(basis, /not last 90 days/i);
});

test("an all-time pack's capacity basis does not pretend to be windowed", () => {
  const pack = buildMetricPack(input({ windowDays: null }), AT, EN);
  const basis = byKey(pack, "recruiter_capacity").basis;
  assert.doesNotMatch(basis, /last \d+ days/i);
  assert.match(basis, /open roles/i);
});

test("a windowed pack whose only measured row is the capacity snapshot is not certifiable", () => {
  const pack = buildMetricPack(
    input({
      hired: 0,
      medianTimeToHireDays: null,
      avgTimeToHireDays: null,
      costPerHireCzk: null,
      automationRoi: null,
      windowDays: 90,
    }),
    AT,
    EN
  );
  assert.equal(byKey(pack, "recruiter_capacity").status, "measured");
  assert.equal(pack.certifiable, false);
});

// ---------------------------------------------------------------------------
// The accrual horizon (registry state-the-accrual-horizon, step 5): a thin row
// states how many more observations it needs and, at the workspace's recent
// pace, roughly when — or the reason there is no date. The same `need` object
// feeds the JSON row and the Markdown caveat, so the file and the screen agree.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const NOW_MS = Date.parse(AT);

test("a thin time_to_hire row carries its shortfall and a paced date; a measured row carries none", () => {
  const pack = buildMetricPack(
    input({ hired: 9, timeToHireSamples: 5, capacity: { openRoles: 2, recruiters: 1 }, pace: { hiresPerWeek: 1.5 } }),
    AT,
    EN
  );
  const tth = byKey(pack, "time_to_hire");
  assert.equal(tth.need?.more, 3);
  assert.equal(tth.need?.unit, "hires");
  assert.equal(tth.need?.floor, MIN_SAMPLE);
  assert.equal(tth.need?.etaWeeks, 2);
  assert.equal(tth.need?.etaDate, NOW_MS + 14 * DAY_MS);
  assert.equal(tth.need?.reason, null);

  assert.equal(byKey(pack, "cost_per_hire").need, null, "a measured row carries need: null");

  const cap = byKey(pack, "recruiter_capacity");
  assert.equal(cap.status, "thin");
  assert.equal(cap.need?.more, 1);
  assert.equal(cap.need?.unit, "roles");
  assert.equal(cap.need?.etaWeeks, null);
  assert.equal(cap.need?.reason, "not-accruing");
});

test("the Markdown caveat states the shortfall and the date from the same need the JSON carries", () => {
  const pack = buildMetricPack(input({ hired: 9, timeToHireSamples: 5, pace: { hiresPerWeek: 1.5 } }), AT, EN);
  const tth = byKey(pack, "time_to_hire");
  assert.ok(tth.need && tth.need.note.length > 0);
  const md = renderMetricPack(pack, EN);
  const line = md.split("\n").find((l) => l.startsWith("- ") && l.includes("Time to hire"));
  assert.ok(line, "a caveat line for the thin row");
  assert.ok(line!.includes(tth.need!.note), "the caveat carries the row's own need note verbatim");
  assert.match(line!, /3 more hires/);
  assert.match(line!, /\b8\b/, "the floor is named");
  assert.match(line!, /2 weeks/);
  assert.match(line!, /Aug 13, 2026/, "the date, at the recent pace (UTC, medium)");
});

test("no pace: the caveat states the shortfall and the no-date reason instead of a date", () => {
  const pack = buildMetricPack(input({ hired: 9, timeToHireSamples: 5, pace: { hiresPerWeek: 0 } }), AT, EN);
  const tth = byKey(pack, "time_to_hire");
  assert.equal(tth.need?.reason, "no-pace");
  assert.equal(tth.need?.etaDate, null);
  const caveat = pack.caveats.find((c) => c.includes("Time to hire"))!;
  assert.match(caveat, /3 more hires/);
  assert.doesNotMatch(caveat, /2026/);
});

test("a windowed pack too narrow to ever clear says so rather than promising a date", () => {
  const pack = buildMetricPack(input({ hired: 4, timeToHireSamples: 4, windowDays: 30, pace: { hiresPerWeek: 1 } }), AT, EN);
  assert.equal(byKey(pack, "time_to_hire").need?.reason, "window-too-narrow");
  assert.equal(byKey(pack, "cost_per_hire").need?.reason, "window-too-narrow");
});

test("the need sentence localizes (Czech plural agreement on the shortfall)", () => {
  const pack = buildMetricPack(input({ hired: 9, timeToHireSamples: 5, pace: { hiresPerWeek: 1.5 } }), AT, CS);
  const note = byKey(pack, "time_to_hire").need!.note;
  assert.doesNotMatch(note, /more hires/);
  assert.match(note, /chybí ještě 3 přijetí/);
});

test("paceFromMomentum: hires per week over the momentum series; none -> 0 and every hire need is no-pace", () => {
  const weeks = [
    { weekStart: "2026-08-03", added: 4, advanced: 2, rejected: 1, hired: 1 },
    { weekStart: "2026-08-10", added: 4, advanced: 2, rejected: 1, hired: 2 },
    { weekStart: "2026-08-17", added: 4, advanced: 2, rejected: 1, hired: 0 },
    { weekStart: "2026-08-24", added: 4, advanced: 2, rejected: 1, hired: 3 },
  ];
  assert.equal(paceFromMomentum(weeks), 1.5);
  assert.equal(paceFromMomentum([]), 0);
  const idle = weeks.map((w) => ({ ...w, hired: 0 }));
  assert.equal(paceFromMomentum(idle), 0);
  const pack = buildMetricPack(input({ hired: 2, costPerHireCzk: 1000, pace: { hiresPerWeek: paceFromMomentum(idle) } }), AT, EN);
  for (const key of ["time_to_hire", "cost_per_hire"]) assert.equal(byKey(pack, key).need?.reason, "no-pace", key);
});
