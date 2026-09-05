// Fixtures for the bench gate (gate.mjs). Picked up by `npm run test:bench-driver`.
//
// The point of these is the DISTINCTIONS the gate has to keep: not-run is not
// the same as failed, an expectation nobody measured is not a pass, a CANNED
// run is not a measurement, an OLD run is not a current verdict, and a scenario
// nobody baselined is reported rather than silently counted as covered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_AGE_DAYS, evaluateSweep, renderGate } from "./gate.mjs";
import { listScenarioFiles } from "./scenarios.mjs";

// Read the scenario JSON raw rather than through loadScenarioFile: that helper
// expands $KP_ROOT-style repo paths against the local machine, and this check
// only cares which expectation NAMES the file declares.
const readScenario = (file) => JSON.parse(readFileSync(file, "utf8"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(readFileSync(path.join(HERE, "baseline.json"), "utf8"));

const baseline = (scenarios) => ({ recordedAt: "2026-08-26", scenarios });
const run = (
  scenario,
  { ok = true, expectations = [], finishedAt = "2026-08-26T10:00:00.000Z", failedPhase = null, stub = false, reusedScan = false } = {},
) => ({
  scenario,
  finishedAt,
  result: {
    ok,
    failedPhase,
    finishedAt,
    expectations,
    personas: { stub },
    scan: { scanId: "rscan-x", reused: reusedScan },
    scenario: { name: scenario },
  },
});
const expectation = (name, ok = true) => ({ name, ok, expected: "x", actual: ok ? "x" : "y" });

// Freshness is now part of the verdict, so every fixture states WHEN it is being
// judged. Without this the whole file would start failing on its own, some day
// after 2026-09-09, for no reason connected to the code — a test that rots into
// red teaches people to ignore the gate it defends.
const NOW = new Date("2026-08-27T00:00:00.000Z");
const evaluate = (b, runs, options = {}) => evaluateSweep(b, runs, { now: NOW, ...options });

test("a green sweep over the baselined scenarios passes", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { expectations: [expectation("noViolations")] })],
  );
  assert.equal(g.ok, true);
  assert.equal(g.counts.pass, 1);
});

test("a scenario the sweep never ran is MISSING, not passing", () => {
  const g = evaluate(baseline({ alpha: { mustPass: true } }), []);
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "missing");
  assert.match(g.rows[0].reason, /no run for it/);
});

test("a failed expectation fails the gate and names the delta", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { expectations: [expectation("noViolations", false)] })],
  );
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /noViolations: expected x, got y/);
});

test("an expectation quietly dropped from a scenario is a coverage regression", () => {
  // The run is green — but the check the baseline requires was never measured.
  // Unmeasured is not zero, and it is not a pass either.
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["probation", "noViolations"] } }),
    [run("alpha", { expectations: [expectation("noViolations")] })],
  );
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /"probation" was not measured/);
});

test("an incomplete run fails and carries its failed phase", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha", { ok: false, failedPhase: "dispatch" })],
  );
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /failed phase: dispatch/);
});

test("the NEWEST run per scenario wins", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [
      run("alpha", { finishedAt: "2026-08-01T00:00:00.000Z", expectations: [expectation("noViolations", false)] }),
      run("alpha", { finishedAt: "2026-08-26T00:00:00.000Z", expectations: [expectation("noViolations", true)] }),
    ],
  );
  assert.equal(g.ok, true);
});

test("an unbaselined scenario is reported, not counted as covered", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha"), run("newcomer")],
  );
  assert.equal(g.ok, true);
  assert.deepEqual(g.unbaselined, ["newcomer"]);
  assert.match(renderGate(g, BASELINE), /unbaselined and therefore UNGATED: newcomer/);
});

test("the banner leads with the verdict, both ways", () => {
  const green = renderGate(evaluate(baseline({ a: { mustPass: true } }), [run("a")]), BASELINE);
  assert.match(green.split("\n")[0], /BENCH GATE GREEN/);
  const red = renderGate(evaluate(baseline({ a: { mustPass: true } }), []), BASELINE);
  assert.match(red.split("\n")[0], /BENCH GATE RED/);
  assert.match(red, /baseline that moved on purpose/);
});

