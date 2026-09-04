// Executing coverage for the goal pill's verdict, and for the two things the stat
// cluster owes its figures: the shared STAT_VALUE recipe and locale grouping.
//
// The bar: an unmeasured figure is GREY. The pill carries no verdict word, so a moss
// pill beside a "—" says a goal was cleared by a cohort that produced no hires.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { timeToHireGoalChip } from "./statGoalChip";

const HERE = path.join(process.cwd(), "app", "features", "insights", "analytics");
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8").replace(/\r\n/g, "\n");

test("no goal set means no pill at all", () => {
  assert.equal(timeToHireGoalChip(24, null, "goal 30 d"), undefined);
  assert.equal(timeToHireGoalChip(null, null, "goal 30 d"), undefined);
});

test("an unmeasured window is grey — NOT met", () => {
  const chip = timeToHireGoalChip(null, 30, "goal 30 d");
  assert.deepEqual(chip, { text: "goal 30 d", missed: null });
  assert.notEqual(chip?.missed, false, "false paints the met colour over a figure that does not exist");
});

test("over the goal is missed, at or under it is met", () => {
  assert.equal(timeToHireGoalChip(31, 30, "g")?.missed, true);
  assert.equal(timeToHireGoalChip(30, 30, "g")?.missed, false, "landing exactly on the goal met it");
  assert.equal(timeToHireGoalChip(12, 30, "g")?.missed, false);
});

test("a zero average is a measurement, not a missing one", () => {
  // Same-day hires are real; `average == null` is the only unmeasured state.
  assert.equal(timeToHireGoalChip(0, 30, "g")?.missed, false);
});

test("the cluster reads the fold and grouped figures, not raw numbers", () => {
  const cluster = read("AnalyticsStatCluster.tsx");
  assert.match(cluster, /timeToHireGoalChip\(/, "the grey rule must not be re-typed into the JSX");
  assert.match(cluster, /useNumberFormat\(\)/, "figures are grouped in the reader's locale");
  assert.doesNotMatch(cluster, /value=\{data\.total\}/, "a bare number prints 45000, not 45 000 / 45,000");
});

test("the stat tile composes the STAT_VALUE recipe", () => {
  const stat = read("AnalyticsStat.tsx");
  assert.match(stat, /\bSTAT_VALUE\b/, "the value voice is a recipe, so a restyle follows here");
  assert.doesNotMatch(stat, /className="font-serif text-h2/, "…and is not re-typed beside it (that copy also lost `nums`)");
});
