import { APP_CURRENCY, formatSalaryRange } from "./format.ts";
import { normalizeSalaryBenchmark, type SalaryBenchmark } from "./salary-benchmark.ts";
import { NO_MARKET_BENCHMARK, type PayPeriod } from "./markets.ts";
import { bandUnitOf, isSameCurrency, normalizeCurrency, type BandUnit } from "./band-unit.ts";

// The unit primitives live in the leaf band-unit.ts (a route that only labels a band
// need not load the benchmark normalizer); re-exported so callers keep one import.
export { bandUnitOf, isSameCurrency, normalizeCurrency, type BandUnit };

// Salary-band validation shared by the JD authoring form (JdTemplates) and the
// write trust boundary (ingest-job), so the advertised JD band and the
// matchable Job's band never disagree. A valid band is two positive numbers
// with min <= max; a backwards range is corrected by swapping rather than
// dropped, and non-positive/degenerate values are rejected.
export type SalaryBand = [number, number];

// ---- Currency comparability (the salary-comparison contract) ----------------
// A role's salary band (job.salaryBand) is a bare [min, max] with NO currency of
// its own; by app-wide contract it is denominated in APP_CURRENCY (see format.ts).
// A candidate's expectation, by contrast, carries its OWN currency (LLM-extracted,
// defaulting to APP_CURRENCY when absent). The app does no FX conversion, so an
// over/under-band verdict is only meaningful when the two share a currency —
// comparing a EUR expectation against a CZK band yields a confident-but-meaningless
// "30% over". These helpers make that guard explicit and testable: the caller gates
// the verdict on `isSameCurrency`, and only feeds same-currency figures to the pure
// `salaryBandPosition` math.

// ---- A stored band's own unit (docs/architecture/markets.md) ------------------
// A role band (jobs.salary_min/max) carries the currency and pay period it was set in
// (jobs.band_currency / band_period): the workspace's market at write time, or a
// grounded band's own unit. Changing the market never relabels it. A band whose unit is
// not the workspace market's is SHOWN in its own unit with a label, never converted,
// and left out of every comparison that assumes one currency.

/** Stamp a band's unit onto a job record before `insertJob` writes it. */
export function withBandUnit<T extends object>(job: T, unit: BandUnit): T & { bandCurrency: string; bandPeriod: string } {
  return { ...job, bandCurrency: normalizeCurrency(unit.currency), bandPeriod: unit.period };
}

/** The one comparability predicate for two units: same currency AND same period. */
export function isSameBandUnit(a: BandUnit, b: BandUnit): boolean {
  return isSameCurrency(a.currency, b.currency) && a.period.trim().toLowerCase() === b.period.trim().toLowerCase();
}

/** Whether a stored band was set in another unit than `market`'s (a market change since):
 *  label it, never convert it, never compare it against figures in the market's unit. */
export function bandInOtherUnit(
  job: { bandCurrency?: string | null; bandPeriod?: string | null } | null | undefined,
  market: BandUnit
): boolean {
  return !isSameBandUnit(bandUnitOf(job), market);
}

/** The coded absence a comparison states when the role band is in another unit than the
 *  workspace market's (mirrors pipeline/jobfit/winnability.py BAND_OTHER_CURRENCY). */
export const BAND_OTHER_CURRENCY = "band_other_currency";

export type SalaryBandPosition = "over" | "under" | "within";

/**
 * Where a candidate's expectation midpoint sits relative to the role band
 * [lo, hi]: "over" the max, "under" the min, or "within", plus the percentage
 * over/under (0 for "within"). PURE math that ASSUMES the midpoint and band are
 * already in the SAME currency — cross-currency comparison is meaningless and is
 * the caller's responsibility to prevent (gate on {@link isSameCurrency} first).
 * A non-positive bound on the relevant side is treated as "no reference", so a
 * degenerate band can't manufacture a verdict.
 */