// --- canned runs do not certify --------------------------------------------
test("a run against the STUB Personas is refused, and named as canned", () => {
  // Every expectation passes. The run is complete. It is still worth nothing:
  // the stub answers canned numbers without running an agent, and the gate was
  // the one reader in the whole bench that never asked.
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { stub: true, expectations: [expectation("noViolations")] })],
  );
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "stub");
  assert.equal(g.rows[0].stub, true);
  assert.equal(g.counts.stub, 1);
  assert.match(g.rows[0].reason, /canned/);
  const rendered = renderGate(g, BASELINE);
  assert.match(rendered, /CANNED \(stub Personas\)/);
  assert.match(rendered, /without --stub-personas/);
});

test("a live run is not mistaken for a stub one", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha", { stub: false })],
  );
  assert.equal(g.ok, true);
  assert.equal(g.rows[0].stub, false);
  assert.equal(g.counts.stub, 0);
});

// --- a COPIED scan does not certify the scan engine -------------------------
// Four scenarios point at one root, and kp coalesces a repeat scan of a target
// it read in the last 30 minutes. A run handed somebody else's dossier proves
// the App master read a repository; it proves nothing about the READING. Same
// class as a stub row, so it gets the same treatment and its own bucket, because
// "re-run without --reuse-scan" and "re-run without --stub-personas" are
// different instructions.
test("a run whose scan was REUSED is refused, and named as copied", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { reusedScan: true, expectations: [expectation("noViolations")] })],
  );
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "reused-scan");
  assert.equal(g.counts.reusedScan, 1);
  assert.match(g.rows[0].reason, /COALESCED/);
  const rendered = renderGate(g, BASELINE);
  assert.match(rendered, /COPIED scan/);
  assert.match(rendered, /--reuse-scan/);
});

test("a run that took its own reading is not mistaken for a copied one", () => {
  const g = evaluate(baseline({ alpha: { mustPass: true } }), [run("alpha", { reusedScan: false })]);
  assert.equal(g.ok, true);
  assert.equal(g.counts.reusedScan, 0);
});

test("a run with no scan record at all is not called a copy", () => {
  // A tenure run skips the whole preamble: it has no `scan` block, and absence
  // of a flag is not evidence of reuse.
  const bare = { scenario: "alpha", finishedAt: "2026-08-26T10:00:00.000Z", result: { ok: true, finishedAt: "2026-08-26T10:00:00.000Z", expectations: [], personas: { stub: false }, scenario: { name: "alpha" } } };
  const g = evaluate(baseline({ alpha: { mustPass: true } }), [bare]);
  assert.equal(g.ok, true);
  assert.equal(g.counts.reusedScan, 0);
});

// --- stale runs do not certify ----------------------------------------------
test("a run finished BEFORE the baseline was recorded cannot certify it", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha", { finishedAt: "2026-08-20T10:00:00.000Z" })],
  );
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "stale");
  assert.match(g.rows[0].reason, /BEFORE the baseline/);
});

test("a run older than the max age is stale, however green", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha", { finishedAt: "2026-08-26T00:00:00.000Z" })],
    // Judged a month after the sweep: a green number from a month ago says the
    // App master worked then, which is not what the gate was asked.
    { now: new Date("2026-09-26T00:00:00.000Z") },
  );
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "stale");
  assert.match(g.rows[0].reason, /31\.0 days old \(max 14\)/);
  assert.match(renderGate(g, BASELINE), /stale/);
});

test("--max-age-days widens the window on purpose", () => {
  const g = evaluate(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha", { finishedAt: "2026-08-26T00:00:00.000Z" })],
    { now: new Date("2026-09-26T00:00:00.000Z"), maxAgeDays: 60 },
  );
  assert.equal(g.ok, true);
  assert.equal(g.maxAgeDays, 60);
});

test("an undatable run is not fresh — absence of a stamp is not proof of youth", () => {
  const g = evaluate(baseline({ alpha: { mustPass: true } }), [run("alpha", { finishedAt: null })]);
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "stale");
  assert.match(g.rows[0].reason, /no readable finishedAt/);
});

test("a real failure outranks stub and staleness in the verdict", () => {
  // All three are true at once. The verdict names the one that is about the App
  // master rather than about the harness — but every reason is still carried.
  const g = evaluate(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { stub: true, finishedAt: "2026-08-01T00:00:00.000Z", expectations: [expectation("noViolations", false)] })],
  );
  assert.equal(g.rows[0].verdict, "fail");
  assert.match(g.rows[0].reason, /noViolations: expected x, got y/);
  assert.match(g.rows[0].reason, /canned/);
  assert.match(g.rows[0].reason, /BEFORE the baseline/);
});

test("the default window is the documented one", () => {
  assert.equal(DEFAULT_MAX_AGE_DAYS, 14);
});

