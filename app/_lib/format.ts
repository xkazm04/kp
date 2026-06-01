// Presentation layer: the single place every number and label passes through
// before it reaches the UI, so figures share one typographic rhythm (grouping,
// symbols, casing) and a locale/currency change is a one-line edit. Components
// should reach for these helpers instead of formatting values ad-hoc.

const LOCALE = "cs-CZ";
const CURRENCY = "CZK";
const EN_DASH = "–";

const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Grouped integer, no currency symbol (e.g. 45000 -> "45 000"). */
export function formatCzk(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return integerFormat.format(safe);
}

/**
 * A salary band rendered as a single typographic unit, e.g.
 * "45 000–60 000 CZK" — grouped numbers, an en-dash separator, and the
 * currency suffix. Pass `period` to append a cadence ("45 000–60 000 CZK / month").
 *
 * Presentation guard: the bounds are normalized low-to-high, so an inverted
 * band (60000, 45000) still reads "45 000–60 000 CZK" rather than looking
 * broken, and an equal (or degenerate) band collapses to a single figure
 * ("50 000 CZK") instead of repeating the number around a dash.
 */
export function formatSalaryRange(
  minimum: number,
  maximum: number,
  options: { currency?: string; period?: string } = {}
): string {
  const currency = options.currency ?? CURRENCY;
  const a = Number.isFinite(minimum) ? minimum : 0;
  const b = Number.isFinite(maximum) ? maximum : 0;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const range =
    low === high
      ? `${formatCzk(low)} ${currency}`
      : `${formatCzk(low)}${EN_DASH}${formatCzk(high)} ${currency}`;
  return options.period ? `${range} / ${options.period}` : range;
}

/**
 * A percentage with consistent rounding and a hard "%" suffix. Pass
 * `fraction: true` for 0–1 inputs (e.g. a 0.73 confidence) and they are scaled
 * to 0–100 before rounding.
 *
 * Pass `clamp: true` for score/confidence readouts feeding gauges that assume a
 * 0–100 domain: an out-of-range value (150, -20) is bounded to [0, 100] so it
 * renders as "100%"/"0%" instead of "150%"/"-20%". This is presentation-only —
 * it never throws — and stays off by default so genuinely-uncapped percentages
 * (e.g. growth over a baseline) keep rendering verbatim.
 */
export function formatPercent(
  value: number,
  options: { fraction?: boolean; digits?: number; clamp?: boolean } = {}
): string {
  const scaled = options.fraction ? value * 100 : value;
  let safe = Number.isFinite(scaled) ? scaled : 0;
  if (options.clamp) safe = Math.min(100, Math.max(0, safe));
  return `${safe.toFixed(options.digits ?? 0)}%`;
}

/**
 * Years of experience, trimmed of noise: 0 -> "0 yrs", 1 -> "1 yr",
 * 3.5 -> "3.5 yrs". Keeps at most one decimal and drops a trailing ".0".
 */
export function formatYears(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(safe * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${rounded === 1 ? "yr" : "yrs"}`;
}

/**
 * A counted noun with grouped digits and naive pluralization:
 * formatCount(1, "entry", "entries") -> "1 entry",
 * formatCount(5, "candidate") -> "5 candidates",
 * formatCount(1200) -> "1 200".
 */
export function formatCount(value: number, singular?: string, plural?: string): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  const count = integerFormat.format(safe);
  if (!singular) return count;
  const noun = safe === 1 ? singular : plural ?? `${singular}s`;
  return `${count} ${noun}`;
}

/**
 * The four rank tiers every score collapses to before it picks up a color.
 * `null` is its own tier so a missing score reads as a neutral chip rather than
 * silently scoring "weak". Mirrors the `--color-score-*` tokens in globals.css.
 */
export type ScoreTone = "strong" | "mid" | "weak" | "null";

/**
 * The canonical score→tone decision: the ONE place the 75/50 cutoffs live.
 * Badge, meter, dial, and factor bars all route through this so a candidate can
 * never read "strong" on one surface and "mid" on another. A null/non-finite
 * score returns "null" (the neutral, score-absent tier).
 */
export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score == null || !Number.isFinite(score)) return "null";
  if (score >= 75) return "strong";
  if (score >= 50) return "mid";
  return "weak";
}

/**
 * A tone's color as a `var(--color-score-…)` string, for consumers that need a
 * raw CSS color rather than a Tailwind class — inline styles and SVG fill/stroke
 * (ScoreDial arc, FactorChart bars). Resolving through the token (not a hardcoded
 * hex) keeps those surfaces on the shared scale, so re-toning is a one-line edit.
 */
export function scoreToneColor(tone: ScoreTone): string {
  return `var(--color-score-${tone})`;
}

// Tokens that should never be title-cased — rendered verbatim so acronyms and
// branded names keep their canonical shape.
const ACRONYMS: Record<string, string> = {
  cv: "CV",
  jd: "JD",
  ats: "ATS",
  star: "STAR",
  github: "GitHub",
  ai: "AI",
  ml: "ML",
  llm: "LLM",
  api: "API",
  b2b: "B2B",
  b2c: "B2C",
};

/**
 * snake/kebab/space-separated value -> Title Case, with known acronyms
 * preserved (CV, JD, ATS, STAR, GitHub, …). "software_engineering" ->
 * "Software Engineering"; "ats_score" -> "ATS Score".
 */
export function labelize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
