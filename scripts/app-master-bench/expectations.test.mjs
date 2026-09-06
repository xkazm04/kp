// The expectation evaluator, over hand-built run records.
//
//   node --test scripts/app-master-bench/
//
// The distinction every one of these tests is really about: a reading of zero
// and NO reading are different findings, and the evaluator must never collapse
// them. A bench that scores an absence is worse than one that fails.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOPILOT_ORDER,
  BACKBONE_FIELDS,
  collectStrings,
  evaluateExpectations,
  extractBackboneReading,
  extractIdeation,
  extractNightLists,
  mergeReadings,
  nightLists,
  overnightCounts,
  partitionByHire,
  phaseCounts,
  rankNight,
  readingFromRoster,
  reconcileCounts,
  sinceHirePlan,
} from "./expectations.mjs";
// The PRODUCER of every reason string `readingFromRoster` parses. TypeScript,
// loaded by node's type stripping (see personas-contract.test.mjs's header) —
// backbone.ts's only import is `import type`, so nothing else comes with it.
import { backboneScore } from "../../app/_lib/app-master/backbone.ts";
// The CONTRACT SOURCE for what a Personas build may report. `AUTOPILOT_MODES` is
// a value and imports; `RollupBackbone` is a type and is read out of the source
// below — there is nothing else to compare a hand-typed field list against.
import { AUTOPILOT_MODES } from "../../app/_lib/agent-hire/report-payload.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT_PAYLOAD = path.join(REPO_ROOT, "app", "_lib", "agent-hire", "report-payload.ts");

/** The top-level member names of `export type RollupBackbone` in report-payload.ts.
 *  Comments go first (they hold prose colons), then a brace walk keeps depth-1
 *  members only, so `memory`'s inline object contributes its own name and none of
 *  its counts. Line endings are normalised: this repo is CRLF on Windows and LF
 *  in the worktree, and an anchored read must not care which. */
function rollupBackboneFields() {
  const src = readFileSync(REPORT_PAYLOAD, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("export type RollupBackbone = {");
  assert.ok(start >= 0, "report-payload.ts no longer declares `export type RollupBackbone = {`");
  const body = src
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const lines = body.slice(body.indexOf("{")).split("\n");
  const fields = [];
  let depth = 0;
  for (const line of lines) {
    if (depth === 1) {
      const member = /^\s*(\w+)\??\s*:/.exec(line);
      if (member) fields.push(member[1]);
    }
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth === 0 && fields.length > 0) break;
  }
  return fields;
}

// ─── the two vocabularies this driver copies from kp ────────────────────────
// `expectations.mjs` is a plain `.mjs` the driver loads without the app's module
// graph, so it re-types two closed sets `report-payload.ts` owns. Nothing checked
// either copy: `BACKBONE_FIELDS` scanned tick summaries for `windowDays` (the
// RECEIVER's, never sent) and ignored `kpiDeltas` and `memory` (sent since
// 2026-08-27), and `AUTOPILOT_ORDER` was a second spelling of `AUTOPILOT_MODES`
// with no parity assert — the exact class the personas-contract doubles were
// fixed for one layer up.

test("BACKBONE_FIELDS is the RollupBackbone field list report-payload.ts declares", () => {
  const declared = rollupBackboneFields();
  assert.ok(declared.length >= 10, `parsed only ${declared.length} RollupBackbone fields — the parser lost the shape`);
  assert.deepEqual([...BACKBONE_FIELDS].sort(), [...declared].sort());
  // The two halves of the drift this pin closes, named so a revert is loud.
  assert.ok(!BACKBONE_FIELDS.includes("windowDays"), "windowDays is the receiver's window, not a reported field");
  for (const sent of ["kpiDeltas", "memory"]) assert.ok(BACKBONE_FIELDS.includes(sent), `${sent} is reported and must be scanned`);
});

