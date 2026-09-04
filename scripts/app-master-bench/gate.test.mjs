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
const run = (scenario, { ok = true, expectations = [], finishedAt = "2026-08-26T10:00:00.000Z", failedPhase = null, stub = false } = {}) => ({
  scenario,
  finishedAt,
  result: { ok, failedPhase, finishedAt, expectations, personas: { stub }, scenario: { name: scenario } },
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
