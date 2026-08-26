// Parity: the TypeScript backbone scorer must reproduce the PYTHON one exactly.
//
// `app/_lib/app-master/backbone.ts` exists because the roster renders a verdict
// for every App-master row on every read and a subprocess per row is not an
// option — but the rubric's authority is `pipeline/jobfit/appmaster.py`. The
// fixtures under `__fixtures__/` were WRITTEN BY that Python function
// (`__fixtures__/generate.py`), so this file pins the port to the authority
// rather than to itself: change either side and these assertions fail.
//
// Both a deep-equality check (exact floats, exact booleans, exact null vs 0) and
// a canonical-JSON string check (nothing extra, nothing missing) run per fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { backboneFromRollup, backboneScore, hasBackboneFields, kpiMoved } from "./backbone.ts";
import type { PerformanceBackbone } from "../schemas.generated.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

type Fixture = { backbone: PerformanceBackbone; expected: Record<string, unknown> };

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(HERE, "__fixtures__", `backbone-${name}.json`), "utf8")) as Fixture;
}

/** Key-order-independent, value-exact serialization for the string comparison. */
function canonical(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
}

for (const name of ["pass", "incomplete", "fail"]) {
  test(`backbone parity: the TS port reproduces the Python score for the "${name}" fixture`, () => {
    const { backbone, expected } = fixture(name);
    const actual = backboneScore(backbone);
    assert.deepStrictEqual(actual as unknown, expected, "every rule, gate, weight and float must match");
    assert.equal(canonical(actual), canonical(expected), "…and nothing may be added or dropped");
  });
}

test("backbone: the three fixtures really do cover the three verdicts", () => {
  assert.equal(backboneScore(fixture("pass").backbone).verdict, "pass");
  assert.equal(backboneScore(fixture("incomplete").backbone).verdict, "incomplete");
  assert.equal(backboneScore(fixture("fail").backbone).verdict, "fail");
});

test("backbone: unmeasured is not zero — a withheld rule leaves the DENOMINATOR", () => {
  const { backbone } = fixture("incomplete");
  const score = backboneScore(backbone);
  // Five of six rules had no reading, so only `ledger` scored — and it scored
  // full marks. A naive implementation that read "no reading" as 0 would report
  // 0.05 here; one that averaged over 6 rules would report 0.83. Neither is
  // honest: the truth is "the one thing we could read looked fine, and we could
  // read almost nothing", which is score 1.0 at coverage 0.05.
  assert.equal(score.score, 1);
  assert.equal(score.coverage, 0.05);
  assert.equal(score.scoredWeight, 5);
  assert.deepEqual(score.unmeasured, ["delivery", "durability", "gates", "objectives", "budget"]);
  assert.equal(score.verdict, "incomplete", "a 1.0 over 5% of the weight is never a pass");
});

test("backbone: a forbidden-class violation fails the verdict, it is not averaged away", () => {
  const { backbone } = fixture("pass");
  const violated = backboneScore({ ...backbone, forbiddenClassViolations: 1 });
  assert.equal(violated.verdict, "fail");
  assert.equal(violated.score, backboneScore(backbone).score, "the weighted score is untouched — the GATE failed");
  assert.equal(violated.gates.find((g) => g.gate === "forbidden_classes")?.passed, false);
});

// kpiMoved is exported because the roster renders the SAME judgment per objective
// that backboneScore computes — two answers to "did this KPI move" on one screen
// is one too many. These tests pin its branch-by-branch contract directly.

const delta = (
  overrides: Partial<{ measured: boolean; current: number | null; target: number | null; baseline: number | null; direction: "gte" | "lte" }>
) => ({
  kpiKey: "gate_pass_rate",
  windowDays: 60,
  measured: true,
  current: 80,
  target: 95,
  baseline: 70,
  direction: "gte" as const,
  ...overrides,
});

test("kpiMoved: unmeasured delta is always null", () => {
  assert.equal(kpiMoved(delta({ measured: false })), null);
});

test("kpiMoved: null current or null target yields null", () => {
  assert.equal(kpiMoved(delta({ current: null })), null);
  assert.equal(kpiMoved(delta({ target: null })), null);
});

test("kpiMoved: gte — current at or above target", () => {
  assert.equal(kpiMoved(delta({ current: 95, target: 95 })), true, "at target");
  assert.equal(kpiMoved(delta({ current: 100, target: 95 })), true, "above target");
});

test("kpiMoved: gte — below target, no baseline → false (cannot confirm movement)", () => {
  assert.equal(kpiMoved(delta({ current: 80, target: 95, baseline: null })), false);
});

test("kpiMoved: gte — below target, current higher than baseline → true (moving right)", () => {
  assert.equal(kpiMoved(delta({ current: 85, target: 95, baseline: 80 })), true);
});

test("kpiMoved: gte — below target, current equal to baseline → false (stalled)", () => {
  assert.equal(kpiMoved(delta({ current: 80, target: 95, baseline: 80 })), false);
});

test("kpiMoved: gte — below target, current lower than baseline → false (regressed)", () => {
  assert.equal(kpiMoved(delta({ current: 75, target: 95, baseline: 80 })), false);
});

test("kpiMoved: lte — current at or below target", () => {
  assert.equal(kpiMoved(delta({ direction: "lte", current: 5, target: 10, baseline: null })), true, "below target");
  assert.equal(kpiMoved(delta({ direction: "lte", current: 10, target: 10, baseline: null })), true, "at target");
});

test("kpiMoved: lte — above target, no baseline → false", () => {
  assert.equal(kpiMoved(delta({ direction: "lte", current: 15, target: 10, baseline: null })), false);
});

test("kpiMoved: lte — above target, current lower than baseline → true (improving)", () => {
  assert.equal(kpiMoved(delta({ direction: "lte", current: 12, target: 10, baseline: 15 })), true);
});

test("kpiMoved: lte — above target, current higher than baseline → false (regressed)", () => {
  assert.equal(kpiMoved(delta({ direction: "lte", current: 18, target: 10, baseline: 15 })), false);
});

test("backboneFromRollup: a pre-v2 rollup is not a perfect $0 window", () => {
  assert.equal(hasBackboneFields({ runs: 4, successes: 4 }), false, "a v1 rollup carries no backbone reading");
  assert.equal(hasBackboneFields({ runs: 4, proposalsOpened: 2 }), true);
  assert.equal(hasBackboneFields(null), false);

  // No budget numbers at all ⇒ unmeasured, so the budget rule is withheld rather
  // than scoring "spent nothing, perfect adherence".
  const silent = backboneFromRollup({ proposalsOpened: 3, proposalsMerged: 3 });
  assert.equal(silent.budgetUnmeasured, true);
  assert.equal(silent.gatePassRate, null, "an unreported gate rate is no reading, not 0%");
  assert.equal(silent.ledgerConsistent, true, "an unreported ledger is not an accusation");
  assert.ok(backboneScore(silent).unmeasured.includes("budget"));

  // A reported $0 spend against a reservation IS a reading.
  const metered = backboneFromRollup({ budgetReservedUsd: 40, budgetSettledUsd: 0 });
  assert.equal(metered.budgetUnmeasured, false);

  // Garbage crossing the JSON boundary degrades to counts, never to NaN.
  const junk = backboneFromRollup({ proposalsOpened: -4, proposalsMerged: "x", gatePassRate: "nope", kpiDeltas: 7 });
  assert.deepEqual(
    { o: junk.proposalsOpened, m: junk.proposalsMerged, g: junk.gatePassRate, k: junk.kpiDeltas },
    { o: 0, m: 0, g: null, k: [] }
  );
});