export function salaryBandPosition(
  midpoint: number,
  lo: number,
  hi: number
): { position: SalaryBandPosition; pct: number } {
  // A non-finite midpoint yields no meaningful verdict: NaN would silently fall through to
  // "within" (a positive "matches the band" claim), and Infinity would produce an
  // "Infinity% over". Treat it as no reference instead of manufacturing a verdict.
  if (!Number.isFinite(midpoint)) return { position: "within", pct: 0 };
  if (hi > 0 && midpoint > hi) return { position: "over", pct: Math.round(((midpoint - hi) / hi) * 100) };
  if (lo > 0 && midpoint < lo) return { position: "under", pct: Math.round(((lo - midpoint) / lo) * 100) };
  return { position: "within", pct: 0 };
}

/** Sanitize an untrusted [min, max] into a usable band: swap a backwards range
 *  and reject non-finite or non-positive values. Returns null when no usable
 *  band can be formed, so callers fall back instead of advertising garbage. */
export function normalizeSalaryBand(min: unknown, max: unknown): SalaryBand | null {
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;
  return min <= max ? [min, max] : [max, min];
}

/**
 * Pin a job's matchable band to the GROUNDED one (the market analysis the JD was
 * built with) across a (re-)parse of its wording. The JD's salary band is
 * AI-fixed by contract (docs/features/jobs/README.md § "The salary band is
 * AI-fixed"): it carries the analysis's provenance, confidence and sources, so a
 * figure hand-typed into the markdown must NOT become the band the Pipeline
 * matches against. `normalize_job` (jobs.py) stamps a taxonomy anchor and flags it
 * as the "salary_band" phantom when the text states no pay; the grounded band IS
 * the pay this JD advertises, so that marker is dropped with it.
 *
 * Shared by the builder's first ingest (`ingestStructuredJob`) and the
 * edit-time re-sync (PATCH /api/jds/[slug]), which parses the edited markdown
 * through `ingestJobAd` and would otherwise upsert the parsed figure — or the
 * anchor phantom — straight over the analysis. A `null` band (no analysis, e.g.
 * a pasted JD) leaves the parsed record untouched: for those the wording is the
 * only source there is.
 */
export function withGroundedBand<T extends { salaryBand?: number[]; defaultedFields?: string[] }>(
  job: T,
  band: SalaryBand | null
): T {
  if (!band) return job;
  return { ...job, salaryBand: band, defaultedFields: (job.defaultedFields ?? []).filter((f) => f !== "salary_band") };
}

/** The grounded band stored on a JD row (`jds.analysis_json.salary`, the
 *  `market_salary_cli` result the build persisted), or null when the row carries
 *  no usable band — no analysis ran, the CLI's 0–0 taxonomy miss, or a keyless
 *  build with no band. Tolerates a missing/malformed JSON string. */
export function groundedJdBand(analysisJson: string | null | undefined): SalaryBand | null {
  if (!analysisJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(analysisJson);
  } catch {
    return null;
  }
  const salary = parsed && typeof parsed === "object" ? (parsed as { salary?: unknown }).salary : undefined;
  const s = normalizeMarketSalary(salary);
  return s.available ? [s.suggestedMinimum, s.suggestedMaximum] : null;
}

/** The unit of the grounded band on a JD row (the build's own currency and period), or
 *  null when there is no usable band. The re-sync stamps THIS, not the current market:
 *  a band researched in CZK stays CZK after the workspace moves to another market. */
export function groundedJdUnit(analysisJson: string | null | undefined): BandUnit | null {
  if (!groundedJdBand(analysisJson)) return null;
  return marketSalaryUnit((JSON.parse(analysisJson as string) as { salary?: unknown }).salary);
}

/** The unit of a `market_salary_cli` band as the build produced it (its own currency and
 *  period), or null when it holds no usable band. The builder's FIRST ingest stamps this,
 *  the same rule as the re-sync's {@link groundedJdUnit}. */
export function marketSalaryUnit(payload: unknown): BandUnit | null {
  const s = normalizeMarketSalary(payload);
  return s.available ? { currency: s.currency, period: s.period } : null;
}

