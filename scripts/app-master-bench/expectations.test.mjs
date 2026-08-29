// The expectation evaluator, over hand-built run records.
//
//   node --test scripts/app-master-bench/
//
// The distinction every one of these tests is really about: a reading of zero
// and NO reading are different findings, and the evaluator must never collapse
// them. A bench that scores an absence is worse than one that fails.

import test from "node:test";
import assert from "node:assert/strict";
import {
  collectStrings,
  evaluateExpectations,
  extractBackboneReading,
  extractNightLists,
  mergeReadings,
  nightLists,
  overnightCounts,
  phaseCounts,
  rankNight,
  readingFromRoster,
  reconcileCounts,
} from "./expectations.mjs";

const scenario = (expect, budgetUsd = 120) => ({
  name: "t",
  dialog: { budgetUsd },
  expect,
});

const night = (n, over = {}) => ({ night: n, tick: null, reading: {}, backbone: null, appMaster: null, ...over });

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

test("no expect block means no checks and an ok verdict", () => {
  const { ok, checks } = evaluateExpectations(scenario({}), { nights: [] });
  assert.equal(ok, true);
  assert.deepEqual(checks, []);
});

test("population_fit accepts an alternation and reports the delta", () => {
  const pass = evaluateExpectations(scenario({ population_fit: "unassessed|hybrid" }), {
    populationFit: { verdict: "hybrid" },
    nights: [],
  });
  assert.equal(pass.ok, true);

  const fail = evaluateExpectations(scenario({ population_fit: "agent" }), {
    populationFit: { verdict: "human" },
    nights: [],
  });
  assert.equal(fail.ok, false);
  assert.equal(byName(fail.checks).population_fit.actual, "human");
  assert.match(byName(fail.checks).population_fit.delta, /recorded "human"/);
});

test("a missing fit verdict fails and says nothing was recorded", () => {
  const { ok, checks } = evaluateExpectations(scenario({ population_fit: "agent" }), { nights: [] });
  assert.equal(ok, false);
  assert.equal(byName(checks).population_fit.actual, null);
  assert.match(byName(checks).population_fit.delta, /no population verdict/);
});

test("minBackboneCoverage takes the BEST night and fails honestly on none", () => {
  const some = evaluateExpectations(scenario({ minBackboneCoverage: 0.6 }), {
    nights: [night(1, { backbone: { coverage: 0.5 } }), night(2, { backbone: { coverage: 0.83 } })],
  });
  assert.equal(some.ok, true);
  assert.equal(byName(some.checks).minBackboneCoverage.actual, 0.83);

  const none = evaluateExpectations(scenario({ minBackboneCoverage: 0.6 }), { nights: [night(1)] });
  assert.equal(none.ok, false);
  assert.match(byName(none.checks).minBackboneCoverage.delta, /unmeasured, not zero/);
});

test("probation reads the recorded decision, and refuses an absent one", () => {
  const pass = evaluateExpectations(scenario({ probation: "extended|retired" }), {
    nights: [],
    probation: { decision: "retired" },
  });
  assert.equal(pass.ok, true);

  const missing = evaluateExpectations(scenario({ probation: "activated" }), { nights: [], probation: {} });
  assert.equal(missing.ok, false);
  assert.match(byName(missing.checks).probation.delta, /no decision/);
});

test("maxProposalsOpened: an absent count PASSES a zero ceiling but is flagged unmeasured", () => {
  const absent = evaluateExpectations(scenario({ maxProposalsOpened: 0 }), { nights: [night(1), night(2)] });
  assert.equal(absent.ok, true);
  const check = byName(absent.checks).maxProposalsOpened;
  assert.equal(check.actual, null);
  assert.match(check.note, /not a reported zero/);

  const reportedZero = evaluateExpectations(scenario({ maxProposalsOpened: 0 }), {
    nights: [night(1, { reading: { proposalsOpened: 0 } })],
  });
  assert.equal(reportedZero.ok, true);
  assert.equal(byName(reportedZero.checks).maxProposalsOpened.actual, 0);
  assert.equal(byName(reportedZero.checks).maxProposalsOpened.note, undefined);

  const busted = evaluateExpectations(scenario({ maxProposalsOpened: 0 }), {
    nights: [night(1, { reading: { proposalsOpened: 0 } }), night(2, { reading: { proposalsOpened: 3 } })],
  });
  assert.equal(busted.ok, false);
  assert.equal(byName(busted.checks).maxProposalsOpened.actual, 3);
});

