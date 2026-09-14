import { createHash } from "node:crypto";
// Explicit ".ts" like intake-brief.ts's own schema import: this is a VALUE
// import and node:test's type-stripping loader resolves specifiers literally —
// an extensionless one breaks `npm run test:unit`.
import { briefStatedRequirements, type StatedRequirement } from "./intake-brief.ts";
import type { RoleBrief } from "./rolespec";

// ADR-0009 (need → role → slate): a role FREEZES ONE VERSIONED RUBRIC derived
// from the RoleBrief's own graded requirements, and every candidate on that
// role's slate is judged against THAT artifact — whether the candidate is a
// person or an AI agent.
//
// Why a frozen artifact rather than a projection computed per candidate:
// before this, editing a JD after promotion silently changed what candidates
// were judged by, and nothing on the record said so. Two candidates scored a
// week apart could carry the same field name, the same 0-100 look, and two
// different questions underneath. Freezing makes the change EXPLICIT — a new
// version is minted and the old evaluations stay attributable to the rubric
// they were actually produced against.
//
// Pure by construction: no DB, no clock, no randomness. The store
// (db/role-rubrics.ts) supplies persistence and the timestamp; this module is
// the contract, and it is unit-testable without a database.

/** One frozen criterion — the requestor's own graded requirement, nothing added.
 *  `kind` is must_have | nice_to_have and `hardness` is prerequisite | learnable
 *  in practice, but both stay free-form strings: the brief schema owns that
 *  vocabulary and this module must not silently drop a value it has not heard of
 *  (dropping a must_have because the word changed is how a rubric lies). */
export type RubricCriterion = {
  skill: string;
  kind: string;
  hardness: string;
  weight: number;
};

export type FrozenRubric = {
  /** Monotonic per role, starting at 1. A brief edit mints the NEXT version;
   *  it never rewrites this one. */
  version: number;
  /** Content address of `criteria`. Two freezes of an unchanged brief produce
   *  the same hash — which is what makes "has the rubric actually changed?"
   *  answerable without diffing prose. */
  criteriaHash: string;
  criteria: RubricCriterion[];
};

/** must_have is the only kind that can BLOCK. Everything else is additive
 *  evidence — a slate must never reject on a nice-to-have. */
export const MUST_KIND = "must_have";

/** A rubric with no criteria cannot judge anyone, so freezing one is a
 *  programming error rather than a degraded-but-usable artifact: a slate built
 *  on it would report every candidate as fully met (vacuous truth), which is
 *  precisely the failure the positive controls in the tests exist to catch. */
export class EmptyRubricError extends Error {
  constructor() {
    super("a role rubric needs at least one graded requirement — the brief states none");
    this.name = "EmptyRubricError";
  }
}

/** Deterministic ordering so the hash is a function of CONTENT, not of the
 *  order the requestor happened to say things in. Sorted by skill, then kind,
 *  so a re-ordered brief is correctly recognized as the same rubric. */
function orderCriteria(criteria: RubricCriterion[]): RubricCriterion[] {
  return [...criteria].sort((a, b) => a.skill.localeCompare(b.skill) || a.kind.localeCompare(b.kind));
}

/** Normalized comparison key for a skill. Candidate evidence arrives from three
 *  different producers (CV matcher, scorecard, agent coverage) with three
 *  different casings; matching on the raw string would report a met requirement
 *  as unmet purely on capitalization. */
export function skillKey(skill: string): string {
  return skill.trim().toLowerCase();
}

export function hashCriteria(criteria: RubricCriterion[]): string {
  const canonical = orderCriteria(criteria).map((c) => `${skillKey(c.skill)}|${c.kind}|${c.hardness}|${c.weight}`);
  return createHash("sha256").update(canonical.join("\n")).digest("hex").slice(0, 16);
}

/** Freeze a RoleBrief into the role's rubric at `version`.
 *
 *  Callers pass the version rather than having it inferred here: deciding
 *  WHICH version this is requires knowing the role's history, which is the
 *  store's job, not this pure module's. */
export function freezeRubric(brief: RoleBrief, version = 1): FrozenRubric {
  const stated: StatedRequirement[] = briefStatedRequirements(brief);
  const criteria = orderCriteria(
    stated.map((r) => ({ skill: r.skill, kind: r.kind, hardness: r.hardness, weight: r.weight }))
  );
  if (criteria.length === 0) throw new EmptyRubricError();
  return { version, criteriaHash: hashCriteria(criteria), criteria };
}

