import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { salaryBenchmark, SALARY_BENCHMARK_MIN_COHORT } from "./salary-benchmark.ts";

after(() => cleanupUnitDb());

// The unit DB seeds the shared reference corpus (jobs with workspace_id NULL), so these
// exercise the real aggregation over real reference roles.

test("a well-populated role family yields an ordered market band from the shared corpus", () => {
  const b = salaryBenchmark({ roleFamily: "software_engineering" });
  assert.ok(b, "software_engineering has enough reference roles for a band");
  assert.ok(b!.count >= SALARY_BENCHMARK_MIN_COHORT);
  assert.equal(b!.currency, "CZK");
  assert.ok(b!.p25 <= b!.median && b!.median <= b!.p75, "percentiles are ordered p25 ≤ median ≤ p75");
  assert.ok(b!.p25 > 0, "a real CZK band");
});

test("below the min-cohort floor the band is withheld (null)", () => {
  assert.equal(salaryBenchmark({ roleFamily: "no_such_role_family_xyz" }), null, "an absent role family has no reference roles");
});

test("narrowing to a seniority never widens the cohort", () => {
  const all = salaryBenchmark({ roleFamily: "software_engineering" });
  const senior = salaryBenchmark({ roleFamily: "software_engineering", seniority: "senior" });
  assert.ok(all, "the unfiltered family has a band");
  if (senior) assert.ok(senior.count <= all!.count, "the seniority-filtered cohort is a subset");
});

test("the benchmark is AGGREGATE-ONLY — no raw salary row leaks out", () => {
  const b = salaryBenchmark({ roleFamily: "software_engineering" });
  assert.ok(b);
  assert.deepEqual(Object.keys(b!).sort(), ["count", "currency", "median", "p25", "p75", "roleFamily", "seniority"]);
});
