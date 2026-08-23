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
import { backboneFromRollup, backboneScore, hasBackboneFields } from "./backbone.ts";
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