test("AUTOPILOT_ORDER is AUTOPILOT_MODES, in the order that file declares it", () => {
  // Weakest first is load-bearing: `autopilotAtLeast` compares by index.
  assert.deepEqual(AUTOPILOT_ORDER, [...AUTOPILOT_MODES]);
});

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
// ROSTER, in the SCORED shape.
//
// The rows below are not transcribed from that run's `result.json` any more:
// they are produced by `backboneScore` ITSELF (app/_lib/app-master/backbone.ts,
// loaded through node's type stripping, same as personas-contract.test.mjs loads
// the e2e mock). `readingFromRoster` has to parse three of the scorer's reason
// strings because the counts behind them have no structured carrier, and a
// hand-typed copy of those strings here would have been a THIRD copy: a
// copy-edit to a `reason:` in backbone.ts would leave both the fixture and the
// parser matching each other while the server served something else, and the
// bench would report "unmeasured" on a night that delivered. Driving the real
// producer means such an edit fails HERE, in the run that makes it.
//
// The INPUT is still the sweep's own night 1 (its reported rollup), and the
// score it produces is asserted below against the numbers that run recorded.

/** Night 1 of the 2026-08-25 sweep, as the rollup it reported. */
const SWEEP_NIGHT_1 = {
  windowDays: 30,
  proposalsOpened: 3,
  proposalsMerged: 0,
  proposalsReverted: 0,
  gatePassRate: null,
  forbiddenClassViolations: 0,
  kpiDeltas: [
    { kpiKey: "gate_pass_rate", baseline: null, current: null, target: 95, direction: "gte", windowDays: 60, measured: false },
    { kpiKey: "proposal_merge_rate", baseline: null, current: null, target: 80, direction: "gte", windowDays: 60, measured: false },
  ],
  budgetReservedUsd: 4.5,
  budgetSettledUsd: 0,
  budgetUnmeasured: false,
  ledgerConsistent: true,
};

/** A roster row exactly as `GET /api/agents` assembles one: the SCORED backbone
 *  the production scorer writes, beside the App-master block. `over` perturbs
 *  the night's rollup — never the scored output — so every reason string under
 *  test is the producer's. */
const rosterRow = (over = {}) => ({
  backbone: backboneScore({ ...SWEEP_NIGHT_1, ...over }),
  appMaster: { population: "agent", scopeRung: 2, probationDays: 30, autopilotMode: "full" },
  agentStatus: "active",
  kpiDeltas: SWEEP_NIGHT_1.kpiDeltas,
});

const ROSTER_ROW = rosterRow();

test("the scored row under test is the sweep's own night, as the PRODUCER scores it", () => {
  // The pin on the input side: these are the figures the 2026-08-25 run
  // recorded. If backbone.ts re-weights a rule, this says so before the reading
  // tests below start explaining a changed number as a parser bug.
  assert.equal(ROSTER_ROW.backbone.scoredWeight, 40);
  assert.equal(ROSTER_ROW.backbone.totalWeight, 100);
  assert.equal(ROSTER_ROW.backbone.coverage, 0.4);
  assert.equal(ROSTER_ROW.backbone.score, 0.375);
  assert.equal(ROSTER_ROW.backbone.verdict, "incomplete");
  assert.deepEqual(ROSTER_ROW.backbone.unmeasured, ["durability", "gates", "objectives"]);
});

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
  const row = rosterRow({ gatePassRate: 0.944 });
  assert.equal(readingFromRoster(row).gatePassRate, 0.944);
});

test("readingFromRoster: the durability and no-reservation arms parse the producer's own prose", () => {
  // Both remaining regexes, driven by the scorer rather than by a copy of it.
  const reverted = readingFromRoster(rosterRow({ proposalsOpened: 4, proposalsMerged: 4, proposalsReverted: 1 }));
  assert.equal(reverted.proposalsMerged, 4);
  assert.equal(reverted.proposalsOpened, 4);
  assert.equal(reverted.proposalsReverted, 1);

  const unreserved = readingFromRoster(rosterRow({ budgetReservedUsd: 0, budgetSettledUsd: 1.85 }));
  assert.equal(unreserved.budgetUnmeasured, false);
  assert.equal(unreserved.budgetSettledUsd, 1.85);
  assert.equal(unreserved.budgetReservedUsd, 0);

  // Nothing reserved and nothing spent is a METERED pair of zeroes, not a gap.
  const idle = readingFromRoster(rosterRow({ budgetReservedUsd: 0, budgetSettledUsd: 0 }));
  assert.equal(idle.budgetUnmeasured, false);
  assert.equal(idle.budgetSettledUsd, 0);
  assert.equal(idle.budgetReservedUsd, 0);
});

