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
  if (options.clamp) safe = clampPercent(safe);
  return `${safe.toFixed(options.digits ?? 0)}%`;
}

/**
 * Bound a value to the [0, 100] percent domain — the single clamp for gauges,
 * meters, and dials that assume a 0–100 scale, so an out-of-range value (150, -20)
 * fills/empties the bar instead of overflowing it. Presentation-only; never throws.
 * A non-finite input (NaN) passes through unchanged — callers that can produce one
 * guard it separately (see SalaryGauge's degenerate-range check).
 */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
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
 * The timestamp contract
 * ----------------------
 * Every `createdAt` / `recordedAt` / `created_at` string this app renders is
 * **ISO-8601 in UTC with an explicit designator** — `2026-06-03T10:33:40.123Z`
 * (or an explicit numeric offset). Server writers mint these with
 * `new Date().toISOString()`, which always emits the trailing `Z`.
 *
 * Why this is a contract and not a loose convention: `Date.parse` reads a
 * *naive* datetime — one with a clock time but no `Z`/offset, e.g. SQLite's
 * `'YYYY-MM-DD HH:MM:SS'` — as **local time**. The audit/outcome ages in the
 * control room would then be wrong by the viewer's UTC offset, silently
 * corrupting the immutable "when did this happen" record the high-risk-AI
 * compliance story is built on. A wrong "3h ago" is indistinguishable from a
 * correct one, so the only defense is to assert the contract where the strings
 * are consumed — see {@link classifyTimestamp} and {@link formatRelativeTime}.
 */
export type TimestampClass = "empty" | "unparseable" | "naive" | "utc";

// Ends with an explicit zone: `Z`, or a numeric offset `±HH:MM` / `±HHMM`.
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;
// Carries a clock time (so a date-only value, which the spec parses as UTC, is
// exempt from the naive check).
const HAS_CLOCK = /\d{2}:\d{2}/;

/**
 * Classify a timestamp string against the UTC contract from its text alone:
 * - `empty`       — blank / whitespace (a legitimately absent timestamp)
 * - `unparseable` — `Date.parse` can't read it
 * - `naive`       — parseable, carries a clock time, but no `Z`/offset, so
 *                   `Date.parse` reads it as LOCAL time (skew-prone)
 * - `utc`         — carries an explicit `Z`/offset (an unambiguous instant), or
 *                   is a date-only value (which the spec reads as UTC) —
 *                   contract-compliant
 */
export function classifyTimestamp(iso: string): TimestampClass {
  if (!iso || !iso.trim()) return "empty";
  if (!Number.isFinite(Date.parse(iso))) return "unparseable";
  if (HAS_CLOCK.test(iso) && !ZONE_SUFFIX.test(iso)) return "naive";
  return "utc";
}

const warnedTimestamps = new Set<string>();

/**
 * Surface a timestamp-contract violation once per distinct message. Silenced in
 * production so a malformed feed can't spam an end user's console, but loud in
 * dev/test where an engineer can see (and fix) the skew before it ships. Deduped
 * because the control room re-renders these strings every 3s.
 */
function warnTimestampContract(message: string): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
  if (warnedTimestamps.has(message)) return;
  warnedTimestamps.add(message);
  console.warn(`[timestamp-contract] ${message}`);
}

// A timestamp dated further than this into the future is treated as clock/zone
// skew and reported; a few seconds of jitter between a server mint and a client
// render is normal and stays quiet.
const FUTURE_SKEW_TOLERANCE_S = 120;

/**
 * A coarse "time ago" label from an ISO-8601 **UTC** timestamp — e.g. "5s ago",
 * "12m ago", "3h ago", "2d ago". The single relative-time renderer for the
 * control page, audit log, outbox, tasks, history, etc. (previously a
 * `rel()`/`relTime()` copy hand-rolled in each). Buckets: seconds < 60,
 * minutes < 60, hours < 24, then days. A blank/unparseable input returns "" —
 * callers wanting a placeholder use `formatRelativeTime(x) || "—"`, and callers
 * wanting an absolute date past some age compose this with their own threshold.
 *
 * Asserts the timestamp contract documented above: a naive (zone-less),
 * unparseable, or far-future input is reported via {@link warnTimestampContract}
 * instead of silently rendering a wrong age. The `Math.max(0, …)` clamp still
 * keeps a future timestamp from reading "-12h ago", but the skew that produced
 * it is no longer swallowed in silence.
 */