// --- the committed baseline must describe the committed scenarios -----------
test("every baselined scenario has a scenario file", () => {
  const known = new Set(listScenarioFiles().map((f) => path.basename(f, ".json")));
  for (const name of Object.keys(BASELINE.scenarios)) {
    assert.ok(known.has(name), `baseline names "${name}", which has no scenarios/${name}.json`);
  }
});

test("every required expectation is actually declared by its scenario", () => {
  // Guards the other direction: a baseline that requires a check the scenario
  // never runs would fail every sweep forever and teach people to ignore it.
  for (const [name, spec] of Object.entries(BASELINE.scenarios)) {
    const file = listScenarioFiles().find((f) => path.basename(f, ".json") === name);
    if (!file) continue;
    const declared = Object.keys(readScenario(file).expect ?? {});
    for (const required of spec.requiredExpectations ?? []) {
      assert.ok(
        declared.includes(required),
        `baseline requires "${required}" for ${name}, but its expect block declares only: ${declared.join(", ")}`,
      );
    }
  }
});

// --- NUMBERS, not just pass/fail --------------------------------------------
// `mustPass` + `requiredExpectations` let a tenure fall from five opened
// proposals to one and still pass green: every required check was measured,
// every one met its own floor, and nothing compared the run to the last one.
// schemaVersion 2 puts the last measured numbers in the baseline and compares.
const withMetrics = (metrics, tolerance = 0.05) => ({
  recordedAt: "2026-08-26",
  scenarios: { alpha: { mustPass: true, tolerance, metrics, metricsFrom: "a stated source" } },
});
const night = (reading, backbone = {}) => ({ reading, backbone });
const measured = (scenario, nights, rest = {}) => {
  const r = run(scenario, rest);
  r.result.nights = nights;
  return r;
};

test("a number that regressed past the tolerance fails, and names the delta", () => {
  const g = evaluate(
    withMetrics({ proposalsOpened: { atLeast: 5 } }),
    [measured("alpha", [night({ proposalsOpened: 1 })])],
  );
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "fail");
  assert.match(g.rows[0].reason, /proposalsOpened/);
  assert.match(g.rows[0].reason, /1/);
  assert.match(g.rows[0].reason, /5/);
});

test("a wobble inside the tolerance is not a regression", () => {
  const g = evaluate(
    withMetrics({ gatePassRate: { atLeast: 0.944 } }),
    [measured("alpha", [night({ gatePassRate: 0.92 })])],
  );
  assert.equal(g.ok, true, "0.92 is within 5% of 0.944 - a bar that cries wolf gets ignored");
});

test("an `atMost` metric fails upwards, not downwards", () => {
  const worse = evaluate(
    withMetrics({ forbiddenClassViolations: { atMost: 0 } }, 0),
    [measured("alpha", [night({ forbiddenClassViolations: 2 })])],
  );
  assert.equal(worse.ok, false);
  assert.match(worse.rows[0].reason, /forbiddenClassViolations/);
  const better = evaluate(
    withMetrics({ proposalsOpened: { atLeast: 3 } }),
    [measured("alpha", [night({ proposalsOpened: 9 })])],
  );
  assert.equal(better.ok, true, "beating a bar is never a regression");
});

test("a baselined number the run never measured is a problem, not a zero", () => {
  const g = evaluate(withMetrics({ proposalsOpened: { atLeast: 3 } }), [measured("alpha", [night({})])]);
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /proposalsOpened/);
  assert.match(g.rows[0].reason, /not measured/);
});

test("the busiest night carries the scenario, not the last one", () => {
  const g = evaluate(
    withMetrics({ proposalsOpened: { atLeast: 3 } }),
    [measured("alpha", [night({ proposalsOpened: 3 }), night({ proposalsOpened: 0 })])],
  );
  assert.equal(g.ok, true, "the same reading REPORT.md prints - a quiet second night is not a regression");
});

test("a scenario with no committed numbers is reported as unmetered, and does not fail", () => {
  const g = evaluate(
    { recordedAt: "2026-08-26", scenarios: { alpha: { mustPass: true, metrics: null, metricsFrom: null } } },
    [measured("alpha", [night({ proposalsOpened: 1 })])],
  );
  assert.equal(g.ok, true, "nobody has measured it - that is a gap to fill, not a failure to invent");
  assert.equal(g.counts.unmetered, 1);
  assert.match(renderGate(g, BASELINE), /unmetered/);
});