/** True when `next` would judge candidates differently from `current` — the
 *  only condition under which a re-freeze is worth a new version. A JD edit
 *  that changed only prose leaves the rubric alone. */
export function rubricWouldChange(current: FrozenRubric, nextBrief: RoleBrief): boolean {
  const stated = briefStatedRequirements(nextBrief);
  if (stated.length === 0) return false;
  return hashCriteria(stated.map((r) => ({ ...r }))) !== current.criteriaHash;
}

// ---------------------------------------------------------------------------
// Evaluation — ONE function, both populations
// ---------------------------------------------------------------------------

/** What a candidate demonstrably covers, in the rubric's own vocabulary.
 *
 *  This is the seam that lets a person and an AI agent land on the same board
 *  with the same evaluation: a human's covered skills come from the CV/scorecard
 *  side, an agent's from its per-responsibility coverage assessment, and BOTH
 *  arrive here as the same shape. Neither producer gets to invent an evaluation
 *  field of its own. */
export type CandidateEvidence = {
  /** Skills the candidate is evidenced to have, in any casing. */
  covered: string[];
  /** Where the evidence came from, carried onto the verdict so the board can say
   *  WHY, and so an "unassessed" candidate is visibly different from a poor one. */
  source: "cv" | "scorecard" | "agent_fit" | "unassessed";
};

export type CriterionVerdict = {
  skill: string;
  kind: string;
  hardness: string;
  weight: number;
  met: boolean;
};

/** The evaluation fields EVERY slate member carries, human or agent.
 *
 *  Deliberately NOT a single 0-100. ADR-0008 and the match-score lesson both
 *  say the same thing: normalizing two different questions onto one shared
 *  scale at display time fabricates comparability, and here that fabrication
 *  would be sealed into a decision about a person. Must-coverage and
 *  nice-coverage are reported SEPARATELY, as ratios of the weight actually on
 *  the table, and `unmetMust` names what is missing rather than deducting for
 *  it silently. */
export type RubricEvaluation = {
  rubricVersion: number;
  criteriaHash: string;
  source: CandidateEvidence["source"];
  perCriterion: CriterionVerdict[];
  /** Fraction of must_have WEIGHT met, in [0,1]. 0 when the rubric states no
   *  must_haves — never 1: "nothing required" is not "everything met". */
  mustCoverage: number;
  /** Same, over every non-must criterion. */
  niceCoverage: number;
  /** The must_have skills this candidate does not evidence. The board's reason
   *  string, and the only field a rejection may cite. */
  unmetMust: string[];
};

function weightOf(criteria: CriterionVerdict[]): number {
  return criteria.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);
}

/** Judge one candidate against the role's frozen rubric.
 *
 *  Called identically for a person and for an AI agent — that identity IS the
 *  "same evaluation" half of the hire-from-need goal, and it is why this lives
 *  in a pure module both callers can reach rather than inside either store. */
export function evaluateAgainstRubric(rubric: FrozenRubric, evidence: CandidateEvidence): RubricEvaluation {
  // An unassessed candidate has no evidence to weigh. Treating its empty
  // `covered` list as "meets nothing" would put a real 0 on the board beside
  // real scores and read as a judgement that was never made.
  const covered = new Set(evidence.source === "unassessed" ? [] : evidence.covered.map(skillKey));
  const perCriterion: CriterionVerdict[] = rubric.criteria.map((c) => ({
    skill: c.skill,
    kind: c.kind,
    hardness: c.hardness,
    weight: c.weight,
    met: covered.has(skillKey(c.skill)),
  }));
  const musts = perCriterion.filter((c) => c.kind === MUST_KIND);
  const nices = perCriterion.filter((c) => c.kind !== MUST_KIND);
  const mustWeight = weightOf(musts);
  const niceWeight = weightOf(nices);
  return {
    rubricVersion: rubric.version,
    criteriaHash: rubric.criteriaHash,
    source: evidence.source,
    perCriterion,
    mustCoverage: mustWeight > 0 ? weightOf(musts.filter((c) => c.met)) / mustWeight : 0,
    niceCoverage: niceWeight > 0 ? weightOf(nices.filter((c) => c.met)) / niceWeight : 0,
    unmetMust: musts.filter((c) => !c.met).map((c) => c.skill),
  };
}
