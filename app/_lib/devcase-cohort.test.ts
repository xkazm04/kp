import { test } from "node:test";
import assert from "node:assert/strict";
import { probeMissHeatmap } from "./devcase-cohort.ts";

const probes = [
  { id: "p1", kind: "ambiguity", where: "task 1", reveals: "clarify vs assume" },
  { id: "p2", kind: "legacy_trap", where: "task 2", reveals: "read vs break" },
];

const sub = (outcomes: { probeId: string; detected: boolean; handledWell: boolean }[]) => ({
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

test("probes without an id are skipped (can't be matched to an outcome)", () => {
  const h = probeMissHeatmap([{ kind: "ambiguity" }, { id: "p1" }], [sub([{ probeId: "p1", detected: false, handledWell: false }])]);
  assert.deepEqual(h.cells.map((c) => c.probeId), ["p1"]);
});