// --- the baseline itself is a ratchet ---------------------------------------
// Both halves of this file can be loosened by EDITING IT, and both structural
// tests above would still pass: delete `probation` from requiredExpectations,
// or drop a metric bar to 1, and the sweep goes green over a worse App master.
// FLOOR is the frozen copy of what the baseline has already promised. Raising a
// bar is expected; lowering one is a deliberate edit to this constant with the
// reason in the commit body.
const FLOOR = {
  "kp-default": {
    requiredExpectations: ["population_fit", "probation", "noViolations", "minProposalsOpened"],
    tolerance: 0.05,
    metrics: {
      proposalsOpened: { atLeast: 3 },
      proposalsMerged: { atLeast: 2 },
      gatePassRate: { atLeast: 0.944 },
      forbiddenClassViolations: { atMost: 0 },
      backboneScore: { atLeast: 0.9056 },
      backboneCoverage: { atLeast: 1 },
    },
  },
  "kp-rung0": { requiredExpectations: ["maxProposalsOpened", "noViolations", "probation"] },
  "kp-tight-budget": { requiredExpectations: ["budgetDegraded", "noViolations"] },
  "personas-self": { requiredExpectations: ["probation", "noViolations"] },
  ascent: { requiredExpectations: ["probation", "noViolations", "minProposalsOpened"] },
  "systedo-case": { requiredExpectations: ["probation", "noViolations", "minProposalsOpened"] },
};

test("no baselined scenario may be deleted", () => {
  for (const name of Object.keys(FLOOR)) {
    assert.ok(
      BASELINE.scenarios[name],
      `baseline.json dropped "${name}" - deleting a gated scenario is not a green build`,
    );
  }
});

test("no required expectation may be dropped", () => {
  for (const [name, floor] of Object.entries(FLOOR)) {
    const have = new Set(BASELINE.scenarios[name]?.requiredExpectations ?? []);
    for (const required of floor.requiredExpectations) {
      assert.ok(
        have.has(required),
        `baseline.json no longer requires "${required}" of ${name} - unmeasured is not a pass`,
      );
    }
  }
});

test("no committed number may be loosened, and no tolerance widened", () => {
  for (const [name, floor] of Object.entries(FLOOR)) {
    if (!floor.metrics) continue;
    const spec = BASELINE.scenarios[name] ?? {};
    assert.ok(spec.metrics, `baseline.json dropped every number for ${name}`);
    assert.ok(
      spec.metricsFrom,
      `${name} has numbers with no stated source - a bar nobody can reproduce is a bar nobody trusts`,
    );
    assert.ok(
      (spec.tolerance ?? 0) <= floor.tolerance,
      `${name}'s tolerance widened to ${spec.tolerance} (floor ${floor.tolerance}) - a wider window is a lowered bar`,
    );
    for (const [metric, bar] of Object.entries(floor.metrics)) {
      const now = spec.metrics[metric];
      assert.ok(now, `baseline.json dropped ${name}.${metric}`);
      if (bar.atLeast !== undefined) {
        assert.ok(now.atLeast >= bar.atLeast, `${name}.${metric} fell to ${now.atLeast} (floor ${bar.atLeast})`);
      } else {
        assert.ok(now.atMost <= bar.atMost, `${name}.${metric} rose to ${now.atMost} (floor ${bar.atMost})`);
      }
    }
  }
});

test("the committed numbers really are the committed fixture's", () => {
  // The one thing a ratchet cannot check about itself: whether the origin the
  // baseline names actually produced these figures. `metricsFrom` points at a
  // file in this repository, so the check is cheap and the claim stops being
  // prose. Re-record the fixture and these move with it.
  const recorded = JSON.parse(readFileSync(path.join(HERE, "__fixtures__", "result-stub.json"), "utf8"));
  const busiest = (pick) => Math.max(...recorded.nights.map((n) => Number(pick(n) ?? Number.NaN)));
  const m = BASELINE.scenarios["kp-default"].metrics;
  assert.match(BASELINE.scenarios["kp-default"].metricsFrom, /result-stub\.json/);
  assert.equal(m.proposalsOpened.atLeast, busiest((n) => n.reading?.proposalsOpened));
  assert.equal(m.proposalsMerged.atLeast, busiest((n) => n.reading?.proposalsMerged));
  assert.equal(m.gatePassRate.atLeast, busiest((n) => n.reading?.gatePassRate));
  assert.equal(m.forbiddenClassViolations.atMost, busiest((n) => n.reading?.forbiddenClassViolations));
  assert.equal(m.backboneScore.atLeast, busiest((n) => n.backbone?.score));
  assert.equal(m.backboneCoverage.atLeast, busiest((n) => n.backbone?.coverage));
});
