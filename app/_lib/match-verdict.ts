// THE MATCH VERDICT AS A RECORD, not as prose (ADR 0018).
//
// A Match add used to carry a sentence the browser had composed in the recruiter's
// language, and the route stored it in `pipeline_entries.approval_detail` — a slot five
// other payload shapes share and most transitions clear. So the "snapshot" was neither a
// snapshot nor a record. Now the add carries the FACTS the sentence is built from, the
// route checks them against the closed vocabularies below and seals them into the
// decision chain before it inserts the entry, and every surface renders the sealed
// facts in its reader's language (renderMatchReasons in
// app/features/insights/matrix/focus/matchReasons.ts, resolved for a record by
// matchVerdictReasons in decision-attribution.ts).
//
// Pure and dependency-free on purpose: the route (server), the decision-record resolver
// (browser-safe) and the reasons meter (a node script) all import it, and none of them
// should pull a store or a catalog in to validate eight fields.

/** The scorer's fit bands (matching.py `FitTier` / `fit_tier_for`). */
export const FIT_TIERS = ["strong", "promising", "partial"] as const;
export type FitTier = (typeof FIT_TIERS)[number];
export function isFitTier(v: unknown): v is FitTier {
  return typeof v === "string" && (FIT_TIERS as readonly string[]).includes(v);
}

/** The locale-independent dimension slugs the scorer emits as `label_code`
 *  (matching.py: `_DIMENSION_KEYS` for BAU, `_DIM_SLUG_EARLY` for early-career) and
 *  the UI localizes through `match.dims.*`. matchReasons.test.ts pins this list to the
 *  Python source and to the catalog, so a renamed slot cannot drift past the seal. */
export const DIMENSION_LABEL_CODES = ["skills", "career", "personal", "foundation", "potential", "fit"] as const;
export type DimensionLabelCode = (typeof DIMENSION_LABEL_CODES)[number];
export function isDimensionLabelCode(v: unknown): v is DimensionLabelCode {
  return typeof v === "string" && (DIMENSION_LABEL_CODES as readonly string[]).includes(v);
}

/** The sealed record's kind and reason code. Internal: `/status/[token]` does not show
 *  it (status-decisions.ts allowlists what a candidate sees), and whether a candidate
 *  may see a ranking against a role they never applied for is an open owner question. */
export const MATCH_VERDICT_KIND = "match_verdict";
export const MATCH_VERDICT_REASON_CODE = "match_fit";

/** Bounds on the skill lists a verdict carries. The client trims to these before it
 *  renders, so the card and the record show the same names. */
export const MATCH_FACTS_MAX_SKILLS = 3;
export const MATCH_FACTS_SKILL_MAX_CHARS = 40;

/** One score dimension, as the verdict quotes it: the slug and the rounded percent. */
export type MatchReasonDimension = { labelCode: DimensionLabelCode; percent: number };

/** Everything the reasons line says, and nothing in any language.
 *  `best`/`worst` are the strongest and weakest usable dimension; `worst` is null when
 *  only one dimension was usable. `matchScore` is the total the add files. */
export type MatchReasonFacts = {
  fitTier: FitTier | null;
  best: MatchReasonDimension | null;
  worst: MatchReasonDimension | null;
  matched: string[];
  unproven: string[];
  missing: string[];
  matchScore: number | null;
  scorerVersion: string;
};

const FACT_KEYS: ReadonlySet<string> = new Set([
  "fitTier",
  "best",
  "worst",
  "matched",
  "unproven",
  "missing",
  "matchScore",
  "scorerVersion",
]);
const DIMENSION_KEYS: ReadonlySet<string> = new Set(["labelCode", "percent"]);
const SCORER_VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A dimension, or undefined when the value is present and malformed (null stays null). */
function coerceDimension(v: unknown): MatchReasonDimension | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isRecord(v) || Object.keys(v).some((k) => !DIMENSION_KEYS.has(k))) return undefined;
  const { labelCode, percent } = v;
  if (!isDimensionLabelCode(labelCode)) return undefined;
  if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 100) return undefined;
  return { labelCode, percent };
}

/** A bounded skill list, or undefined when any part of it is out of bounds. */
function coerceSkills(v: unknown): string[] | undefined {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > MATCH_FACTS_MAX_SKILLS) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return undefined;
    if (!item || item !== item.trim() || item.length > MATCH_FACTS_SKILL_MAX_CHARS || out.includes(item)) return undefined;
    out.push(item);
  }
  return out;
}

/** The verdict facts in canonical form (fixed key order, absent → null / []), or null
 *  when anything is outside the vocabulary or the bounds. Strict about what IS there —
 *  an unknown key, an out-of-vocabulary tier or slug, a fractional or out-of-range
 *  percent, a weakest dimension stronger than the strongest, an over-long or repeated
 *  skill name — because the only producer is our own client and a mismatch is drift. */
export function coerceMatchReasonFacts(v: unknown): MatchReasonFacts | null {
  if (!isRecord(v) || Object.keys(v).some((k) => !FACT_KEYS.has(k))) return null;
  const fitTier = v.fitTier === null || v.fitTier === undefined ? null : isFitTier(v.fitTier) ? v.fitTier : undefined;
  const best = coerceDimension(v.best);
  const worst = coerceDimension(v.worst);
  const matched = coerceSkills(v.matched);
  const unproven = coerceSkills(v.unproven);
  const missing = coerceSkills(v.missing);
  const score = v.matchScore;
  const matchScore =
    score === null || score === undefined
      ? null
      : typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100
        ? score
        : undefined;
  const scorerVersion = typeof v.scorerVersion === "string" && SCORER_VERSION_RE.test(v.scorerVersion) ? v.scorerVersion : undefined;
  if (
    fitTier === undefined ||
    best === undefined ||
    worst === undefined ||
    matched === undefined ||
    unproven === undefined ||
    missing === undefined ||
    matchScore === undefined ||
    scorerVersion === undefined
  ) {
    return null;
  }
  // A weakest dimension needs a strongest one, and cannot outscore it.
  if (worst && (!best || worst.percent > best.percent)) return null;
  return { fitTier, best, worst, matched, unproven, missing, matchScore, scorerVersion };
}

/** The sealed record's `rationale`: a byte-stable, locale-invariant code string derived
 *  from the facts — never prose. The skill NAMES stay in `inputs`; the line counts them. */
export function matchVerdictRationale(facts: MatchReasonFacts): string {
  const dim = (d: MatchReasonDimension | null) => (d ? `${d.labelCode}:${d.percent}` : "-");
  return [
    MATCH_VERDICT_REASON_CODE,
    `tier=${facts.fitTier ?? "-"}`,
    `best=${dim(facts.best)}`,
    `worst=${dim(facts.worst)}`,
    `skills=${facts.matched.length}/${facts.unproven.length}/${facts.missing.length}`,
    `score=${facts.matchScore ?? "-"}`,
    `scorer=${facts.scorerVersion}`,
  ].join(" ");
}
