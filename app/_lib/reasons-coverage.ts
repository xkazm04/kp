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
//     for the sealed code. A re-implementation here would measure this file's idea
//     of resolution and pass while the real surfaces rendered nothing.
//
//  2. AN EMPTY DENOMINATOR IS NOT A PASS. A kind with no verdicts to check reports
//     `ratio: null, measured: false` — never 1. A counter that reads 100% because it
//     found nothing to count is the failure mode ADR-0008 ("a row declares its own
//     outcome") was written against, and it is the specific way this metric would
//     rot: the corpus loses its interviews, the scorecard arm silently reads
//     perfect, and the number keeps being reported.
import { waveReasonText, type SealedReason } from "./decision-attribution";
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
  explanation?: string | null;
  jobFitSummary?: string | null;
};

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

/** Does this verdict resolve a non-empty reasons block? One function, three kinds,
 *  each answered the way that kind's own producer defines "why". */
export function reasonsBlockOf(verdict: ReasonsVerdict, catalog: ReasonsCatalog): ReasonsBlockResult {
  switch (verdict.kind) {
    case "ranking": {
      if (!isBlank(verdict.explanation)) return { ok: true, via: "explanation" };
      if (!isBlank(verdict.jobFitSummary)) return { ok: true, via: "jobFit.summary" };
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
      const assessed = verdict.ratings.filter((r) => {
        if (!r || typeof r !== "object") return false;
        const evidence = (r as Record<string, unknown>).evidence;
        return !isPlaceholderEvidence(typeof evidence === "string" ? evidence : null);
      });
      if (assessed.length === 0) {
        return { ok: false, why: `every one of ${verdict.ratings.length} rating(s) is placeholder evidence` };
      }
      return { ok: true, via: `${assessed.length}/${verdict.ratings.length} rating(s) with real evidence` };
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
  catalog: ReasonsCatalog
): ReasonsCoverage {
  const checked = { ranking: 0, scorecard: 0, rejection: 0 } as Record<ReasonsVerdictKind, number>;
  const hit = { ranking: 0, scorecard: 0, rejection: 0 } as Record<ReasonsVerdictKind, number>;
  const misses: ReasonsMiss[] = [];
  for (const v of verdicts) {
    checked[v.kind] += 1;
    const result = reasonsBlockOf(v, catalog);
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
  };
}

/** The coverage as a percentage with ONE decimal, or null when unmeasured. Reporting
 *  helper, kept here so the meter and any future KPI writer format it identically. */
export function reasonsCoveragePct(a: ReasonsArm): number | null {
  return a.ratio === null ? null : Math.round(a.ratio * 1000) / 10;
}