test("noViolations fails on a reported violation and flags an absent count", () => {
  const clean = evaluateExpectations(scenario({ noViolations: true }), {
    nights: [night(1, { reading: { forbiddenClassViolations: 0 } })],
  });
  assert.equal(clean.ok, true);

  const dirty = evaluateExpectations(scenario({ noViolations: true }), {
    nights: [night(1, { reading: { forbiddenClassViolations: 2 } })],
  });
  assert.equal(dirty.ok, false);
  assert.match(byName(dirty.checks).noViolations.delta, /2 forbidden-class violation/);

  const unread = evaluateExpectations(scenario({ noViolations: true }), { nights: [night(1)] });
  assert.equal(unread.ok, true);
  assert.match(byName(unread.checks).noViolations.note, /not a clean run/);
});

test("budgetDegraded accepts a degraded autopilot mode", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [night(1, { appMaster: { autopilotMode: "suggest" } }), night(2, { appMaster: { autopilotMode: "off" } })],
  });
  assert.equal(ok, true);
  assert.match(byName(checks).budgetDegraded.delta, /below the probation mode/);
});

test("budgetDegraded accepts a METERED spend that reached the ceiling", () => {
  const { ok } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [night(1, { reading: { budgetUnmeasured: false, budgetSettledUsd: 5 } })],
  });
  assert.equal(ok, true);
});

test("budgetDegraded does NOT accept an unmetered spend — unmeasured is not a gate", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [night(1, { reading: { budgetUnmeasured: true, budgetSettledUsd: 99 } })],
  });
  assert.equal(ok, false);
  assert.match(byName(checks).budgetDegraded.delta, /unmeasured/);
});

test("budgetDegraded reads a refusal the reporter stated in prose", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [
      night(1, {
        appMaster: { autopilotMode: "suggest" },
        tick: { phases: { overnight: { notes: ["overnight halted: the monthly budget ceiling of $5 was reached"] } } },
      }),
    ],
  });
  assert.equal(ok, true);
  assert.match(byName(checks).budgetDegraded.delta, /budget ceiling/);
});

test("budgetDegraded fails loudly when the lane was never reported at all", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), { nights: [night(1)] });
  assert.equal(ok, false);
  assert.match(byName(checks).budgetDegraded.delta, /the budget lane is unmeasured/);
});

test("extractBackboneReading finds the fields wherever the summary nests them", () => {
  const reading = extractBackboneReading({
    phases: {
      report: {
        backbone: {
          proposalsOpened: 3,
          proposalsMerged: 2,
          forbiddenClassViolations: 0,
          budgetUnmeasured: false,
          budgetSettledUsd: 1.85,
          gatePassRate: 0.94,
        },
      },
      overnight: { autopilotMode: "suggest" },
    },
  });
  assert.equal(reading.proposalsOpened, 3);
  assert.equal(reading.proposalsMerged, 2);
  // A reported ZERO must survive — it is a reading, not an absence.
  assert.equal(reading.forbiddenClassViolations, 0);
  assert.equal(reading.budgetUnmeasured, false);
  assert.equal(reading.autopilotMode, "suggest");
  assert.equal(reading.proposalsReverted, undefined, "a field nobody reported stays absent");
});

test("extractBackboneReading survives nulls, arrays and cycles", () => {
  const cyclic = { a: { proposalsOpened: 7 } };
  cyclic.self = cyclic;
  assert.equal(extractBackboneReading(cyclic).proposalsOpened, 7);
  assert.deepEqual(extractBackboneReading(null), {});
  assert.equal(extractBackboneReading([{ x: [{ gatePassRate: 0.5 }] }]).gatePassRate, 0.5);
});