export function formatRelativeTime(iso: string): string {
  const cls = classifyTimestamp(iso);
  if (cls === "empty") return "";
  if (cls === "unparseable") {
    warnTimestampContract(
      `unparseable timestamp ${JSON.stringify(iso)} — expected ISO-8601 UTC, e.g. "2026-06-03T10:33:40Z"`
    );
    return "";
  }
  if (cls === "naive") {
    warnTimestampContract(
      `naive (zone-less) timestamp ${JSON.stringify(iso)} — Date.parse reads it as LOCAL time, so the age is wrong by the UTC offset; mint timestamps with new Date().toISOString()`
    );
  }
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (seconds < -FUTURE_SKEW_TOLERANCE_S) {
    warnTimestampContract(
      `future timestamp ${JSON.stringify(iso)} (${Math.round(-seconds)}s ahead) — clamped to "0s ago"; this usually means client/server clock or timezone skew`
    );
  }
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * The four rank tiers every score collapses to before it picks up a color.
 * `null` is its own tier so a missing score reads as a neutral chip rather than
 * silently scoring "weak". Mirrors the `--color-score-*` tokens in globals.css.
 */
export type ScoreTone = "strong" | "mid" | "weak" | "null";

/**
 * The two score cutoffs that split a 0–100 score into strong/mid/weak — the ONE
 * place these numbers live. They are canonical app-wide: the Python CLI scripts
 * (`score_color` in scripts/_common.py) mirror these exact values so the same
 * score never reads "mid" in the web UI and "weak/red" in the terminal.
 */
export const SCORE_STRONG_MIN = 75;
export const SCORE_MID_MIN = 50;

/**
 * The canonical score→tone decision, routing through {@link SCORE_STRONG_MIN} /
 * {@link SCORE_MID_MIN}. Badge, meter, dial, and factor bars all call this so a
 * candidate can never read "strong" on one surface and "mid" on another. A
 * null/non-finite score returns "null" (the neutral, score-absent tier).
 */
export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score == null || !Number.isFinite(score)) return "null";
  if (score >= SCORE_STRONG_MIN) return "strong";
  if (score >= SCORE_MID_MIN) return "mid";
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

/**
 * The score-breakdown invariant
 * -----------------------------
 * An analysis score is a `total` plus five weighted components —
 * experience / skills / roleSeniority / education / traits — whose individual
 * maxima (25 / 30 / 23 / 12 / 10) sum to exactly 100. The total is *defined* as
 * the sum of those parts: it is the figure a viewer adds up by eye from the
 * FactorChart bars and the same figure ScoreDial paints on its 0–100 arc.
 *
 * Why this needs guarding: the pipeline mints `total` from the model's own
 * number (clamped to [0,100]), NOT recomputed from the parts — see
 * `_score_from_payload` in `pipeline/jobfit/pipeline.py` — so a bad generation
 * can return a `total` that disagrees with its components. On screen that
 * surfaces as a dial reading 82 above bars that visibly add to 74: two different
 * stories with no signal which is right, quietly eroding trust in the report.
 *
 * Policy on divergence — **recompute**. The component sum is authoritative for
 * what the UI shows, because it is the figure the breakdown lets a recruiter
 * verify by eye. {@link reconcileScoreTotal} pins the displayed total to that
 * sum, so the dial and the bars are derived from one source and can never
 * contradict. The pipeline's disagreeing `total` is still reported once via
 * {@link warnScoreContract} in dev/test — loud enough for an engineer to fix the
 * bad output, silent in production so one bad analysis can't spam a user's
 * console. Every surface that shows a total beside its breakdown routes through
 * this helper (ScoreDial + FactorChart in ExtractionTab; the compare grid's
 * Overall row), and the on-load assertion in ResultPanel runs it once per
 * analysis regardless of which tab is open.
 */