// The grounded market-salary band the JD builder renders and persists, as
// produced by `market_salary_cli`. This is the canonical shape — `jd-build-run`
// (server) and the Ledger detail's SalaryCard (client) both import it instead of
// redeclaring it, so the producer and the renderer can't drift.
//
// `available` is the trust-boundary discriminant: the CLI result reaches us via
// `parsePythonJson` and a lying `as` cast, so any field may be missing, NaN, the
// wrong type, or the CLI's degenerate 0–0 taxonomy miss. When no usable band can
// be formed, `available` is false and the band numbers are zeroed — consumers
// branch on that one flag to show a "salary unavailable" fallback instead of
// crashing on `undefined` or advertising a bogus "0–N" range.
export type MarketSalary = {
  available: boolean;
  suggestedMinimum: number;
  suggestedMaximum: number;
  currency: string;
  confidence: string;
  summary: string;
  /**
   * Where the band came from, when the CLI read it off the internal benchmark
   * table: `{sourceId, asOf, sampleK}` (see salary-benchmark.ts). `null` for a
   * GROUNDED band — the model read live web evidence, and stamping the 2025
   * table's vintage on that would credit the figure to a dataset it never came
   * from — and for any payload predating this field, which is the same render
   * decision: say nothing about provenance.
   */
  benchmark: SalaryBenchmark | null;
  /** The pay period the band is per. The CLI omits it for the legacy `month`. */
  period: PayPeriod;
  /** `no_market_benchmark` when the workspace's market has no benchmark table: the
   *  0–0 band is then a stated refusal, not a taxonomy miss. */
  absence: typeof NO_MARKET_BENCHMARK | null;
};

/**
 * The grounded market band rendered into a JD's salary line — the SINGLE
 * derivation shared by the AI-default body (`composeMarkdown`, server) and the
 * template-filled body (`JdBuilder`, client) so the two paths can't advertise the
 * same role's salary differently (same band, currency, and monthly period).
 * Returns "" for an unavailable band, so the AI path omits the line and the
 * template slot renders blank.
 *
 * `locale` is the POSTING's language (the JD build's `lang`), not the recruiter's
 * UI language: this string is baked into a stored document a candidate reads, so
 * its digit grouping must match the language the rest of that document is written
 * in — the same rule jobsMarkdown.ts states for `numberLocale`. Defaults to
 * English with the rest of format.ts.
 */
export function marketSalaryLabel(s: MarketSalary, locale?: string): string {
  return s.available
    ? formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency, period: s.period, locale })
    : "";
}

function coerceString(value: unknown, fallback: string): string {
  // Return the TRIMMED value — the gate already requires non-blank, but the old code
  // returned the raw string, so a padded " CZK " currency persisted/rendered with whitespace.
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Normalize an untrusted market-salary payload (the `market_salary_cli` result,
 * reached through `parsePythonJson` and an `as` cast that the runtime never
 * checks) into a render-safe {@link MarketSalary}. The band is validated through
 * {@link normalizeSalaryBand}: a usable [min, max] sets `available: true`;
 * anything else — a missing/NaN/non-positive/irreparably-backwards band, the
 * CLI's 0–0 taxonomy miss, or a non-object payload — zeroes the band and sets
 * `available: false`. The string fields are coerced so a non-string
 * currency/confidence/summary can never reach `toLocaleString`/JSX as
 * `undefined`. Idempotent: re-normalizing an already-normalized value is a no-op,
 * so it's safe to re-run defensively at a render boundary.
 */
export function normalizeMarketSalary(payload: unknown): MarketSalary {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const band = normalizeSalaryBand(p.suggestedMinimum, p.suggestedMaximum);
  return {
    available: band !== null,
    suggestedMinimum: band ? band[0] : 0,
    suggestedMaximum: band ? band[1] : 0,
    // Fall back to the app-wide currency (the salary-comparison contract's denomination),
    // not a hardcoded "CZK" literal that silently mislabels bands if APP_CURRENCY ever changes.
    currency: coerceString(p.currency, APP_CURRENCY),
    // Conservative defaults: an absent confidence reads "low", never a confident
    // claim the payload didn't actually make.
    confidence: coerceString(p.confidence, "low"),
    summary: coerceString(p.summary, ""),
    // Provenance is only ever ADDED by the producer, never inferred here: an
    // unusable or absent `benchmark` normalizes to null so the renderer stays
    // silent rather than naming a dataset it is guessing at.
    benchmark: normalizeSalaryBenchmark(p.benchmark),
    period: p.period === "year" || p.period === "hour" ? p.period : "month",
    absence: p.absence === NO_MARKET_BENCHMARK ? NO_MARKET_BENCHMARK : null,
  };
}