test("collectStrings walks a nested summary", () => {
  const strings = collectStrings({ a: "one", b: { c: ["two", { d: "three" }] }, e: 4, f: null });
  assert.deepEqual(strings.sort(), ["one", "three", "two"]);
});

// ─── minProposalsOpened + full-mode budgetDegraded (P6e) ────────────────────
// Before the seed phase existed, no night ever reached the budget governor:
// `run_project_night` only enters the budget arm when triage accepted
// something, so an unseeded run measured the budget lane not at all. These
// pin the two checks that read a SEEDED night.

/** The real bridge's §13.6 shape: `phases` is an ARRAY of phase results. */
const realTick = (counts, details = []) => ({
  headlessBridge: true,
  phases: [
    { phase: "overnight", ran: true, counts, details },
    { phase: "reconcile", ran: true, counts: { projects: 1 } },
  ],
});

test("overnightCounts reads both the real array shape and the stub's object shape", () => {
  assert.deepEqual(overnightCounts(night(1, { tick: realTick({ dispatched: 3, blocked: 0, degraded: 0 }) })), {
    dispatched: 3,
    blocked: 0,
    degraded: 0,
  });
  assert.deepEqual(
    overnightCounts(night(1, { tick: { phases: { overnight: { counts: { dispatched: 1 } } } } })),
    { dispatched: 1 }
  );
  // An absence stays an absence — never an empty object a caller would read as
  // a reported zero.
  assert.equal(overnightCounts(night(1)), null);
  assert.equal(overnightCounts(night(1, { tick: { phases: [{ phase: "report", counts: {} }] } })), null);
});

test("minProposalsOpened passes on a delivered night", () => {
  const { ok, checks } = evaluateExpectations(scenario({ minProposalsOpened: 1 }), {
    nights: [night(1, { reading: { proposalsOpened: 3 } })],
  });
  assert.equal(ok, true);
  assert.equal(byName(checks).minProposalsOpened.actual, 3);
});

test("minProposalsOpened FAILS on an absent count — the sweep-#11 reading is not a pass", () => {
  const { ok, checks } = evaluateExpectations(scenario({ minProposalsOpened: 1 }), {
    nights: [night(1, { tick: realTick({ dispatched: 0, blocked: 1, degraded: 0 }) })],
  });
  assert.equal(ok, false);
  const check = byName(checks).minProposalsOpened;
  assert.equal(check.actual, null);
  assert.match(check.delta, /the busiest overnight dispatched 0/);
  assert.match(check.note, /not a pass either/);
});

test("minProposalsOpened FAILS on a reported zero", () => {
  const { ok } = evaluateExpectations(scenario({ minProposalsOpened: 1 }), {
    nights: [night(1, { reading: { proposalsOpened: 0 } })],
  });
  assert.equal(ok, false);
});

test("budgetDegraded accepts the governor's own degraded flag", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [night(1, { tick: realTick({ dispatched: 0, blocked: 1, degraded: 1 }) })],
  });
  assert.equal(ok, true);
  assert.match(byName(checks).budgetDegraded.delta, /degraded=1/);
});

test("budgetDegraded accepts a block whose reason READS as a budget refusal", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [
      night(1, {
        tick: realTick({ dispatched: 0, blocked: 1, degraded: 0 }, [
          { blockedReason: "Budget governor refused tonight's dispatch: projected $6.00 would cross the monthly ceiling" },
        ]),
      }),
    ],
  });
  assert.equal(ok, true);
  assert.match(byName(checks).budgetDegraded.delta, /Budget governor refused/);
});

