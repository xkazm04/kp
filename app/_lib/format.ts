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
  return integerFormat.format(value);
}

/**
 * A salary band rendered as a single typographic unit, e.g.
 * "45 000–60 000 CZK" — grouped numbers, an en-dash separator, and the
 * currency suffix. Pass `period` to append a cadence ("45 000–60 000 CZK / month").
 */
export function formatSalaryRange(
  minimum: number,
  maximum: number,
  options: { currency?: string; period?: string } = {}
): string {
  const currency = options.currency ?? CURRENCY;
  const range = `${formatCzk(minimum)}${EN_DASH}${formatCzk(maximum)} ${currency}`;
  return options.period ? `${range} / ${options.period}` : range;
}

/**
 * A percentage with consistent rounding and a hard "%" suffix. Pass
 * `fraction: true` for 0–1 inputs (e.g. a 0.73 confidence) and they are scaled
 * to 0–100 before rounding.
 */
export function formatPercent(
  value: number,
  options: { fraction?: boolean; digits?: number } = {}
): string {
  const scaled = options.fraction ? value * 100 : value;
  const safe = Number.isFinite(scaled) ? scaled : 0;
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
