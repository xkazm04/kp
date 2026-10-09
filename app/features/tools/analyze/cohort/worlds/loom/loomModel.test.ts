import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CohortView } from "../../cohortTypes.ts";
import { bindingOf, knotOf, landedCount, noiseGroup, orderMembers, passesBehind, rowReading, rowsOf, threadsOf } from "./loomModel.ts";

const load = (kind: "done" | "running"): CohortView =>
  JSON.parse(readFileSync(new URL(`../../../../../../../public/dev/cohort/cohort20.${kind}.json`, import.meta.url), "utf8")) as CohortView;

test("neutral order follows the recorded shuffle; fit order puts the unrated last", () => {
  const view = load("done");
  const neutral = orderMembers(view.members, "neutral");
  assert.deepEqual(neutral.map((m) => m.neutralIndex), [...Array(20).keys()]);
  const fit = orderMembers(view.members, "fit");
  assert.equal(fit[0].fitRank, 1);
  assert.deepEqual(fit.slice(-2).map((m) => m.fitRank), [null, null]);
  for (let i = 1; i < 18; i++) assert.ok((fit[i - 1].fitRank as number) <= (fit[i].fitRank as number));
});

test("threads: decoys hang slack, the narrative's members continue into the cloth, no selvedge inside the noise", () => {
  const view = load("done");
  const threads = threadsOf(view, "neutral");
  assert.equal(threads.length, 20);
  assert.deepEqual(threads.map((t) => t.col), [...Array(20).keys()]);
  const slack = threads.filter((t) => t.slack).map((t) => t.member.label).sort();
  assert.deepEqual(slack, ["Gabriela Černá", "Jan Mareš"]);
  assert.equal(threads.filter((t) => t.covered).length, 6);
  assert.equal(threads.some((t) => t.selvedge), false, "overall is insideNoise: no thread may wear the selvedge");
  assert.deepEqual(threads.filter((t) => t.state === "failed").map((t) => t.member.label).sort(), ["Hana Černá", "Štěpán Procházka"]);
});

test("a clearing overall claim gives its leader, and only its leader, the selvedge", () => {
  const view = load("done");
  const cleared: CohortView = { ...view, claims: { ...view.claims, overall: { leader: "analysis-cand-000", separation: "clears", robustness: "stable" } } };
  const marked = threadsOf(cleared, "fit").filter((t) => t.selvedge);
  assert.deepEqual(marked.map((t) => t.member.memberId), ["analysis-cand-000"]);
});

test("rows: fit is a float of the two whose bands overlap, public work clears, salary never leads", () => {
  const view = load("done");
  const fit = rowReading(view, "fit");
  assert.equal(fit.kind, "insideNoise");
  assert.deepEqual(fit.kind === "insideNoise" ? fit.noise : [], ["analysis-cand-000", "analysis-cand-040"]);
  assert.deepEqual(rowReading(view, "publicWork"), { kind: "clears", leader: "analysis-cand-000" });
  const salary = rowReading(view, "salary");
  assert.equal(salary.kind, "neverLeads");
  assert.deepEqual(salary.kind === "neverLeads" ? salary.partitions : null, [{ key: "CZK/month", count: 16 }, { key: "EUR/month", count: 2 }]);
  assert.equal(rowsOf(view).length, 7);
});

test("insideNoise and clears bind knots differently; belowFloor binds none", () => {
  assert.equal(bindingOf({ kind: "clears", leader: "a" }, "a"), "stitch");
  assert.equal(bindingOf({ kind: "clears", leader: "a" }, "b"), null);
  assert.equal(bindingOf({ kind: "insideNoise", noise: ["a", "b"] }, "b"), "float");
  assert.equal(bindingOf({ kind: "belowFloor" }, "a"), null);
  assert.equal(bindingOf({ kind: "neverLeads", partitions: null }, "a"), null);
});

test("a belowFloor claim draws no float even when two members are rated", () => {
  const view = load("done");
  const thin: CohortView = {
    ...view,
    claims: { ...view.claims, byDimension: { ...view.claims.byDimension, skills: { dimension: "skills", leader: null, separation: "belowFloor", rated: 1 } } },
  };
  assert.deepEqual(rowReading(thin, "skills"), { kind: "belowFloor" });
});

test("noise group: default bands of +/- 6 around unbanded ratings, ties included", () => {
  const view = load("done");
  const skills = noiseGroup(view.members, "skills");
  // three members at 100 and nobody within 6 below the top's floor of 94
  assert.deepEqual([...skills].sort(), ["analysis-cand-000", "analysis-cand-016", "analysis-cand-040"]);
});

test("knots: absent is its own tier with a reason, never a zero; pending is drawn whole", () => {
  const view = load("running");
  const pending = view.members.find((m) => m.runState === "queued")!;
  const k = knotOf(pending.cells.fit);
  assert.deepEqual(k, { kind: "absent", reason: "pending", mark: "spinning" });
  assert.equal(passesBehind(pending.cells.fit), false);
  const done = load("done");
  const mares = done.members.find((m) => m.label === "Jan Mareš")!;
  assert.deepEqual(knotOf(mares.cells.publicWork), { kind: "absent", reason: "noLink", mark: "na" });
  assert.equal(passesBehind(mares.cells.publicWork), true);
  const klara = done.members.find((m) => m.memberId === "analysis-cand-000")!;
  assert.deepEqual(knotOf(klara.cells.publicWork), { kind: "rated", tier: "strong", rating: 85, comment: true });
  const sykora = done.members.find((m) => m.label === "Filip Sýkora")!;
  assert.deepEqual(knotOf(sykora.cells.salary), { kind: "absent", reason: "currencyMismatch", mark: "apart" });
});

test("the running cohort keeps every member in its column (landing never reflows in neutral order)", () => {
  const running = load("running");
  const done = load("done");
  const cols = (v: CohortView) => threadsOf(v, "neutral").map((t) => t.member.memberId);
  assert.deepEqual(cols(running), cols(done));
  assert.equal(landedCount(running), 7);
  assert.equal(threadsOf(running, "neutral").filter((t) => t.state === "pending").length, 12);
});