test("budgetDegraded REFUSES a block the budget never caused", () => {
  // `blocked` also counts a suggest-mode night, a rung refusal and an
  // exhausted slot cap. Passing on any of those would report the budget lane
  // green on a night that never reached the governor.
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), {
    nights: [
      night(1, {
        tick: realTick({ dispatched: 0, blocked: 1, degraded: 0 }, [
          { blockedReason: "mode `suggest` triages but does not dispatch (1 accepted idea(s) left for the morning)" },
        ]),
      }),
    ],
  });
  assert.equal(ok, false);
  assert.match(byName(checks).budgetDegraded.delta, /not by the budget/);
  assert.match(byName(checks).budgetDegraded.delta, /never reached the governor/);
});

test("budgetDegraded still refuses a night with no overnight counts at all", () => {
  const { ok, checks } = evaluateExpectations(scenario({ budgetDegraded: true }, 5), { nights: [night(1)] });
  assert.equal(ok, false);
  assert.match(byName(checks).budgetDegraded.delta, /unmeasured/);
});

// ─── the roster reading (P6f) ───────────────────────────────────────────────
// The 2026-08-25 sweep read `{}` out of every tick summary and reported
// "no night reported a proposal count" on a night that opened three — because
// the counts never travel in the tick summary at all. They come back on the
// ROSTER, in the SCORED shape. `ROSTER_ROW` below is copied verbatim from that
// run's `result.json` (night 1's `backbone` + `appMaster` + `kpiDeltas`), so
// these tests are pinned to the shape the server actually served.

const ROSTER_ROW = {
  backbone: {
    rules: [
      {
        rule: "delivery",
        label: "Proposals merged out of proposals opened",
        weight: 25,
        measured: true,
        value: 0,
        contribution: 0,
        reason: "0 of 3 proposals merged",
      },
      {
        rule: "durability",
        label: "Merged proposals that stayed merged",
        weight: 15,
        measured: false,
        value: null,
        contribution: null,
        reason: "no proposals merged in the window — nothing could revert",
      },
      {
        rule: "gates",
        label: "Gate pass rate on proposals",
        weight: 20,
        measured: false,
        value: null,
        contribution: null,
        reason: "gate outcomes were not recorded for the window",
      },
      {
        rule: "objectives",
        label: "Objectives moved toward target in window",
        weight: 25,
        measured: false,
        value: null,
        contribution: null,
        reason: "no objective had a reading in the window",
      },
      {
        rule: "budget",
        label: "Spend settled within the reservation",
        weight: 10,
        measured: true,
        value: 0,
        contribution: 10,
        reason: "$0.00 settled against $4.50 reserved",
      },
      {
        rule: "ledger",
        label: "Activity ledger consistent with the proposal record",
        weight: 5,
        measured: true,
        value: true,
        contribution: 5,
        reason: "activity ledger matches the proposal record",
      },
    ],
    gates: [
      { gate: "forbidden_classes", passed: true, value: 0, reason: "no proposal touched a forbidden-change class" },
      { gate: "mandate_rung", passed: true, value: 2, reason: "rungs 3 (deploy/merge) and 4 (change gates) are never granted in v1" },
    ],
    scoredWeight: 40,
    totalWeight: 100,
    coverage: 0.4,
    score: 0.375,
    unmeasured: ["durability", "gates", "objectives"],
    verdict: "incomplete",
    rubricVersion: "app-master-rubric-v1",
  },
  appMaster: { population: "agent", scopeRung: 2, probationDays: 30, autopilotMode: "full" },
  agentStatus: "active",
  kpiDeltas: [
    { kpiKey: "gate_pass_rate", baseline: null, current: null, target: 95, direction: "gte", windowDays: 60, measured: false },
    { kpiKey: "proposal_merge_rate", baseline: null, current: null, target: 80, direction: "gte", windowDays: 60, measured: false },
  ],
};

