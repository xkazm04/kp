// The expectation evaluator, over hand-built run records.
//
//   node --test scripts/app-master-bench/
//
// The distinction every one of these tests is really about: a reading of zero
// and NO reading are different findings, and the evaluator must never collapse
// them. A bench that scores an absence is worse than one that fails.

import test from "node:test";
import assert from "node:assert/strict";
import { collectStrings, evaluateExpectations, extractBackboneReading } from "./expectations.mjs";

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