export type ScoreComponentKey =
  | "experience"
  | "skills"
  | "roleSeniority"
  | "education"
  | "traits";

/**
 * The five weighted components a score `total` is the sum of, in the order the
 * FactorChart plots them. The ONE place this list lives, so the dial's total and
 * the breakdown bars can never be summed over a different set of parts.
 */
export const SCORE_COMPONENT_KEYS: readonly ScoreComponentKey[] = [
  "experience",
  "skills",
  "roleSeniority",
  "education",
  "traits",
];

/**
 * A score's five components — the shape the analysis `score` and the compare
 * grid's per-variant `score` both satisfy (each carries these keys as numbers).
 */
export type ScoreComponents = Record<ScoreComponentKey, number>;

/**
 * The sum of the five weighted components — exactly what the FactorChart bars
 * add up to by eye. A non-finite component counts as 0 so a malformed score
 * degrades to a number rather than poisoning the sum with NaN.
 */
export function scoreComponentSum(score: ScoreComponents): number {
  return SCORE_COMPONENT_KEYS.reduce((sum, key) => {
    const value = score[key];
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

const warnedScores = new Set<string>();

/**
 * Surface a score-contract violation once per distinct message. Silenced in
 * production so a single bad analysis can't spam an end user's console, but loud
 * in dev/test where an engineer can catch the bad pipeline output before a
 * candidate sees it. Mirrors {@link warnTimestampContract}.
 */
function warnScoreContract(message: string): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
  if (warnedScores.has(message)) return;
  warnedScores.add(message);
  console.warn(`[score-contract] ${message}`);
}

/**
 * The total a score surface should display: the component sum (see the
 * score-breakdown invariant above), with the pipeline's own `total` reported
 * once via {@link warnScoreContract} when it disagrees. Feed both the ScoreDial
 * and the FactorChart from the same score object and route the dial through
 * this, and the arc is guaranteed to read exactly what the bars add up to.
 */
export function reconcileScoreTotal(score: ScoreComponents & { total: number }): number {
  const componentSum = scoreComponentSum(score);
  if (Number.isFinite(score.total) && score.total !== componentSum) {
    warnScoreContract(
      `score.total (${score.total}) ≠ sum of components (${componentSum}) ` +
        `[${SCORE_COMPONENT_KEYS.map((key) => `${key}=${score[key]}`).join(", ")}] — ` +
        `displayed total pinned to the component sum so the dial matches the breakdown; ` +
        `fix total in _score_from_payload (pipeline/jobfit/pipeline.py)`
    );
  }
  return componentSum;
}

/**
 * The interview rubric's scale: a competency rating runs 1..RATING_MAX. The ONE
 * place this scale lives — every scorecard surface (the transcript modal meter,
 * the "N/5" labels, the Decisions dot strip) derives its max from here, so
 * re-gearing the rubric (say to a 1–10 scale) is a one-line edit instead of a
 * hunt through every consumer. Mirrors the [1, RATING_MAX] clamp the Python
 * scorer enforces on each rating.
 */
export const RATING_MAX = 5;

/**
 * Project a 1..RATING_MAX rubric rating onto the app-wide 0–100 score domain, so
 * a scorecard rating feeds {@link scoreTone} / Meter / dial exactly like every
 * other score. A rating of RATING_MAX maps to 100; the projection is the single
 * definition of the old scattered `(rating / 5) * 100`.
 */
export function ratingToPercent(rating: number): number {
  return (rating / RATING_MAX) * 100;
}

/**
 * A scorecard rating's tone on the shared score scale: the 1..RATING_MAX rating
 * is projected to 0–100 (see {@link ratingToPercent}) and run through
 * {@link scoreTone} (75/50 cutoffs), so a 4–5 reads strong, a 3 mid, and a 1–2
 * weak — the same colors every ranked surface uses. The single definition of the
 * `ratingTone` helper the scorecard surfaces used to each re-declare inline.
 */
export function ratingTone(rating: number): ScoreTone {
  return scoreTone(ratingToPercent(rating));
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
