// Fixtures for the bench gate (gate.mjs). Picked up by `npm run test:bench-driver`.
//
// The point of these is the DISTINCTIONS the gate has to keep: not-run is not
// the same as failed, an expectation nobody measured is not a pass, and a
// scenario nobody baselined is reported rather than silently counted as
// covered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSweep, renderGate } from "./gate.mjs";
import { listScenarioFiles } from "./scenarios.mjs";

// Read the scenario JSON raw rather than through loadScenarioFile: that helper
// expands $KP_ROOT-style repo paths against the local machine, and this check
// only cares which expectation NAMES the file declares.
const readScenario = (file) => JSON.parse(readFileSync(file, "utf8"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(readFileSync(path.join(HERE, "baseline.json"), "utf8"));

const baseline = (scenarios) => ({ recordedAt: "2026-08-26", scenarios });
const run = (scenario, { ok = true, expectations = [], finishedAt = "2026-08-26T10:00:00.000Z", failedPhase = null } = {}) => ({
  scenario,
  finishedAt,
  result: { ok, failedPhase, finishedAt, expectations, scenario: { name: scenario } },
});
const expectation = (name, ok = true) => ({ name, ok, expected: "x", actual: ok ? "x" : "y" });

test("a green sweep over the baselined scenarios passes", () => {
  const g = evaluateSweep(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { expectations: [expectation("noViolations")] })],
  );
  assert.equal(g.ok, true);
  assert.equal(g.counts.pass, 1);
});

test("a scenario the sweep never ran is MISSING, not passing", () => {
  const g = evaluateSweep(baseline({ alpha: { mustPass: true } }), []);
  assert.equal(g.ok, false);
  assert.equal(g.rows[0].verdict, "missing");
  assert.match(g.rows[0].reason, /no run for it/);
});

test("a failed expectation fails the gate and names the delta", () => {
  const g = evaluateSweep(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [run("alpha", { expectations: [expectation("noViolations", false)] })],
  );
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /noViolations: expected x, got y/);
});

test("an expectation quietly dropped from a scenario is a coverage regression", () => {
  // The run is green — but the check the baseline requires was never measured.
  // Unmeasured is not zero, and it is not a pass either.
  const g = evaluateSweep(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["probation", "noViolations"] } }),
    [run("alpha", { expectations: [expectation("noViolations")] })],
  );
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /"probation" was not measured/);
});

test("an incomplete run fails and carries its failed phase", () => {
  const g = evaluateSweep(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha", { ok: false, failedPhase: "dispatch" })],
  );
  assert.equal(g.ok, false);
  assert.match(g.rows[0].reason, /failed phase: dispatch/);
});

test("the NEWEST run per scenario wins", () => {
  const g = evaluateSweep(
    baseline({ alpha: { mustPass: true, requiredExpectations: ["noViolations"] } }),
    [
      run("alpha", { finishedAt: "2026-08-01T00:00:00.000Z", expectations: [expectation("noViolations", false)] }),
      run("alpha", { finishedAt: "2026-08-26T00:00:00.000Z", expectations: [expectation("noViolations", true)] }),
    ],
  );
  assert.equal(g.ok, true);
});

test("an unbaselined scenario is reported, not counted as covered", () => {
  const g = evaluateSweep(
    baseline({ alpha: { mustPass: true } }),
    [run("alpha"), run("newcomer")],
  );
  assert.equal(g.ok, true);
  assert.deepEqual(g.unbaselined, ["newcomer"]);
  assert.match(renderGate(g, BASELINE), /unbaselined and therefore UNGATED: newcomer/);
});

test("the banner leads with the verdict, both ways", () => {
  const green = renderGate(evaluateSweep(baseline({ a: { mustPass: true } }), [run("a")]), BASELINE);
  assert.match(green.split("\n")[0], /BENCH GATE GREEN/);
  const red = renderGate(evaluateSweep(baseline({ a: { mustPass: true } }), []), BASELINE);
  assert.match(red.split("\n")[0], /BENCH GATE RED/);
  assert.match(red, /baseline that moved on purpose/);
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
