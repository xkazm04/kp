import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { salaryBenchmark, SALARY_BENCHMARK_MIN_COHORT } from "./salary-benchmark.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

// The unit DB seeds the shared reference corpus (jobs with workspace_id NULL), so these
// exercise the real aggregation over real reference roles.

test("a well-populated role family yields an ordered market band from the shared corpus", () => {
  const b = salaryBenchmark({ roleFamily: "software_engineering" });
  assert.ok(b, "software_engineering has enough reference roles for a band");
  assert.ok(b!.count >= SALARY_BENCHMARK_MIN_COHORT);
  assert.equal(b!.currency, "CZK");
  assert.ok(b!.p25 <= b!.median && b!.median <= b!.p75, "percentiles are ordered p25 â‰¤ median â‰¤ p75");
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

test("the benchmark is AGGREGATE-ONLY â€” no raw salary row leaks out", () => {
  const b = salaryBenchmark({ roleFamily: "software_engineering" });
  assert.ok(b);
  assert.deepEqual(Object.keys(b!).sort(), ["count", "currency", "median", "p25", "p75", "roleFamily", "seniority"]);
});

// ---------------------------------------------------------------------------
// ADDED /perfect 2026-09-03 (match-route-answers-like-its-siblings). The tests
// above drive the SEEDED corpus, which pins the shape of a band (ordered, CZK,
// aggregate-only) but cannot pin its ARITHMETIC — the seed's midpoints are
// whatever the fixture happens to hold, so p25/median/p75 are only asserted to be
// ordered. The two properties that actually carry the feature are exact:
//
//   1. THE COHORT FLOOR. Below SALARY_BENCHMARK_MIN_COHORT the answer must be null.
//      Not just statistics: p25/median/p75 over two midpoints hands back the two
//      rows, so the floor is the anonymity guarantee. "An absent family is null"
//      above does not distinguish the floor from an empty result set.
//   2. THE PERCENTILE INTERPOLATION. A linear interpolation over the sorted
//      midpoints with a single-element short-circuit — every off-by-one in it
//      (floor vs ceil, `length` vs `length - 1`) still returns a plausible number,
//      and a wrong market rate reads exactly like a right one on screen.
//
// These build their own cohorts under private role families so the assertions are
// exact numbers rather than inequalities, and so they cannot be moved by an edit
// to the seed corpus. Also pinned here: the corpus predicate — the band reads
// workspace_id IS NULL ONLY (deliberately NOT the (IS NULL OR = ?) ownership
// predicate the rest of jobs.ts uses), so a team's own openings cannot skew "the
// market".
let seq = 0;

/** Insert a reference-corpus job (workspace_id NULL unless told otherwise) with the
 *  given band. Bypasses insertJob deliberately: the aggregate reads COLUMNS, so the
 *  fixture must set exactly those columns. */
function corpusJob(roleFamily: string, min: number, max: number, opts: { seniority?: string; workspaceId?: string } = {}): void {
  const db = ensureDb();
  const id = `sb-${++seq}`;
  db.prepare(
    `INSERT INTO jobs (id, title, seniority, role_family, salary_min, salary_max, payload_json, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `Role ${id}`, opts.seniority ?? null, roleFamily, min, max, JSON.stringify({ id }), new Date().toISOString(), opts.workspaceId ?? null);
}

test("the cohort floor: below SALARY_BENCHMARK_MIN_COHORT there is no band at all", () => {
  const rf = "sb_floor";
  assert.equal(SALARY_BENCHMARK_MIN_COHORT, 3, "the floor is part of the anonymity contract; change it deliberately");
  assert.equal(salaryBenchmark({ roleFamily: rf }), null, "an empty cohort is null, not a zero band");
  for (let i = 1; i < SALARY_BENCHMARK_MIN_COHORT; i++) {
    corpusJob(rf, 100_000, 100_000);
    assert.equal(salaryBenchmark({ roleFamily: rf }), null, `${i} role(s) is still below the floor`);
  }
  // The row that reaches the floor flips it on — and not one earlier.
  corpusJob(rf, 100_000, 100_000);
  const band = salaryBenchmark({ roleFamily: rf });
  assert.ok(band, "the floor is inclusive: exactly MIN_COHORT roles yield a band");
  assert.equal(band.count, SALARY_BENCHMARK_MIN_COHORT);
});

test("percentiles interpolate linearly over the band midpoints", () => {
  const rf = "sb_percentile";
  // Midpoints 100k, 200k, 300k, 400k, 500k (sorted length 5 → idx = 4 * p).
  for (const mid of [300_000, 100_000, 500_000, 200_000, 400_000]) corpusJob(rf, mid - 10_000, mid + 10_000);
  const band = salaryBenchmark({ roleFamily: rf });
  assert.ok(band);
  assert.equal(band.count, 5);
  assert.equal(band.p25, 200_000, "idx 1.0 lands exactly on the second midpoint");
  assert.equal(band.median, 300_000, "idx 2.0 lands exactly on the middle midpoint");
  assert.equal(band.p75, 400_000);
  assert.equal(band.currency, "CZK");
  assert.equal(band.roleFamily, rf);
  assert.equal(band.seniority, null);
});

test("percentiles interpolate BETWEEN midpoints when the index is fractional", () => {
  const rf = "sb_fractional";
  // Midpoints 100k, 200k, 300k, 400k → idx = 3 * p, so p25 = 0.75 and p75 = 2.25.
  for (const mid of [100_000, 200_000, 300_000, 400_000]) corpusJob(rf, mid, mid);
  const band = salaryBenchmark({ roleFamily: rf });
  assert.ok(band);
  // 100k + (200k-100k)*0.75 — the interpolation, not a nearest-neighbour pick.
  assert.equal(band.p25, 175_000);
  assert.equal(band.median, 250_000, "even count → the mean of the two middle midpoints");
  assert.equal(band.p75, 325_000);
});

test("a seniority narrows the cohort, and the narrowed cohort re-applies the floor", () => {
  const rf = "sb_seniority";
  for (const mid of [100_000, 200_000, 300_000]) corpusJob(rf, mid, mid, { seniority: "junior" });
  corpusJob(rf, 900_000, 900_000, { seniority: "principal" });
  const junior = salaryBenchmark({ roleFamily: rf, seniority: "junior" });
  assert.ok(junior);
  assert.equal(junior.count, 3, "the principal outlier is not in the junior band");
  assert.equal(junior.median, 200_000);
  assert.equal(junior.seniority, "junior");
  // One principal role is a cohort of 1 — below the floor, so no band.
  assert.equal(salaryBenchmark({ roleFamily: rf, seniority: "principal" }), null);
  // Unnarrowed, all four count.
  assert.equal(salaryBenchmark({ roleFamily: rf })?.count, 4);
});

test("a team's own openings never enter the market band, and neither does a bandless role", () => {
  const rf = "sb_corpus_only";
  for (const mid of [100_000, 200_000, 300_000]) corpusJob(rf, mid, mid);
  // Four authored openings for the same family at a wildly different rate: if the
  // predicate were the (IS NULL OR = ?) ownership one, this would move the median.
  for (let i = 0; i < 4; i++) corpusJob(rf, 9_000_000, 9_000_000, { workspaceId: "ws-tenant" });
  const band = salaryBenchmark({ roleFamily: rf });
  assert.ok(band);
  assert.equal(band.count, 3, "only workspace_id IS NULL rows are 'the market'");
  assert.equal(band.median, 200_000);

  // A corpus role that publishes no band is excluded rather than counted as 0 —
  // otherwise an unpriced role would drag the market rate toward zero.
  const rf2 = "sb_nullband";
  for (const mid of [100_000, 200_000, 300_000]) corpusJob(rf2, mid, mid);
  const db = ensureDb();
  db.prepare(
    `INSERT INTO jobs (id, title, role_family, salary_min, salary_max, payload_json, created_at, workspace_id)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL)`
  ).run("sb-nullband-1", "Unpriced", rf2, "{}", new Date().toISOString());
  assert.equal(salaryBenchmark({ roleFamily: rf2 })?.count, 3);
});