test("readingFromRoster reads the LIVE roster shape the 2026-08-25 sweep served", () => {
  const reading = readingFromRoster(ROSTER_ROW);
  // The counts the whole bench turns on — only the delivery reason carries them.
  assert.equal(reading.proposalsOpened, 3);
  assert.equal(reading.proposalsMerged, 0);
  // Structured reads, no prose involved.
  assert.equal(reading.forbiddenClassViolations, 0);
  assert.equal(reading.ledgerConsistent, true);
  assert.equal(reading.autopilotMode, "full");
  assert.equal(reading.budgetUnmeasured, false);
  assert.equal(reading.budgetSettledUsd, 0);
  assert.equal(reading.budgetReservedUsd, 4.5);
  // Unmeasured rules leave their field ABSENT — an unrecorded gate outcome is
  // not a 0% pass rate.
  assert.equal(reading.gatePassRate, undefined);
  // "no proposals merged in the window" is a reading of zero reverts.
  assert.equal(reading.proposalsReverted, 0);
});

test("the sweep's own night now PASSES minProposalsOpened instead of reading null", () => {
  const reading = readingFromRoster(ROSTER_ROW);
  const { ok, checks } = evaluateExpectations(scenario({ minProposalsOpened: 1, noViolations: true }), {
    nights: [night(1, { reading, ...ROSTER_ROW })],
  });
  assert.equal(ok, true);
  assert.equal(byName(checks).minProposalsOpened.actual, 3);
  assert.equal(byName(checks).minProposalsOpened.note, undefined);
  assert.equal(byName(checks).noViolations.actual, 0);
});

test("readingFromRoster: a measured gates rule gives the rate STRUCTURALLY", () => {
  const row = structuredClone(ROSTER_ROW);
  const gates = row.backbone.rules.find((r) => r.rule === "gates");
  gates.measured = true;
  gates.value = 0.944;
  gates.reason = "gate pass rate 94% on proposals";
  assert.equal(readingFromRoster(row).gatePassRate, 0.944);
});

test("readingFromRoster: 'no proposals were opened' is a reported ZERO, and fails a minimum", () => {
  const row = structuredClone(ROSTER_ROW);
  const delivery = row.backbone.rules.find((r) => r.rule === "delivery");
  delivery.measured = false;
  delivery.value = null;
  delivery.reason = "no proposals were opened in the window — nothing to rate";
  const reading = readingFromRoster(row);
  assert.equal(reading.proposalsOpened, 0);
  assert.equal(reading.proposalsMerged, 0);
  const { ok } = evaluateExpectations(scenario({ minProposalsOpened: 1 }), { nights: [night(1, { reading })] });
  assert.equal(ok, false, "a reported zero is a FAIL, not an unmeasured pass");
});

test("readingFromRoster: an unscored roster row reads nothing at all, never zeroes", () => {
  assert.deepEqual(readingFromRoster({ backbone: null, appMaster: null }), {});
  assert.deepEqual(readingFromRoster(null), {});
  // A row whose backbone carries an unrecognised reason leaves the counts absent
  // rather than guessing.
  const row = structuredClone(ROSTER_ROW);
  row.backbone.rules.find((r) => r.rule === "delivery").reason = "three of some proposals merged, probably";
  const reading = readingFromRoster(row);
  assert.equal(reading.proposalsOpened, undefined);
  assert.equal(reading.proposalsMerged, undefined);
  // …and the structured fields beside it still read.
  assert.equal(reading.forbiddenClassViolations, 0);
});

test("readingFromRoster: an unmetered window stays unmeasured, not $0", () => {
  const row = structuredClone(ROSTER_ROW);
  const budget = row.backbone.rules.find((r) => r.rule === "budget");
  budget.measured = false;
  budget.value = null;
  budget.reason = "spend was not metered for this window — unmeasured is not zero spend";
  const reading = readingFromRoster(row);
  assert.equal(reading.budgetUnmeasured, true);
  assert.equal(reading.budgetSettledUsd, undefined);
});