test("readingFromRoster: 'no proposals were opened' is a reported ZERO, and fails a minimum", () => {
  const row = rosterRow({ proposalsOpened: 0 });
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
  const row = rosterRow({ budgetUnmeasured: true, budgetSettledUsd: 2.1 });
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
  const empty = nightLists({});
  assert.equal(empty.proposals, null);
  assert.equal(empty.declines, null);
  assert.equal(empty.filtered, false, "with no plan nothing is narrowed, and nothing claims to have been");
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

// ─── since-hire: whose ideas are being graded (c1-exam §3) ──────────────────
//
// MEASURED 2026-08-30 on the first live tenure night: the overnight tick
// triaged and dispatched the project's 58 PRE-TENURE accepted ideas and
// reported that deck back as the holder's `proposals[]`. Graded as-is, the exam
// would have scored the operator's own backlog as the App master's judgment —
// and scored it WELL, since the operator wrote both sides.

const HIRED_AT = "2026-08-29T12:00:00.000Z";
const beforeHire = "2026-06-01T00:00:00.000Z";
const afterHire = "2026-08-30T02:00:00.000Z";
const tenureRun = (over = {}) => ({ tenure: { hiredAt: HIRED_AT }, ...over });

test("partitionByHire splits a list three ways and counts what it took out", () => {
  const split = partitionByHire(
    [
      { title: "inherited", createdAt: beforeHire },
      { title: "tonight", createdAt: afterHire },
      { title: "undated" },
      { title: "unparseable", createdAt: "last tuesday" },
      { title: "on the boundary", createdAt: HIRED_AT },
    ],
    HIRED_AT
  );
  assert.deepEqual(
    split.rows.map((r) => r.title),
    ["tonight", "on the boundary"],
    "the boundary itself is the holder's — hiredAt is when the tenure BEGAN"
  );
  assert.equal(split.preTenure, 1);
  assert.equal(split.undated, 2, "no createdAt and an unreadable one are the same finding: cannot attribute");
  assert.equal(split.applied, true);
});

test("partitionByHire: an absent list stays absent, and an unusable hiredAt disables the split", () => {
  assert.deepEqual(partitionByHire(null, HIRED_AT), { rows: null, preTenure: 0, undated: 0, applied: false });
  const noBoundary = partitionByHire([{ title: "a" }], null);
  assert.equal(noBoundary.applied, false);
  assert.equal(noBoundary.undated, 0, "with no boundary nothing is excluded — the filter is off, not silently strict");
  assert.deepEqual(noBoundary.rows, [{ title: "a" }]);
});

test("sinceHirePlan: on by default for a tenure with a hiredAt, off for a fresh hire", () => {
  assert.deepEqual(sinceHirePlan(tenureRun()), { enabled: true, hiredAt: HIRED_AT, reason: null });
  const fresh = sinceHirePlan({ tenure: null });
  assert.equal(fresh.enabled, false);
  assert.match(fresh.reason, /every row on the wire is this run's own hire/);
  // A tenure that cannot say when it was hired cannot attribute anything.
  assert.equal(sinceHirePlan({ tenure: { hiredAt: null } }).enabled, false);
  // The driver's own record wins — that is the half that knows about the flag.
  const off = sinceHirePlan({
    tenure: { hiredAt: HIRED_AT },
    sinceHire: { enabled: false, hiredAt: HIRED_AT, reason: "--no-since-hire" },
  });
  assert.equal(off.enabled, false);
  assert.equal(off.reason, "--no-since-hire");
});

test("rankVsBacklog grades the holder's own top-5, not the deck it inherited", () => {
  // The inherited deck is the operator's backlog, verbatim and top-scored —
  // exactly what a live tick reported. Ungraded, it would hand the exam three
  // hits the holder never earned.
  const inherited = BACKLOG.slice(0, 2).map((row) => ({ ...row, createdAt: beforeHire }));
  const nights = [
    c1night(1, [...inherited, { title: "Name the degrade path on the analysis card", value: 4, createdAt: afterHire }]),
  ];

  const graded = evaluateExpectations(
    scenario({ rankVsBacklog: { topK: 5, minHits: 1 } }),
    tenureRun({ backlog: { items: BACKLOG }, nights })
  );
  const check = byName(graded.checks).rankVsBacklog;
  assert.equal(graded.ok, false, "the one proposal the HOLDER made is not in the operator's top-5");
  assert.equal(check.actual, 0);
  assert.match(check.note, /2 proposal\(s\) created before the tenure's hiredAt/);
  assert.match(check.note, /inherited deck, not the holder's work/);

  // …and the same record with the filter OFF scores two hits it did not earn,
  // which is why the filter is on by default. (Three would have tripped the
  // contamination flag instead — the since-hire filter catches the read-back
  // that stays UNDER that line, which is the shape a live tick produced.)
  const unfiltered = evaluateExpectations(scenario({ rankVsBacklog: { topK: 5, minHits: 1 } }), {
    ...tenureRun({ backlog: { items: BACKLOG }, nights }),
    sinceHire: { enabled: false, hiredAt: HIRED_AT, reason: "--no-since-hire: a comparison run" },
  });
  const loose = byName(unfiltered.checks).rankVsBacklog;
  assert.equal(loose.actual, 2);
  assert.match(loose.note, /--no-since-hire/, "a comparison run says in the record that it graded everything");
  assert.ok(!loose.note.includes("EXCLUDED"), "nothing was excluded, so nothing claims to have been");
});

test("a night whose WHOLE list predates the hire reads unmeasured, never a zero ranking", () => {
  const { ok, checks } = evaluateExpectations(
    scenario({ rankVsBacklog: 1 }),
    tenureRun({
      backlog: { items: BACKLOG },
      nights: [c1night(1, BACKLOG.slice(0, 2).map((row) => ({ ...row, createdAt: beforeHire })))],
    })
  );
  const check = byName(checks).rankVsBacklog;
  assert.equal(ok, true, "unmeasured is not zero — the holder proposed nothing, it did not propose badly");
  assert.equal(check.actual, null);
  assert.match(check.delta, /no night carried a proposal list/);
  assert.match(check.note, /2 proposal\(s\) created before the tenure's hiredAt/);
});

test("declineQuality reads only the declines the holder itself logged", () => {
  const { checks } = evaluateExpectations(
    scenario({ declineQuality: true }),
    tenureRun({
      nights: [
        c1night(1, null, [
          { title: "inherited, auto-triaged", reason: "stale after 90 days", createdAt: beforeHire },
          { title: "tonight", reason: "low-value", createdAt: afterHire },
        ]),
      ],
    })
  );
  const check = byName(checks).declineQuality;
  assert.equal(check.actual, 1, "the holder's one decline carries a reason; the inherited one is not its to answer for");
  assert.match(check.note, /1 decline\(s\) created before the tenure's hiredAt/);
});

test("valueLiteracy is not diluted by the deck the holder inherited", () => {
  const { ok, checks } = evaluateExpectations(
    scenario({ valueLiteracy: 0.8 }),
    tenureRun({
      nights: [
        c1night(1, [
          { title: "inherited", createdAt: beforeHire },
          { title: "tonight", journey: "cv-to-shortlist", axis: "risk", createdAt: afterHire },
        ]),
      ],
    })
  );
  assert.equal(ok, true);
  assert.equal(byName(checks).valueLiteracy.actual, 1, "1 of 1 of the holder's own proposals names both");
});

test("NO createdAt anywhere degrades to `cannot attribute`, never to `all of it is the holder's`", () => {
  // The Personas build that does not ship createdAt yet. The rows are real and
  // two of them would even score — but nothing on the wire says whose they are,
  // and a bench that guesses in the flattering direction is worse than one that
  // reads null.
  const nights = [
    c1night(
      1,
      [{ title: "Close the comms delivery gap", value: 9 }, { title: "Type the analyze/api seam", value: 8 }],
      [{ title: "some candidate", reason: "low-value" }]
    ),
  ];
  const { ok, checks } = evaluateExpectations(
    scenario({ rankVsBacklog: 1, declineQuality: true, valueLiteracy: 0.8 }),
    tenureRun({ backlog: { items: BACKLOG }, nights })
  );
  const c = byName(checks);
  assert.equal(ok, true, "an unattributable night fails nothing — it measures nothing");
  assert.equal(c.rankVsBacklog.actual, null, "two verbatim top-5 titles must NOT be read as two earned hits");
  assert.equal(c.declineQuality.actual, null);
  assert.equal(c.valueLiteracy.actual, null);
  for (const name of ["rankVsBacklog", "declineQuality", "valueLiteracy"]) {
    assert.match(c[name].note, /carried no createdAt and could not be attributed/, name);
  }
});

test("a fresh-hire run is unaffected: no tenure, no filter, no note about one", () => {
  const nights = [
    c1night(
      1,
      [{ title: "Close the comms delivery gap", journey: "comms", axis: "time" }],
      [{ title: "x", reason: "low-value" }]
    ),
  ];
  const { ok, checks } = evaluateExpectations(scenario({ rankVsBacklog: 1, declineQuality: true, valueLiteracy: 0.8 }), {
    backlog: { items: BACKLOG },
    nights,
  });
  const c = byName(checks);
  assert.equal(ok, true);
  assert.equal(c.rankVsBacklog.actual, 1, "an undated row on a fresh hire is still this run's own work");
  assert.equal(c.declineQuality.actual, 1);
  assert.equal(c.valueLiteracy.actual, 1);
  for (const name of ["rankVsBacklog", "declineQuality", "valueLiteracy"]) {
    assert.ok(!/EXCLUDED/.test(c[name].note ?? ""), `${name} excluded nothing and must not say it did`);
  }
});

test("nightLists narrows the lists and reports the split per list", () => {
  const night = c1night(
    1,
    [{ title: "old", createdAt: beforeHire }, { title: "new", createdAt: afterHire }, { title: "undated" }],
    [{ title: "old decline", createdAt: beforeHire }, { title: "new decline", createdAt: afterHire }]
  );
  const plan = sinceHirePlan(tenureRun());
  const narrowed = nightLists(night, plan);
  assert.deepEqual(narrowed.proposals.map((p) => p.title), ["new"]);
  assert.deepEqual(narrowed.declines.map((d) => d.title), ["new decline"]);
  assert.equal(narrowed.preTenure, 2, "the record's total spans both lists");
  assert.equal(narrowed.undated, 1);
  assert.deepEqual(narrowed.byList, {
    proposals: { preTenure: 1, undated: 1 },
    declines: { preTenure: 1, undated: 0 },
  });
  assert.equal(narrowed.filtered, true);
  // No plan at all is the old behaviour, byte for byte.
  const raw = nightLists(night);
  assert.equal(raw.proposals.length, 3);
  assert.equal(raw.preTenure, 0);
  assert.equal(raw.filtered, false);
});

test("extractIdeation reads the block wherever it rides, and never invents one", () => {
  const block = { ran: true, lens: "stabilize", authored: 3, blocked: null };
  assert.deepEqual(extractIdeation({ phases: [{ phase: "overnight", ideation: block }] }), block);
  assert.deepEqual(extractIdeation({ phases: { overnight: { ideation: block } } }), block);
  assert.equal(extractIdeation({ phases: [{ phase: "overnight", counts: {} }] }), null, "a build that reports none reads null");
  assert.equal(extractIdeation(null), null);
  // A build that says it did NOT ideate is a reading, and a different one.
  const didNot = { ran: false, lens: null, authored: 0, blocked: "no lens was configured" };
  assert.deepEqual(extractIdeation({ ideation: didNot }), didNot);
});

// ALWAYS-ON night integrity (2026-08-31): an ideate tick died at undici's 300s
// headers timeout, every C1 check honestly read null, and the banner said PASS —
// a clean night nobody measured. A dead tick must fail the scenario regardless
// of what the expect block asks for.
test("a night whose tick failed fails the scenario, whatever the expect block says", () => {
  const result = {
    nights: [
      { night: 1, tickOk: false, tickError: "overnight: fetch failed" },
      { night: 2, tickOk: true },
    ],
  };
  const evaluated = evaluateExpectations({ expect: {} }, result);
  assert.equal(evaluated.ok, false, "the scenario verdict itself must be FAIL");
  const integrity = evaluated.checks.find((c) => c.name === "nightIntegrity");
  assert.ok(integrity, "the check must exist with an empty expect block — it is not opt-in");
  assert.equal(integrity.ok, false);
  assert.match(integrity.delta, /night 1/);
  assert.match(integrity.delta, /fetch failed/);
  // NON-VACUITY: all ticks alive → no integrity row at all (not a passing one —
  // silence, so a green run's check list stays what the scenario asked for).
  const clean = evaluateExpectations({ expect: {} }, { nights: [{ night: 1, tickOk: true }] });
  assert.equal(clean.ok, true);
  assert.equal(clean.checks.find((c) => c.name === "nightIntegrity"), undefined);
});
