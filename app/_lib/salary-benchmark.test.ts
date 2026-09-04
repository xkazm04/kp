// The benchmark-provenance helper, plus the two cross-language pins that keep it
// honest: the thin-sample threshold and the active benchmark identity are both
// stated in Python first, and a TS copy that drifts from them is a surface
// confidently naming the wrong dataset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVE_BENCHMARK,
  THIN_SAMPLE_K,
  formatBenchmarkAsOf,
  isThinBenchmark,
  normalizeSalaryBenchmark,
} from "./salary-benchmark.ts";

const MEASURED = { sourceId: "cz-ispv-2025", asOf: "2026-07-05T14:31:03.797Z", sampleK: 838 };

test("normalizeSalaryBenchmark keeps a well-formed provenance record", () => {
  assert.deepEqual(normalizeSalaryBenchmark(MEASURED), MEASURED);
});

test("normalizeSalaryBenchmark returns null for the grounded band's explicit null", () => {
  // A live-web band is not credited to the table; absent and not-applicable are
  // the same render decision.
  assert.equal(normalizeSalaryBenchmark(null), null);
  assert.equal(normalizeSalaryBenchmark(undefined), null);
});

test("normalizeSalaryBenchmark rejects provenance with no dataset name", () => {
  // The vintage of an unnamed dataset is not provenance.
  assert.equal(normalizeSalaryBenchmark({ asOf: "2026-07-05T00:00:00Z", sampleK: 400 }), null);
  assert.equal(normalizeSalaryBenchmark({ sourceId: "   ", asOf: "2026-07-05T00:00:00Z" }), null);
  assert.equal(normalizeSalaryBenchmark({ sourceId: 5 }), null);
  assert.equal(normalizeSalaryBenchmark("cz-ispv-2025"), null);
});

test("normalizeSalaryBenchmark reads a missing sample as null, never as zero rows", () => {
  // The hand-entered families (product_project, hr_people) have no sample_k at all.
  for (const k of [undefined, null, 0, -3, NaN, Infinity, "838", true]) {
    assert.equal(normalizeSalaryBenchmark({ sourceId: "cz-ispv-2025", sampleK: k })?.sampleK, null, String(k));
  }
  assert.equal(normalizeSalaryBenchmark({ sourceId: "cz-ispv-2025", sampleK: 19.5 })?.sampleK, 19);
});

test("normalizeSalaryBenchmark tolerates a missing vintage rather than inventing one", () => {
  // The de-berlin sample block carries no generated_at.
  assert.equal(normalizeSalaryBenchmark({ sourceId: "de-berlin-sample" })?.asOf, "");
  assert.equal(normalizeSalaryBenchmark({ sourceId: "de-berlin-sample", asOf: 20260705 })?.asOf, "");
});

test("normalizeSalaryBenchmark is idempotent at a render boundary", () => {
  const once = normalizeSalaryBenchmark(MEASURED);
  assert.deepEqual(normalizeSalaryBenchmark(once), once);
});

test("isThinBenchmark flags a no-sample family and a thin one, not a measured one", () => {
  assert.equal(isThinBenchmark(MEASURED), false, "838 ISPV rows is not thin");
  assert.equal(isThinBenchmark({ ...MEASURED, sampleK: null }), true, "hand-entered: no sample");
  assert.equal(isThinBenchmark({ ...MEASURED, sampleK: 19 }), true, "life_sciences_research: 19 rows");
  assert.equal(isThinBenchmark({ ...MEASURED, sampleK: THIN_SAMPLE_K }), false, "the threshold itself is not thin");
  // No provenance at all is not a thin-data claim — it is no claim.
  assert.equal(isThinBenchmark(null), false);
});

test("formatBenchmarkAsOf renders month precision in the reader's language", () => {
  assert.match(formatBenchmarkAsOf(MEASURED.asOf, "en"), /2026/);
  assert.notEqual(formatBenchmarkAsOf(MEASURED.asOf, "cs"), formatBenchmarkAsOf(MEASURED.asOf, "en"));
  // No day: the table is a periodic snapshot, and a day-precise date implies a
  // freshness it does not have.
  assert.doesNotMatch(formatBenchmarkAsOf(MEASURED.asOf, "en"), /\b5\b/);
});

test("formatBenchmarkAsOf renders nothing rather than an Invalid Date", () => {
  for (const v of ["", null, undefined, "not-a-date"]) assert.equal(formatBenchmarkAsOf(v, "en"), "");
});

test("formatBenchmarkAsOf survives a bogus locale tag", () => {
  assert.match(formatBenchmarkAsOf(MEASURED.asOf, "not a locale"), /2026/);
});

test("THIN_SAMPLE_K mirrors taxonomy.THIN_SAMPLE_K", () => {
  const py = readFileSync(new URL("../../pipeline/jobfit/taxonomy.py", import.meta.url), "utf8");
  const match = /^THIN_SAMPLE_K\s*=\s*(\d+)$/m.exec(py);
  assert.ok(match, "could not find THIN_SAMPLE_K in pipeline/jobfit/taxonomy.py");
  assert.equal(THIN_SAMPLE_K, Number(match[1]), "the thin-sample threshold drifted between Python and TS");
});

test("ACTIVE_BENCHMARK names the active market's real dataset and vintage", () => {
  const cfg = readFileSync(new URL("../../pipeline/jobfit/market_config.py", import.meta.url), "utf8");
  // The ACTIVE market is the one ACTIVE_MARKET resolves to; both shipped configs
  // name their benchmark_source_id literally.
  assert.ok(
    cfg.includes(`benchmark_source_id="${ACTIVE_BENCHMARK.sourceId}"`),
    `no MarketConfig declares benchmark_source_id=${ACTIVE_BENCHMARK.sourceId}`,
  );
  const benchmarks = JSON.parse(readFileSync(new URL("../../data/salary_benchmarks.json", import.meta.url), "utf8"));
  const block = benchmarks.markets?.cz;
  assert.ok(block, "data/salary_benchmarks.json lost its 'cz' market block");
  assert.equal(
    block.generated_at,
    ACTIVE_BENCHMARK.asOf,
    "the cz benchmark block was regenerated — update ACTIVE_BENCHMARK.asOf in salary-benchmark.ts",
  );
});
