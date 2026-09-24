// One cohort ranking for a dev case (challenge-r10 devcase-detail/A).
//
// WHY. A case's submissions were ordered in four places with four null conventions: the
// orchestrator's auto-promote (`?? 0`, floor, top N), the studio shortlist (`?? -1`), the
// rubric compare matrix (evaluated-only, `?? -1`) and the interview kit (held first, then
// `?? -1`). None of them read the provenance every evaluation bundle carries
// (devcase-run.ts persists `source` and `perStepSources`). That matters because the two
// transfer scores a cohort can hold are different INSTRUMENTS: the keyless template's
// transfer is `0.5 * fluency + 0.5 * verif` over a tooling read that pins fluency at 0.5
// with confidence 0.2 (pipeline/jobfit/devcase/reflect.py, evaluate.py), and a per-call
// LLM fallback puts both instruments into one cohort. The server then advanced people -
// a board write and an advance letter - by the raw number, and the shortlist crowned a
// template 85 "#1" over a graded 72.
//
// THE RULE (technique: refuse a cross-currency comparison - withhold the incomparable
// from the comparer, do not caveat it). Scored rows are tiered by currency. When every
// scored row shares one currency (the whole keyless install; every keyed install whose
// calls all succeeded) the cohort is UNIFORM and ranks exactly as before. When it is
// MIXED, only the graded tier is numbered; template rows are listed after it, unnumbered,
// and never drawn into the auto-promote slate. devcase-cohort.ts already refuses to fold
// template tooling into the probe-miss rates; this is the same decision for ordering.
//
// PURE and import-free: it sits on the task-hub route graph (via the orchestrator) and
// the page graph (via the studio), so it must not pull anything with it.

/** Which instrument produced a submission's transfer score. */
export type EvaluationCurrency = "graded" | "template";

const TEMPLATE_SOURCE = "deterministic";

/** The instrument behind a bundle's transfer score. Precedence: the transfer step's own
 *  provenance, then the evaluate step's (the transfer is derived from it), then the
 *  envelope `source`. Only an explicit "deterministic" is a template; "llm", "partial",
 *  "observed" and a bundle predating provenance are graded (kept, the rule
 *  devcase-cohort.ts applies to legacy bundles). */
export function evaluationCurrency(bundle: unknown): EvaluationCurrency {
  if (!bundle || typeof bundle !== "object") return "graded";
  const b = bundle as { source?: unknown; perStepSources?: unknown };
  const steps = b.perStepSources && typeof b.perStepSources === "object" ? (b.perStepSources as Record<string, unknown>) : {};
  const pick = [steps.transfer, steps.evaluate, b.source].find((v) => typeof v === "string" && v.length > 0);
  return pick === TEMPLATE_SOURCE ? "template" : "graded";
}

/** What the ranking reads from a row. */
export type Rankable = { transferScore?: number | null; evaluation?: unknown };

const scoreOf = (r: Rankable): number | null =>
  typeof r.transferScore === "number" && Number.isFinite(r.transferScore) ? r.transferScore : null;

/** THE comparator: higher transfer score first, an unscored row after every scored one.
 *  Array.prototype.sort is stable, so equal scores keep their input order. */
export function compareByTransferScore(a: Rankable, b: Rankable): number {
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  if (sa === null && sb === null) return 0;
  if (sa === null) return 1;
  if (sb === null) return -1;
  return sb - sa;
}

export type CohortRow<T> = {
  item: T;
  /** 1-based position in the numbered tier; null for a template row in a mixed cohort
   *  and for an unscored row (listed, never numbered). */
  rank: number | null;
  /** null for an unscored row: no score, no instrument to speak of. */
  currency: EvaluationCurrency | null;
};

export type CohortRank<T> = {
  /** Scored rows carry more than one currency. */
  mixed: boolean;
  /** The numbered tier, best first: every scored row in a uniform cohort, the graded
   *  tier in a mixed one. */
  ranked: T[];
  /** Template rows withheld from the numbering (always empty in a uniform cohort). */
  template: T[];
  /** Rows with no transfer score. */
  unscored: T[];
  /** Display order: ranked, then template, then unscored. */
  rows: CohortRow<T>[];
};

/** Tier and order one cohort. `pick` reads the rankable part of a wrapped row (the
 *  shortlist ranks `{ s, channel }`). */
export function rankCohort<T>(items: readonly T[], pick: (item: T) => Rankable = (item) => item as Rankable): CohortRank<T> {
  const cmp = (a: T, b: T) => compareByTransferScore(pick(a), pick(b));
  const graded: T[] = [];
  const template: T[] = [];
  const unscored: T[] = [];
  for (const item of items) {
    const r = pick(item);
    if (scoreOf(r) === null) unscored.push(item);
    else if (evaluationCurrency(r.evaluation) === "template") template.push(item);
    else graded.push(item);
  }
  graded.sort(cmp);
  template.sort(cmp);
  const mixed = graded.length > 0 && template.length > 0;
  // Uniform: whichever tier is populated is the numbered one, ranked exactly as before.
  const ranked = mixed ? graded : graded.length > 0 ? graded : template;
  const withheld = mixed ? template : [];
  const rows: CohortRow<T>[] = [
    ...ranked.map((item, i) => ({ item, rank: i + 1, currency: evaluationCurrency(pick(item).evaluation) })),
    ...withheld.map((item) => ({ item, rank: null, currency: "template" as const })),
    ...unscored.map((item) => ({ item, rank: null, currency: null })),
  ];
  return { mixed, ranked, template: withheld, unscored, rows };
}

/** Who the orchestrator auto-promotes: the numbered tier at or above the floor, best
 *  first, at most topN. In a uniform cohort this is exactly the old
 *  filter(>= floor) / sort / slice(topN). */
export function autoPromoteSlate<T>(rank: CohortRank<T>, floor: number, topN: number, pick: (item: T) => Rankable = (item) => item as Rankable): T[] {
  return rank.ranked.filter((item) => (scoreOf(pick(item)) ?? -Infinity) >= floor).slice(0, Math.max(0, topN));
}

/** How many template rows cleared the floor yet were withheld from auto-promotion: the
 *  count behind the lifecycle outcome's `mixed_currency` warning. */
export function withheldFromPromotion<T>(rank: CohortRank<T>, floor: number, pick: (item: T) => Rankable = (item) => item as Rankable): number {
  return rank.template.filter((item) => (scoreOf(pick(item)) ?? -Infinity) >= floor).length;
}
