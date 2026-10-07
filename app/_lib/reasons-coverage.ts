// THE GOAL'S OWN MEASURE: how many produced verdicts can say WHY.
//
// "No scorecard, ranking or rejection is produced without a reasons block" is a
// claim, and until this module existed it was only ever a claim — the producer side
// was largely built (screen-wave.ts seals a closed ScreenReasonCode, the scorecard
// carries per-rating evidence with isPlaceholderEvidence already telling a real
// quote from the "Not assessed" placeholder, a ranking carries an explanation), but
// nothing counted the result, so the claim could not be true or false, only stated.
//
// This is the counter. It is pure — no DB, no fs, no catalogs of its own — so the
// same function serves the unit gate (over fixtures) and the corpus meter
// (scripts/kpi/reasons-coverage.mjs, over the demo corpus).
//
// TWO RULES DECIDE WHETHER IT IS WORTH ANYTHING:
//
//  1. IT RESOLVES, IT DOES NOT PATTERN-MATCH. A rejection's reasons block is
//     whatever `waveReasonText` — the SAME resolver the reconsider queue, the
//     decision-records panel and the decision log render through — actually returns
//     for the sealed code. A Match-filed ranking's is whatever `matchVerdictReasons`
//     renders from its sealed `match_verdict` record (ADR 0018) — never the live
//     `approval_detail` column, which a transition clears. A re-implementation here
//     would measure this file's idea of resolution and pass while the real surfaces
//     rendered nothing.
//
//  2. AN EMPTY DENOMINATOR IS NOT A PASS. A kind with no verdicts to check reports
//     `ratio: null, measured: false` — never 1. A counter that reads 100% because it
//     found nothing to count is the failure mode ADR-0008 ("a row declares its own
//     outcome") was written against, and it is the specific way this metric would
//     rot: the corpus loses its interviews, the scorecard arm silently reads
//     perfect, and the number keeps being reported.
import { matchVerdictReasons, sealedMatchFacts, waveReasonText, type SealedReason, type SealedRecordLike } from "./decision-attribution";
import type { MatchReasonsTranslator } from "@/app/features/insights/matrix/focus/matchReasons";
import { isPlaceholderEvidence } from "./interview-scorecard";

/** The three kinds of produced verdict the goal names. Literal array + derived
 *  union + a runtime guard, the house shape for a closed vocabulary. */
export const REASONS_VERDICT_KINDS = ["ranking", "scorecard", "rejection"] as const;
export type ReasonsVerdictKind = (typeof REASONS_VERDICT_KINDS)[number];

export function isReasonsVerdictKind(v: string): v is ReasonsVerdictKind {
  return (REASONS_VERDICT_KINDS as readonly string[]).includes(v);
}

/** A ranking: the match/job-fit verdict an analysis produced about a candidate. Its
 *  reasons block is the prose the analysis wrote to justify the score. */
export type RankingVerdict = {
  kind: "ranking";
  id: string;
  /** Where the ranking came from. A "match" ranking is a pipeline entry the Match
   *  surface filed, whose reasons are its SEALED verdict record (see
   *  `matchFiledRanking`); the meter prints the arm per origin. */
  origin?: "seed" | "analysis" | "match";
  explanation?: string | null;
  jobFitSummary?: string | null;
  /** True when `explanation` is the pipeline's template fallback (the stored
   *  analysis carries an `explanation_fallback` trust finding): text the model did
   *  not write, so it is not a reasons block. */
  fallbackExplanation?: boolean;
  /** A "match" ranking's sealed `match_verdict` record (ADR 0018), resolved through
   *  matchVerdictReasons — the same resolver the product surfaces render with. */
  sealedMatch?: SealedRecordLike | null;
  /** A "match" ranking filed before the verdict was sealed. It is reported in its own
   *  bucket and NEVER counted: the facts cannot be recovered from a localized sentence,
   *  and re-running the match today would seal a verdict nobody was shown. */
  legacy?: LegacyMatchBucket;
};

/** The two states a Match add filed before ADR 0018 can be in. Literal array + derived
 *  union, the closed-vocabulary shape. The buckets can only shrink. */
