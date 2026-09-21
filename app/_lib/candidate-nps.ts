// W0.6b — candidate NPS (cNPS): measure the candidate experience we claim to protect.
//
// kp argues that a candidate who is told WHY they were rejected has a better experience
// than one who is ghosted (rejection-feedback.ts). That is currently an assertion. A
// competitor publishes "4.6/5 candidate experience" and a 60+ NPS; we have no number at
// all — so this captures one at the only honest moment (a terminal outcome) and feeds it
// into the metric pack under the same honesty contract as every other metric.
//
// Pure: scoring, validation and bucketing. Storage is candidate-nps-store.ts.

/** The standard NPS scale. Anything outside 0..10 is not a response, it is bad input. */
export const NPS_MIN = 0;
export const NPS_MAX = 10;

/** Free-text cap. Long enough for a real sentence, short enough that the column cannot be
 *  used as a data-exfiltration channel by whoever holds the token. */
export const NPS_COMMENT_MAX = 500;

/** Below this many responses a cNPS is noise: the metric is a difference of proportions,
 *  so a handful of answers swings it by tens of points. */
export const NPS_MIN_SAMPLE = 10;

export type NpsBucket = "promoter" | "passive" | "detractor";

export function npsBucket(score: number): NpsBucket {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export type NpsSummary = {
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** -100..100, or null below the sample floor — never a number we would not defend. */
  score: number | null;
  /** The same figure WITHOUT the floor applied, or null on zero responses. For consumers
   *  that carry their own publish/withhold policy (the metric pack labels a thin metric
   *  rather than hiding it) — never for direct display, which is what `score` is for. */
  rawScore: number | null;
  /** Mean 0..10, reported alongside because "4.6/5"-style claims are what buyers compare.
   *  Null on zero responses (no divide-by-zero pseudo-value). */
  mean: number | null;
  belowSampleFloor: boolean;
};

/** The refusals this validator can produce. Each name is a key in `REFUSAL_ERRORS`
 *  with an `errors.<CODE>` entry in all four catalogs — a public token door must
 *  never put an English sentence on the fail object (the sibling feedback
 *  validator is the same shape). */
export const NPS_REFUSALS = ["NPS_SCORE_REQUIRED", "NPS_SCORE_INVALID"] as const;
export type NpsRefusalCode = (typeof NPS_REFUSALS)[number];

export function isNpsRefusalCode(value: unknown): value is NpsRefusalCode {
  return typeof value === "string" && (NPS_REFUSALS as readonly string[]).includes(value);
}

export type NpsParseResult =
  | { ok: true; score: number; comment: string | null }
  | { ok: false; code: NpsRefusalCode };

/** Validate a submitted response. Returns the clean value or a REFUSAL code — callers
 *  must not coerce, because a coerced 0 is a detractor the candidate never chose. */
export function parseNpsSubmission(raw: { score?: unknown; comment?: unknown }): NpsParseResult {
  // Number(null), Number(""), Number("  ") and Number([]) are all 0 — a valid-looking
  // detractor the candidate never chose. Accept a real number, or a string that is
  // non-empty AFTER trimming; everything else is absent input, not a zero.
  let n: number;
  if (typeof raw.score === "number") {
    n = raw.score;
  } else if (typeof raw.score === "string" && raw.score.trim() !== "") {
    n = Number(raw.score);
  } else {
    return { ok: false, code: "NPS_SCORE_REQUIRED" };
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, code: "NPS_SCORE_INVALID" };
  if (n < NPS_MIN || n > NPS_MAX) return { ok: false, code: "NPS_SCORE_INVALID" };
  const rawComment = typeof raw.comment === "string" ? raw.comment.trim() : "";
  return { ok: true, score: n, comment: rawComment ? rawComment.slice(0, NPS_COMMENT_MAX) : null };
}

/** Fold responses into the published summary. */
export function summarizeNps(scores: readonly number[]): NpsSummary {
  const valid = scores.filter((s) => Number.isFinite(s) && s >= NPS_MIN && s <= NPS_MAX);
  const responses = valid.length;
  if (responses === 0) {
    return { responses: 0, promoters: 0, passives: 0, detractors: 0, score: null, rawScore: null, mean: null, belowSampleFloor: true };
  }
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of valid) {
    const b = npsBucket(s);
    if (b === "promoter") promoters += 1;
    else if (b === "passive") passives += 1;
    else detractors += 1;
  }
  const belowSampleFloor = responses < NPS_MIN_SAMPLE;
  const rawScore = Math.round(((promoters - detractors) / responses) * 100);
  return {
    responses,
    promoters,
    passives,
    detractors,
    // Withheld below the floor rather than shown with a caveat: unlike a duration, an NPS
    // is a difference of proportions and reads as authoritative at any sample size.
    score: belowSampleFloor ? null : rawScore,
    rawScore,
    mean: Math.round((valid.reduce((a, b) => a + b, 0) / responses) * 10) / 10,
    belowSampleFloor,
  };
}