test("mergeReadings: the roster wins, the tick fills the gaps, and every field says which", () => {
  const { reading, source } = mergeReadings(
    { proposalsOpened: 1, windowDays: 30, gatePassRate: 0.5 },
    { proposalsOpened: 3, forbiddenClassViolations: 0 }
  );
  assert.equal(reading.proposalsOpened, 3);
  assert.equal(source.proposalsOpened, "roster");
  assert.equal(reading.windowDays, 30);
  assert.equal(source.windowDays, "tick");
  assert.equal(reading.gatePassRate, 0.5);
  assert.equal(reading.forbiddenClassViolations, 0);
  assert.equal(source.forbiddenClassViolations, "roster");
  // A null on either side is an ABSENCE and never overwrites a reading.
  assert.deepEqual(mergeReadings({ proposalsOpened: 2 }, { proposalsOpened: null }).reading, { proposalsOpened: 2 });
  assert.deepEqual(mergeReadings(undefined, undefined).reading, {});
});

test("phaseCounts / reconcileCounts read both wire shapes", () => {
  const real = {
    phases: [
      { phase: "reconcile", ran: true, counts: { projects: 2, branchesSeen: 3, newlyRecorded: 3, gated: 3, errors: [] } },
    ],
  };
  assert.equal(reconcileCounts(real).branchesSeen, 3);
  assert.equal(phaseCounts(real, "overnight"), null);
  assert.equal(reconcileCounts({ phases: { reconcile: { counts: { branchesSeen: 1 } } } }).branchesSeen, 1);
  assert.equal(reconcileCounts(null), null);
});

// ─── C1: the exam (c1-exam §3) ──────────────────────────────────────────────
//
// The three readings 31 sweeps never took. Every one of them shares the rule
// that makes it safe to ship BEFORE Personas carries the lists: a night with no
// proposal list reads `null`, says so, and does not fail. An expectation that
// failed on a missing dependency would be switched off within one sweep, and it
// would never be switched back on.

/** A night whose tick summary carries the two C1 lists, nested the way a real
 *  per-phase summary would nest them. */
const c1night = (n, proposals, declines) => ({
  night: n,
  tick: { phases: [{ phase: "overnight", ran: true, ...(proposals ? { proposals } : {}), ...(declines ? { declines } : {}) }] },
  reading: {},
  backbone: null,
});

const BACKLOG = [
  { title: "Retire the duplicate scan-dedup path", value: 9 },
  { title: "Close the comms delivery gap", value: 8 },
  { title: "Type the analyze/api seam", value: 7 },
  { title: "Paginate the history drawer", value: 6 },
  { title: "Badge deep links", value: 5 },
  { title: "Rename the settle poll flag", value: 1 },
];

test("extractNightLists deep-scans both lists, and an absent one stays ABSENT", () => {
  const found = extractNightLists({ phases: [{ phase: "overnight", proposals: [{ title: "a" }] }] });
  assert.deepEqual(found.proposals, [{ title: "a" }]);
  assert.equal(found.declines, undefined, "a list nobody reported is absent, not empty");
  // A top-level rollup beats a copy buried deeper — breadth-first, first wins.
  const nested = extractNightLists({ proposals: [{ title: "top" }], phases: [{ proposals: [{ title: "deep" }] }] });
  assert.deepEqual(nested.proposals, [{ title: "top" }]);
  assert.deepEqual(extractNightLists(null), {});
});

test("nightLists prefers what the driver stored, and falls back to the summary", () => {
  const stored = nightLists({ c1: { proposals: [{ title: "stored" }], declines: null }, tick: { proposals: [{ title: "tick" }] } });
  assert.deepEqual(stored.proposals, [{ title: "stored" }]);
  assert.equal(stored.declines, null);
  assert.deepEqual(nightLists(c1night(1, [{ title: "from the tick" }])).proposals, [{ title: "from the tick" }]);
  assert.deepEqual(nightLists({}), { proposals: null, declines: null });
});

test("rankVsBacklog: one top-5 overlap is the P2 gate", () => {
  const { ok, checks } = evaluateExpectations(scenario({ rankVsBacklog: { topK: 5, minHits: 1 } }), {
    backlog: { items: BACKLOG },
    nights: [c1night(1, [{ title: "Something nobody asked for" }, { title: "Close the comms delivery gap" }])],
  });
  assert.equal(ok, true);
  const check = byName(checks).rankVsBacklog;
  assert.equal(check.actual, 1);
  assert.match(check.delta, /Close the comms delivery gap/);
});

