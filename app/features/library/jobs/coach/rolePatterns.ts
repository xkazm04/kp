// The role coach's LEDGER OF PATTERNS — the pure half.
//
// The old coach answered one question ("will this JD fill?") with a verdict banner and
// a list of loosening suggestions. This turns the same grade inside out: every finding
// the pool shows against the role becomes a ROW in a ledger the recruiter can weigh,
// and the weights are durable (role-priorities-store.ts) instead of being re-decided in
// the recruiter's head on every visit.
//
// Everything here is pure and React-free so the three variants share ONE derivation and
// the derivation is unit-testable (rolePatterns.test.ts).

import type { Winnability } from "./winnabilityTypes";

/** The grade this ledger is derived from — re-exported so consumers import one module. */
export type { Gate, MustHave, Salary, Winnability } from "./winnabilityTypes";

// ---- Patterns ---------------------------------------------------------------

export type PatternKind = "language" | "education" | "skill" | "salary";

export type RolePattern = {
  /** Stable across reloads — it is the key the priority map is stored under, so it
   *  must not encode a count or an ordering. */
  id: string;
  kind: PatternKind;
  /** The requirement itself: a language, an education floor, a skill, or the role
   *  family whose market band the salary is measured against. */
  value: string;
  /** How many candidates this pattern costs the role. */
  affected: number;
  /** The population `affected` is measured against — stated per row because it is
   *  NOT the same for every kind (a gate is measured over the whole pool, a missing
   *  skill only over the candidates who already clear the gates). */
  denominator: number;
  /** affected / denominator, or null when the pattern has no countable share (the
   *  salary band costs candidates in a market the pool cannot measure). */
  share: number | null;
  /** The coach's counterfactual "+N if you loosen this" — 0 when the scorer ruled
   *  the gain out, which is an answer, not a missing value. */
  gain: number;
  /** Whether the pattern can hand off into the JD editor. The salary row cannot: the
   *  matchable band is fixed to the grounded market analysis, so editing the JD's
   *  wording can't move it. */
  editable: boolean;
};

/** The vocabulary itself lives in app/_lib/role-priorities.ts (both ends of the wire
 *  share it); re-exported here so the three variants import ONE module. */
export { PRIORITY_LEVELS, PRIORITY_WEIGHT } from "@/app/_lib/role-priorities";
export type { PriorityLevel, RolePriorityMap } from "@/app/_lib/role-priorities";

function gateId(kind: "language" | "education", value: string): string {
  return `${kind}:${value}`;
}

/** Turn a winnability grade into the ledger's rows, ordered by how many candidates
 *  each pattern costs. A pattern that costs nobody is not a finding and is dropped —
 *  the ledger is the list of things worth weighing, not an inventory of requirements. */
export function derivePatterns(win: Winnability | null): RolePattern[] {
  if (!win || win.poolSize <= 0) return [];
  const pool = win.poolSize;
  const eligible = win.eligible ?? 0;
  const out: RolePattern[] = [];

  for (const g of win.looseGates ?? []) {
    if (g.eligibleDelta <= 0) continue;
    out.push({
      id: gateId(g.kind, g.value),
      kind: g.kind,
      value: g.value,
      affected: g.eligibleDelta,
      denominator: pool,
      share: pool > 0 ? g.eligibleDelta / pool : null,
      gain: g.eligibleDelta,
      editable: true,
    });
  }

  for (const m of win.looseMustHaves ?? []) {
    // A must-have is a finding when candidates LACK it or when demoting it would
    // shortlist more people — the two are different measurements of the same
    // requirement and either one alone is worth a row.
    if (m.qualifiedDelta <= 0 && m.missingAmongEligible <= 0) continue;
    out.push({
      id: `skill:${m.skill}`,
      kind: "skill",
      value: m.skill,
      affected: m.missingAmongEligible,
      // Measured among the candidates who already clear the gates, which is what
      // winnability.py counts — quoting it against the whole pool would inflate it.
      denominator: eligible,
      share: eligible > 0 ? m.missingAmongEligible / eligible : null,
      gain: m.qualifiedDelta,
      editable: true,
    });
  }

  const salary = win.salary;
  // Only a BELOW-MARKET band is a pattern. `belowMarket === null` is the verdict
  // honestly silenced across an unconverted FX gap, and a band in line with the
  // market is not something to weigh.
  if (salary?.marketBand && salary.belowMarket === true) {
    out.push({
      id: "salary:band",
      kind: "salary",
      value: salary.family || salary.seniority || "",
      affected: 0,
      denominator: pool,
      // No countable share: the candidates a low band costs are the ones who never
      // applied, and the pool cannot see them. The UI renders this as a dash rather
      // than as a zero, which would read as "this costs nobody".
      share: null,
      gain: 0,
      editable: false,
    });
  }

  return out.sort((a, b) => b.affected - a.affected || b.gain - a.gain || a.id.localeCompare(b.id));
}