export const LEGACY_MATCH_BUCKETS = ["legacy_prose_snapshot", "legacy_snapshot_cleared"] as const;
export type LegacyMatchBucket = (typeof LEGACY_MATCH_BUCKETS)[number];

/** Is this stored `approval_detail` the prose snapshot the pre-ADR-0018 route wrote —
 *  exactly `{summary, strengths, redFlags}` with a non-blank summary? Any other payload
 *  (a screening recommendation, a scorecard, a slot string, nothing) means the snapshot
 *  was overwritten or cleared by a later transition. */
function isLegacyMatchSnapshot(detail: string | null | undefined): boolean {
  if (!detail) return false;
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed).sort().join(",");
    return (
      keys === "redFlags,strengths,summary" &&
      typeof parsed.summary === "string" &&
      parsed.summary.trim().length > 0 &&
      Array.isArray(parsed.strengths) &&
      Array.isArray(parsed.redFlags)
    );
  } catch {
    return false; // unreadable is not the snapshot shape — it reads as cleared
  }
}

/** The one reading of the pipeline's `explanation_fallback` marker, shared by the
 *  write path and the meter so they cannot disagree about what a fallback is. */
export const EXPLANATION_FALLBACK_CODE = "explanation_fallback";

export function hasFallbackExplanation(payload: unknown): boolean {
  const findings = (payload as { trustFindings?: unknown } | null | undefined)?.trustFindings;
  return (
    Array.isArray(findings) &&
    findings.some((f) => (f as { code?: unknown } | null)?.code === EXPLANATION_FALLBACK_CODE)
  );
}

/** A Match-filed pipeline entry as a ranking verdict. `record` is the entry's newest
 *  sealed `match_verdict` (looked up by candidate_ref), or null; `approvalDetail` is the
 *  raw stored column, read ONLY to tell the two legacy buckets apart when there is no
 *  record — the live gate slot is never the reasons block. Pure: the caller reads both. */
export function matchFiledRanking(row: {
  id: string;
  record?: SealedRecordLike | null;
  approvalDetail?: string | null;
}): RankingVerdict {
  if (row.record) return { kind: "ranking", id: row.id, origin: "match", sealedMatch: row.record };
  return {
    kind: "ranking",
    id: row.id,
    origin: "match",
    legacy: isLegacyMatchSnapshot(row.approvalDetail) ? "legacy_prose_snapshot" : "legacy_snapshot_cleared",
  };
}

/** A scorecard: the per-competency interview verdict. Its reasons block is the
 *  EVIDENCE behind the ratings — not the ratings themselves, which are the verdict. */
export type ScorecardVerdict = {
  kind: "scorecard";
  id: string;
  /** The raw stored `ratings` blob; unknown because a persisted scorecard is
   *  unvalidated JSON from an LLM synthesis and this is its reading boundary. */
  ratings?: unknown;
};

/** A rejection: a sealed adverse screening decision. Its reasons block is the
 *  localized text its sealed reason code resolves to. */
export type RejectionVerdict = {
  kind: "rejection";
  id: string;
  reason?: SealedReason | null;
};

export type ReasonsVerdict = RankingVerdict | ScorecardVerdict | RejectionVerdict;

/** Whether one verdict has a reasons block, and — when it does not — the specific
 *  reason it does not, because "3 misses" is not actionable and
 *  "3 scorecards whose every axis reads Not assessed" is. */
export type ReasonsBlockResult = { ok: true; via: string } | { ok: false; why: string };

/** How a rejection's sealed code is turned into text. Structurally the next-intl
 *  translator `waveReasonText` takes; the meter builds one over messages/en.json,
 *  the tests build one over a fixture. */
export type ReasonsCatalog = { (key: never, params?: never): string; has(key: never): boolean };

function isBlank(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0;
}

/** How many of a scorecard's axes carry real evidence: k of N. A scorecard with one real
 *  quote among five axes is a hit under the hit rule, and this is what says it is 1 of 5. */