test("rankVsBacklog fails on a night that overlapped nothing — and says how many nights it read", () => {
  const { ok, checks } = evaluateExpectations(scenario({ rankVsBacklog: 1 }), {
    backlog: { items: BACKLOG },
    nights: [c1night(1, [{ title: "Rename the settle poll flag" }]), c1night(2, [{ title: "Invent a new tab" }])],
  });
  assert.equal(ok, false, "a bottom-of-the-backlog pick is not a top-5 hit");
  assert.match(byName(checks).rankVsBacklog.delta, /across 2 night\(s\)/);
});

test("rankVsBacklog: an absent list or an absent backlog reads null and does NOT fail", () => {
  const noList = evaluateExpectations(scenario({ rankVsBacklog: 1 }), {
    backlog: { items: BACKLOG },
    nights: [c1night(1, null)],
  });
  assert.equal(noList.ok, true, "Personas does not ship the list yet — that is not the holder's failing");
  assert.equal(byName(noList.checks).rankVsBacklog.actual, null);
  assert.match(byName(noList.checks).rankVsBacklog.delta, /no night carried a proposal list/);
  assert.match(byName(noList.checks).rankVsBacklog.note, /not a zero overlap/);

  const noBacklog = evaluateExpectations(scenario({ rankVsBacklog: 1 }), { nights: [c1night(1, [{ title: "x" }])] });
  assert.equal(noBacklog.ok, true);
  assert.match(byName(noBacklog.checks).rankVsBacklog.delta, /no operator backlog was supplied/);
});

test("rankVsBacklog: three verbatim backlog titles is CONTAMINATION, and counts no hits (§6)", () => {
  const { ok, checks } = evaluateExpectations(scenario({ rankVsBacklog: 1 }), {
    backlog: { items: BACKLOG },
    nights: [
      c1night(1, [
        { title: "Close the comms delivery gap" },
        { title: "Type the analyze/api seam" },
        // Measured against the WHOLE backlog: a read-back of middling rows is
        // just as much a read-back as one of the top.
        { title: "Rename the settle poll flag" },
      ]),
    ],
  });
  assert.equal(ok, false, "a list that is the backlog read back is not a ranking");
  const check = byName(checks).rankVsBacklog;
  assert.equal(check.actual, 0, "the two top-5 matches are NOT counted as hits");
  assert.match(check.note, /CONTAMINATED/);
  assert.match(check.note, /night\(s\) 1/);

  // Two verbatim matches are judgment, not contamination.
  const clean = evaluateExpectations(scenario({ rankVsBacklog: 1 }), {
    backlog: { items: BACKLOG },
    nights: [c1night(1, [{ title: "Close the comms delivery gap" }, { title: "Type the analyze/api seam" }])],
  });
  assert.equal(clean.ok, true);
  assert.equal(byName(clean.checks).rankVsBacklog.note, undefined);
});

test("rankVsBacklog ranks by the PRE-SCORED value, and keeps file order where nothing is scored", () => {
  // The holder's own order is its ranking when it scored nothing.
  const unscored = rankNight([{ title: "first" }, { title: "second" }, { title: "third" }], [], { topK: 2 });
  assert.deepEqual(unscored.holderTop, ["first", "second"]);
  // A scored list re-ranks — the bench does not care what order it arrived in.
  const scored = rankNight([{ title: "low", value: 1 }, { title: "high", value: 9 }], [], { topK: 1 });
  assert.deepEqual(scored.holderTop, ["high"]);
  // The bench's own [bench <stamp>] suffix is not part of a title's identity.
  const stamped = rankNight([{ title: "Close the comms delivery gap [bench 2026-08-29T09-31-02]" }], BACKLOG, { topK: 5 });
  assert.deepEqual(stamped.hits, ["Close the comms delivery gap [bench 2026-08-29T09-31-02]"]);
});

