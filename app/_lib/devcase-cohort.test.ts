import { test } from "node:test";
import assert from "node:assert/strict";
import { probeMissHeatmap } from "./devcase-cohort.ts";

const probes = [
  { id: "p1", kind: "ambiguity", where: "task 1", reveals: "clarify vs assume" },
  { id: "p2", kind: "legacy_trap", where: "task 2", reveals: "read vs break" },
];

const sub = (outcomes: { probeId: string; detected: boolean; handledWell: boolean | null }[]) => ({
  evaluation: { tooling: { probeOutcomes: outcomes } },
});

test("aggregates detect/handle rates per probe across the cohort", () => {
  const h = probeMissHeatmap(probes, [
    sub([
      { probeId: "p1", detected: true, handledWell: true },
      { probeId: "p2", detected: false, handledWell: false },
    ]),
    sub([
      { probeId: "p1", detected: true, handledWell: false },
      { probeId: "p2", detected: false, handledWell: false },
    ]),
  ]);
  assert.equal(h.submissionCount, 2);
  assert.equal(h.evaluatedCount, 2);
  const p1 = h.cells.find((c) => c.probeId === "p1")!;
  assert.equal(p1.evaluated, 2);
  assert.equal(p1.detected, 2);
  assert.equal(p1.missRate, 0); // both detected
  assert.equal(p1.weakRate, 0.5); // one handled well, one not
  const p2 = h.cells.find((c) => c.probeId === "p2")!;
  assert.equal(p2.missRate, 1); // nobody detected p2 — the miscalibration signal
  assert.equal(p2.weakRate, 1);
});

test("cells follow the case's declared probe order", () => {
  const h = probeMissHeatmap(probes, [sub([{ probeId: "p2", detected: true, handledWell: true }])]);
  assert.deepEqual(h.cells.map((c) => c.probeId), ["p1", "p2"]);
});

test("a probe no submission was scored against has null rates, not 0%", () => {
  const h = probeMissHeatmap(probes, [sub([{ probeId: "p1", detected: true, handledWell: true }])]);
  const p2 = h.cells.find((c) => c.probeId === "p2")!;
  assert.equal(p2.evaluated, 0);
  assert.equal(p2.missRate, null);
  assert.equal(p2.weakRate, null);
});

test("unevaluated submissions count in the roster but not in evaluatedCount", () => {
  const h = probeMissHeatmap(probes, [
    sub([{ probeId: "p1", detected: true, handledWell: true }]),
    { evaluation: null },
    { evaluation: { tooling: { probeOutcomes: [] } } },
  ]);
  assert.equal(h.submissionCount, 3);
  assert.equal(h.evaluatedCount, 1);
});

// The observed Live Work Surface path emits handledWell=null BY DESIGN (it can see the
// candidate worked the probe's area, but cannot grade the handling — process_events.py,
// and DevTypes' "consumers must treat null as unknown, not failed"). Counting those as
// not-handled-well reported every in-product cohort as 100 % weak on every probe: an
// adverse finding about real candidates manufactured from an assessment that never ran.
test("ungraded (null) handling is unknown, not weak — the observed path is not scored as a failure", () => {
  const h = probeMissHeatmap(probes, [
    sub([{ probeId: "p1", detected: true, handledWell: null }]),
    sub([{ probeId: "p1", detected: true, handledWell: null }]),
  ]);
  const p1 = h.cells.find((c) => c.probeId === "p1")!;
  assert.equal(p1.evaluated, 2);
  assert.equal(p1.missRate, 0); // detection IS observable, and both worked the area
  assert.equal(p1.graded, 0);
  assert.equal(p1.weakRate, null); // pre-fix: 1 — "the whole cohort handled it badly"
});

test("weakRate is computed over the graded subset only", () => {
  const h = probeMissHeatmap(probes, [
    sub([{ probeId: "p1", detected: true, handledWell: true }]),
    sub([{ probeId: "p1", detected: true, handledWell: false }]),
    sub([{ probeId: "p1", detected: true, handledWell: null }]), // no signal — out of the denominator
  ]);
  const p1 = h.cells.find((c) => c.probeId === "p1")!;
  assert.equal(p1.evaluated, 3);
  assert.equal(p1.graded, 2);
  assert.equal(p1.weakRate, 0.5); // pre-fix: 2/3 — the ungraded one counted as weak
});

// The keyless / fallback tooling template stamps every probe detected:false,
// handledWell:false ("insufficient signal (deterministic)"). Counting those rows is a
// 100 %-miss verdict manufactured from the absence of an API key — and the studio
// panel reads a whole-cohort miss as "this case is miscalibrated".
test("deterministic-fallback tooling is not an assessment — it never counts toward the cohort rates", () => {
  const deterministic = {
    evaluation: {
      perStepSources: { tooling: "deterministic" },
      tooling: { probeOutcomes: [{ probeId: "p1", detected: false, handledWell: false }] },
    },
  };
  const alone = probeMissHeatmap(probes, [deterministic, deterministic]);
  assert.equal(alone.submissionCount, 2); // still on the roster
  assert.equal(alone.evaluatedCount, 0); // …but nothing was actually assessed
  assert.equal(alone.cells.find((c) => c.probeId === "p1")!.missRate, null); // pre-fix: 1

  // …and it does not drag a real assessment's rate down either.
  const mixed = probeMissHeatmap(probes, [
    { evaluation: { perStepSources: { tooling: "llm" }, tooling: { probeOutcomes: [{ probeId: "p1", detected: true, handledWell: true }] } } },
    deterministic,
  ]);
  const p1 = mixed.cells.find((c) => c.probeId === "p1")!;
  assert.equal(p1.evaluated, 1);
  assert.equal(p1.missRate, 0); // pre-fix: 0.5
});

test("probes without an id are skipped (can't be matched to an outcome)", () => {
  const h = probeMissHeatmap([{ kind: "ambiguity" }, { id: "p1" }], [sub([{ probeId: "p1", detected: false, handledWell: false }])]);
  assert.deepEqual(h.cells.map((c) => c.probeId), ["p1"]);
});