export function scorecardFraction(ratings: unknown): { assessed: number; axes: number } {
  if (!Array.isArray(ratings)) return { assessed: 0, axes: 0 };
  const assessed = ratings.filter((r) => {
    if (!r || typeof r !== "object") return false;
    const evidence = (r as Record<string, unknown>).evidence;
    return !isPlaceholderEvidence(typeof evidence === "string" ? evidence : null);
  }).length;
  return { assessed, axes: ratings.length };
}

/** Does this verdict resolve a non-empty reasons block? One function, three kinds,
 *  each answered the way that kind's own producer defines "why". `matchCatalog` is the
 *  `match`-scoped translator a sealed Match verdict renders through (rejections use
 *  `catalog`, the decisions.wave one); the meter builds it over messages/en.json. */
export function reasonsBlockOf(
  verdict: ReasonsVerdict,
  catalog: ReasonsCatalog,
  matchCatalog?: MatchReasonsTranslator
): ReasonsBlockResult {
  switch (verdict.kind) {
    case "ranking": {
      if (verdict.origin === "match") {
        // Resolution, not existence — rule 1: the sealed facts must render through the
        // same renderer the Decisions cohort and the records panel use.
        if (verdict.legacy) return { ok: false, why: `${verdict.legacy}: filed before the verdict was sealed — reported apart, not counted` };
        const record = verdict.sealedMatch;
        if (!record) return { ok: false, why: "match-filed entry with no sealed match_verdict record" };
        if (!sealedMatchFacts(record)) return { ok: false, why: "the sealed match_verdict carries no valid facts" };
        if (!matchCatalog) return { ok: false, why: "no match catalog to resolve the sealed match_verdict through" };
        const reasons = matchVerdictReasons(matchCatalog, record);
        if (!reasons || isBlank(reasons.line)) {
          return { ok: false, why: "the sealed match_verdict has neither a dimension nor a skill name — a ranking with nothing to say" };
        }
        return { ok: true, via: "sealed match_verdict" };
      }
      if (!isBlank(verdict.explanation) && !verdict.fallbackExplanation) return { ok: true, via: "explanation" };
      if (!isBlank(verdict.jobFitSummary)) return { ok: true, via: "jobFit.summary" };
      if (verdict.fallbackExplanation) {
        return { ok: false, why: "has a template fallback explanation only — no model-written reasons and no jobFit summary" };
      }
      return { ok: false, why: "no explanation and no jobFit summary — a score with no prose behind it" };
    }
    case "scorecard": {
      if (!Array.isArray(verdict.ratings) || verdict.ratings.length === 0) {
        return { ok: false, why: "no ratings at all" };
      }
      // THE RULE THIS ARM EXISTS FOR: a scorecard whose every rating reads
      // "Not assessed…" has no reasons block. It looks complete — every axis
      // carries a rating and a string — which is exactly why counting rows rather
      // than reading them would score it as a hit.
      const { assessed, axes } = scorecardFraction(verdict.ratings);
      if (assessed === 0) {
        return { ok: false, why: `every one of ${axes} rating(s) is placeholder evidence` };
      }
      return { ok: true, via: `${assessed}/${axes} rating(s) with real evidence` };
    }
    case "rejection": {
      if (!verdict.reason || isBlank(verdict.reason.reasonCode)) {
        return { ok: false, why: "no sealed reason code" };
      }
      // Resolution, not existence: a code the catalog has no entry for renders as
      // nothing on every surface that shows it, so it is not a reasons block.
      const text = waveReasonText(catalog, verdict.reason);
      if (isBlank(text)) {
        return { ok: false, why: `reason code "${verdict.reason.reasonCode}" resolves to nothing in the catalog` };
      }
      return { ok: true, via: `resolved "${verdict.reason.reasonCode}"` };
    }
  }
}

/** One arm of the count. `measured` is the honest half: `false` means there was
 *  nothing to check, and `ratio` is null rather than 1 so a vacuous arm can never be
 *  reported as a perfect one. */
export type ReasonsArm = {
  checked: number;
  withReasons: number;
  /** withReasons / checked, or NULL when nothing was checked. */
  ratio: number | null;
  measured: boolean;
};

export type ReasonsMiss = { kind: ReasonsVerdictKind; id: string; why: string };