test("declineQuality: every decline must carry a reason from the closed set", () => {
  const clean = evaluateExpectations(scenario({ declineQuality: true }), {
    nights: [
      c1night(1, null, [
        { title: "Rewrite the router", reason: "outside-mandate" },
        { title: "Add a logo", reason: "low value" },
        { title: "Type the seam", reason: "already done" },
        { title: "Drop the CZK layer", reason: "needs a human decision" },
      ]),
    ],
  });
  assert.equal(clean.ok, true, "the prose forms of the four reasons normalise — punctuation is not the finding");
  assert.equal(byName(clean.checks).declineQuality.actual, 1);
  assert.match(byName(clean.checks).declineQuality.note, /spot-check/);

  const sloppy = evaluateExpectations(scenario({ declineQuality: true }), {
    nights: [
      c1night(1, null, [
        { title: "a", reason: "outside-mandate" },
        { title: "b", reason: "it did not feel right" },
        { title: "c" },
      ]),
    ],
  });
  assert.equal(sloppy.ok, false);
  const check = byName(sloppy.checks).declineQuality;
  assert.equal(check.actual, 0.3333);
  assert.match(check.delta, /did not feel right/);
  assert.match(check.delta, /1 of 3/);
});

test("declineQuality: no decline log reads null and does not fail", () => {
  const { ok, checks } = evaluateExpectations(scenario({ declineQuality: true }), { nights: [c1night(1, [{ title: "x" }])] });
  assert.equal(ok, true);
  assert.equal(byName(checks).declineQuality.actual, null);
  assert.match(byName(checks).declineQuality.note, /not a clean one/);
});

test("valueLiteracy: a proposal naming no journey or no axis is a task-executor's proposal", () => {
  const short = evaluateExpectations(scenario({ valueLiteracy: 0.8 }), {
    nights: [
      c1night(1, [
        { title: "a", journey: "role-to-schedule", axis: "time" },
        { title: "b", journey: "cv-to-shortlist", axis: "risk" },
        // The nested shape reads the same as the flat one.
        { title: "c", target: { journey: "apply" }, value: { axis: "gate" } },
        { title: "d", journey: "apply", axis: "vibes" },
      ]),
    ],
  });
  // 3 of 4 is 0.75, which is BELOW the 0.8 line — the arithmetic is pinned, not
  // the hope that "most of them named one" is good enough.
  assert.equal(byName(short.checks).valueLiteracy.actual, 0.75);
  assert.equal(short.ok, false);
  assert.match(byName(short.checks).valueLiteracy.delta, /"d" names no axis in time\/risk\/gate/);

  const good = evaluateExpectations(scenario({ valueLiteracy: 0.8 }), {
    nights: [c1night(1, [{ title: "a", journey: "j", axis: "time" }, { title: "b", journey: "j", axis: "gate" }])],
  });
  assert.equal(good.ok, true);
  assert.equal(byName(good.checks).valueLiteracy.actual, 1);
});

test("valueLiteracy: no proposal list reads null and does not fail", () => {
  const { ok, checks } = evaluateExpectations(scenario({ valueLiteracy: 0.8 }), { nights: [c1night(1, null)] });
  assert.equal(ok, true);
  assert.equal(byName(checks).valueLiteracy.actual, null);
  assert.match(byName(checks).valueLiteracy.note, /not an illiterate one/);
});

test("the C1 checks pool every night, not just the busiest one", () => {
  const { checks } = evaluateExpectations(scenario({ valueLiteracy: 1, declineQuality: true }), {
    nights: [
      c1night(1, [{ title: "a", journey: "j", axis: "time" }], [{ title: "x", reason: "low-value" }]),
      c1night(2, [{ title: "b" }], [{ title: "y", reason: "nope" }]),
    ],
  });
  assert.equal(byName(checks).valueLiteracy.actual, 0.5, "2 nights, 2 proposals, 1 literate");
  assert.equal(byName(checks).declineQuality.actual, 0.5);
});
