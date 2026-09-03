// The PROVENANCE of a deterministic salary band — which benchmark dataset it was
// read off, how old that dataset is, and how many observations stand behind the
// role it came from.
//
// Why this exists: a band derived from a 2025 benchmark vintage reads identically
// today and in three years, because the vintage the data file carries never
// reached the recruiter. And two role families hand-entered with no sample behind
// them (`product_project`, `hr_people` — `source: "manual"`, no `sample_k`)
// rendered exactly like one calibrated on 838 ISPV rows. Both are the same defect:
// a figure presented with more authority than the data under it.
//
// Producer: `market_salary_cli` (`result.benchmark`), from
// `pipeline/jobfit/taxonomy.py::role_benchmark`. Consumers: the JD ledger's salary
// card and the report's salary tab.

/** Below this many observations a band is REAL but thinly evidenced — worth
 *  saying out loud rather than presenting as a market fact. Mirrors
 *  `taxonomy.THIN_SAMPLE_K`; `salary-benchmark.test.ts` reads the Python constant
 *  and fails if the two drift, because a threshold that means one thing to the
 *  producer and another to the renderer is worse than no threshold. */
export const THIN_SAMPLE_K = 30;

/**
 * A benchmark reading's provenance.
 *
 * `sampleK` is `number | null`, and `null` means **no sample was recorded**, never
 * "zero rows" — a hand-entered family has no measurement behind it, which is a
 * different claim from having measured nothing. Consumers must not do arithmetic
 * on it; they branch on {@link isThinBenchmark}.
 */
export type SalaryBenchmark = {
  /** The dataset identity, e.g. `cz-ispv-2025` (MarketConfig.benchmark_source_id). */
  sourceId: string;
  /** ISO-8601 timestamp the benchmark block was generated, or "" when the block
   *  carries none (the non-production Berlin sample). */
  asOf: string;
  /** Observations behind this role family, or null for "no sample recorded". */
  sampleK: number | null;
};

/**
 * Normalize an untrusted `benchmark` off the CLI payload (reached through
 * `parsePythonJson` and an `as` cast the runtime never checks) into a
 * {@link SalaryBenchmark}, or null when there is no usable provenance.
 *
 * Null in, null out — a grounded (live-web) band carries `benchmark: null` by
 * design, so "absent" and "not applicable" are the same render decision: say
 * nothing rather than credit the figure to a table it did not come from. A
 * payload with no `sourceId` is equally unusable: the vintage of an unnamed
 * dataset is not provenance. Idempotent, so it is safe to re-run at a render
 * boundary.
 */
export function normalizeSalaryBenchmark(value: unknown): SalaryBenchmark | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sourceId = typeof raw.sourceId === "string" ? raw.sourceId.trim() : "";
  if (!sourceId) return null;
  const asOf = typeof raw.asOf === "string" ? raw.asOf.trim() : "";
  // Only a finite POSITIVE integer count is a sample. A 0, a NaN, a boolean (which
  // would coerce to 1) or a stringified number all mean "we don't have one", and
  // rounding down a fractional count keeps "19.5 rows" from reading as 20.
  const k = raw.sampleK;
  const sampleK =
    typeof k === "number" && Number.isFinite(k) && k > 0 ? Math.floor(k) : null;
  return { sourceId, asOf, sampleK };
}

/**
 * Whether the band rests on too little data to read as a market fact: no sample
 * recorded at all, or fewer than {@link THIN_SAMPLE_K} observations. The band is
 * still the best anchor available — this gates a caveat beside it, never the
 * figure itself.
 */
export function isThinBenchmark(benchmark: SalaryBenchmark | null | undefined): boolean {
  if (!benchmark) return false;
  return benchmark.sampleK === null || benchmark.sampleK < THIN_SAMPLE_K;
}

/**
 * The vintage as a short, READER-LOCALE month+year ("Jul 2026", "čvc 2026",
 * "juil. 2026"), or "" when the block carries no `asOf` or the value does not
 * parse. Month precision, not a full date: the benchmark is a periodically
 * regenerated snapshot, and a day-precise date would imply a freshness the table
 * does not have.
 *
 * `locale` is the READER's language (the format.ts number-locale contract applied
 * to dates): this string is rendered into the recruiter's own surface, not baked
 * into a stored candidate-facing document.
 */
export function formatBenchmarkAsOf(asOf: string | null | undefined, locale?: string): string {
  if (!asOf) return "";
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(locale || "en", { year: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(ms),
    );
  } catch {
    // An unsupported locale tag from a caller is not worth failing a render over —
    // the caveat line below it is the information, the date is the decoration.
    return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ms));
  }
}

/**
 * The ACTIVE market's benchmark identity, for the one surface that has the anchor
 * but not the provenance: the report's salary tab renders an LLM estimate whose
 * deterministic pre-pass anchored it on this table (`metadata.deterministicEvidence.
 * anchorBand`), and the analysis schema carries the two numbers without saying
 * where they came from. Extending that generated schema is a cross-cutting change;
 * naming the active table here is not, because there is exactly one active market
 * and `salary-benchmark.test.ts` reads `data/salary_benchmarks.json` and
 * `pipeline/jobfit/market_config.py` and fails the moment either drifts from these
 * two strings.
 *
 * Use it ONLY where the anchor is known to come from the active table. A band that
 * travelled on the wire carries its own {@link SalaryBenchmark} and must use that.
 */
export const ACTIVE_BENCHMARK: Readonly<Pick<SalaryBenchmark, "sourceId" | "asOf">> = Object.freeze({
  sourceId: "cz-ispv-2025",
  asOf: "2026-07-05T14:31:03.797Z",
});