export type ReasonsCoverage = {
  total: ReasonsArm;
  byKind: Record<ReasonsVerdictKind, ReasonsArm>;
  /** Every verdict that could not say why — named, so the number is fixable. */
  misses: ReasonsMiss[];
  /** The kinds with an empty denominator. Non-empty means the headline number does
   *  NOT cover the whole goal, and a caller reporting it has to say so. */
  unmeasuredKinds: ReasonsVerdictKind[];
  /** Match-filed entries with no sealed verdict, by legacy bucket. OUTSIDE every arm and
   *  the total — neither a hit nor a miss — and stated so a reader sees their size. */
  legacyMatch: Record<LegacyMatchBucket, number>;
  /** Each counted scorecard's assessed fraction (k of N axes with real evidence), and the
   *  totals across them — so the arm reads how much of the rubric was assessed, not only
   *  hit or miss. */
  scorecardFractions: { id: string; assessed: number; axes: number }[];
  scorecardAxes: { assessed: number; axes: number };
  /** Completed interview sessions that produced NO scorecard (a refused or never-scored
   *  one). Their own bucket: neither a hit nor a miss, because no scorecard exists to
   *  have no reasons — and never silently dropped. */
  completedUnscored: number;
};

function arm(checked: number, withReasons: number): ReasonsArm {
  return {
    checked,
    withReasons,
    ratio: checked === 0 ? null : withReasons / checked,
    measured: checked > 0,
  };
}

/** Count the reasons coverage of a set of produced verdicts. */
export function countReasonsCoverage(
  verdicts: readonly ReasonsVerdict[],
  catalog: ReasonsCatalog,
  matchCatalog?: MatchReasonsTranslator,
  /** Count of completed sessions with no scorecard (the meter reads it from the database). */
  completedUnscored = 0
): ReasonsCoverage {
  const checked = { ranking: 0, scorecard: 0, rejection: 0 } as Record<ReasonsVerdictKind, number>;
  const hit = { ranking: 0, scorecard: 0, rejection: 0 } as Record<ReasonsVerdictKind, number>;
  const misses: ReasonsMiss[] = [];
  const legacyMatch = { legacy_prose_snapshot: 0, legacy_snapshot_cleared: 0 } as Record<LegacyMatchBucket, number>;
  const scorecardFractions: { id: string; assessed: number; axes: number }[] = [];
  for (const v of verdicts) {
    if (v.kind === "ranking" && v.legacy) {
      legacyMatch[v.legacy] += 1; // never folded into the headline
      continue;
    }
    checked[v.kind] += 1;
    if (v.kind === "scorecard") scorecardFractions.push({ id: v.id, ...scorecardFraction(v.ratings) });
    const result = reasonsBlockOf(v, catalog, matchCatalog);
    if (result.ok) hit[v.kind] += 1;
    else misses.push({ kind: v.kind, id: v.id, why: result.why });
  }
  const totalChecked = REASONS_VERDICT_KINDS.reduce((n, k) => n + checked[k], 0);
  const totalHit = REASONS_VERDICT_KINDS.reduce((n, k) => n + hit[k], 0);
  return {
    total: arm(totalChecked, totalHit),
    byKind: {
      ranking: arm(checked.ranking, hit.ranking),
      scorecard: arm(checked.scorecard, hit.scorecard),
      rejection: arm(checked.rejection, hit.rejection),
    },
    misses,
    unmeasuredKinds: REASONS_VERDICT_KINDS.filter((k) => checked[k] === 0),
    legacyMatch,
    scorecardFractions,
    scorecardAxes: scorecardFractions.reduce((t, f) => ({ assessed: t.assessed + f.assessed, axes: t.axes + f.axes }), { assessed: 0, axes: 0 }),
    completedUnscored,
  };
}

/** The coverage as a percentage with ONE decimal, or null when unmeasured. Reporting
 *  helper, kept here so the meter and any future KPI writer format it identically. */
export function reasonsCoveragePct(a: ReasonsArm): number | null {
  return a.ratio === null ? null : Math.round(a.ratio * 1000) / 10;
}
