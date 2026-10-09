// Cohort engine, half two: every comparative claim, decided by code (spark
// analyze-v2-cohort, WP1). The language model never changes these — it receives them.
//
// The registry's comparative-shortlist-evaluation, applied:
//  - an ORDER is always available; a LEAD is a claim. A leader is named only when the
//    top member's band floor clears the runner-up's band ceiling (strictly: bands that
//    merely touch overlap) — confidence-band-lead-separation.
//  - below COHORT_MIN rated members there is no leader, no separation, no robustness —
//    minimum-cohort-before-a-comparative-claim.
//  - salary never names a leader (more expensive is not better), and a cohort quoting
//    several currencies/pay bases is partitioned, never converted —
//    refuse-a-cross-currency-comparison.
//  - robustness re-ranks under three weight schemes and reports stable / sensitive /
//    undetermined; it never re-ranks on uncertainty — cross-scheme-weight-robustness.
//  - a near copy of a contender, dominated by it on every compared dimension, is
//    flagged as a decoy (isDecoyOf states the three conditions and why).
//  - the presentation order is a recorded, seeded shuffle that does not encode the
//    verdict — counterbalanced-candidate-order.
import type { CohortClaims, CohortDimension, DimensionClaim, Robustness, Separation } from "./cohortTypes.ts";
import { COHORT_DIMENSIONS, COHORT_MIN, NARRATIVE_TOP } from "./cohortTypes.ts";
import type { ProjectedMember } from "./cohortProject.ts";

// ---- neutral order -----------------------------------------------------------------

/** FNV-1a, 32-bit: a stable string hash with no dependency. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic PRNG over a 32-bit seed, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The neutral presentation order: a Fisher-Yates shuffle seeded by the cohort id over
 * the member ids in sorted order. It depends only on (cohortId, the SET of ids) — not
 * on input order and not on any rating — so it is reproducible and encodes no verdict.
 */
export function neutralOrder(cohortId: string, memberIds: string[]): string[] {
  const ids = [...new Set(memberIds)].sort(byId);
  const rand = seededRandom(hashSeed(`cohort:${cohortId}`));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

// ---- per-dimension separation ------------------------------------------------------

/** The half-width used for a dimension whose cells carry no band of their own. */
export const DEFAULT_BAND = 6;

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

/** A rated cell's band: its own when it has one, else rating +/- DEFAULT_BAND. */
export function bandOf(m: ProjectedMember, d: CohortDimension): { lo: number; hi: number } | null {
  const cell = m.cells[d];
  if (cell.rating == null) return null;
  if (cell.band) return { lo: cell.band.lo, hi: cell.band.hi };
  return { lo: clamp100(cell.rating - DEFAULT_BAND), hi: clamp100(cell.rating + DEFAULT_BAND) };
}

/** Rated members on a dimension, best first; ties keep memberId order (never a coin toss). */
export function rankedOn(members: ProjectedMember[], d: CohortDimension): ProjectedMember[] {
  return members
    .filter((m) => m.cells[d].rating != null)
    .sort((a, b) => (b.cells[d].rating as number) - (a.cells[d].rating as number) || byId(a.memberId, b.memberId));
}

function separationOf(ranked: ProjectedMember[], d: CohortDimension): { leader: string | null; separation: Separation } {
  if (ranked.length < COHORT_MIN) return { leader: null, separation: "belowFloor" };
  const top = bandOf(ranked[0], d)!;
  const second = bandOf(ranked[1], d)!;
  // Strict: a zero-width gap is not a separation, and the boundary never resolves in the crown's favour.
  return top.lo > second.hi ? { leader: ranked[0].memberId, separation: "clears" } : { leader: null, separation: "insideNoise" };
}

/** Salary partitions by currency/pay basis, largest first (a tie goes to the alphabetically first key). */
export function salaryPartitions(members: ProjectedMember[]): Array<{ key: string; memberIds: string[] }> {
  const parts = new Map<string, string[]>();
  for (const m of members) {
    const s = m.detail.salary;
    if (!s || !s.currency || !s.period || s.midpoint == null) continue;
    const key = `${s.currency.trim().toUpperCase()}/${s.period.trim().toLowerCase()}`;
    parts.set(key, [...(parts.get(key) ?? []), m.memberId]);
  }
  return [...parts.entries()]
    .sort((a, b) => b[1].length - a[1].length || byId(a[0], b[0]))
    .map(([key, memberIds]) => ({ key, memberIds }));
}

function dimensionClaim(members: ProjectedMember[], d: CohortDimension): DimensionClaim {
  const ranked = rankedOn(members, d);
  if (d === "salary") {
    // Salary is ordered, never crowned: there is no lead to separate, so the claim is
    // "insideNoise" (ordered, not separated) once the floor is met.
    const claim: DimensionClaim = { dimension: d, leader: null, separation: ranked.length < COHORT_MIN ? "belowFloor" : "insideNoise", rated: ranked.length };
    const partitions = salaryPartitions(members);
    if (partitions.length > 1) claim.partitions = partitions;
    return claim;
  }
  return { dimension: d, ...separationOf(ranked, d), rated: ranked.length };
}

// ---- robustness --------------------------------------------------------------------

/** The five merit dimensions the overall order is composed from. */
export const ROBUSTNESS_DIMENSIONS = ["fit", "skills", "experience", "signals", "trust"] as const satisfies readonly CohortDimension[];
type RobustDim = (typeof ROBUSTNESS_DIMENSIONS)[number];

/** Three reasonable yardsticks. Every dimension stays above zero (reweighting, never redefining). */
export const WEIGHT_SCHEMES: Record<"equal" | "fitHeavy" | "skillsHeavy", Record<RobustDim, number>> = {
  equal: { fit: 0.2, skills: 0.2, experience: 0.2, signals: 0.2, trust: 0.2 },
  fitHeavy: { fit: 0.5, skills: 0.125, experience: 0.125, signals: 0.125, trust: 0.125 },
  skillsHeavy: { fit: 0.125, skills: 0.5, experience: 0.125, signals: 0.125, trust: 0.125 },
};

/**
 * stable = the same single top under all three schemes; sensitive = the top changes, or
 * is tied, under any of them; undetermined = fewer than COHORT_MIN members are rated on
 * ALL five dimensions (a partial row is never imputed into a composite).
 */
export function robustnessOf(members: ProjectedMember[]): Robustness {
  const full = members.filter((m) => ROBUSTNESS_DIMENSIONS.every((d) => m.cells[d].rating != null));
  if (full.length < COHORT_MIN) return "undetermined";
  const tops = Object.values(WEIGHT_SCHEMES).map((w) => {
    const scored = full.map((m) => ({
      id: m.memberId,
      // Integer-weighted sum (x1000) so float noise can never fake or break a tie.
      score: ROBUSTNESS_DIMENSIONS.reduce((acc, d) => acc + Math.round(w[d] * 1000) * (m.cells[d].rating as number), 0),
    }));
    const best = Math.max(...scored.map((s) => s.score));
    const atTop = scored.filter((s) => s.score === best);
    return atTop.length === 1 ? atTop[0].id : null;
  });
  return tops.every((t) => t !== null && t === tops[0]) ? "stable" : "sensitive";
}

// ---- ranks and decoys --------------------------------------------------------------

/** 1-based fit rank among fit-rated members; equal ratings SHARE a rank (1, 1, 3). */
export function fitRanks(members: ProjectedMember[]): Map<string, number> {
  const ranked = rankedOn(members, "fit");
  const out = new Map<string, number>();
  ranked.forEach((m, i) => {
    const prev = ranked[i - 1];
    out.set(m.memberId, prev && prev.cells.fit.rating === m.cells.fit.rating ? out.get(prev.memberId)! : i + 1);
  });
  return out;
}

/**
 * The dimensions dominance is judged on. Salary is excluded: its rating is band fit, a
 * budget question rather than merit, and "more expensive is not better" cuts both ways.
 */
export const DOMINANCE_DIMENSIONS = ["fit", "skills", "experience", "signals", "trust", "publicWork"] as const satisfies readonly CohortDimension[];
export const DECOY_MIN_SHARED = 3;

/** Does `y` dominate `x`: >= 3 shared rated dimensions, y >= x on all, > on at least one. */
export function dominates(y: ProjectedMember, x: ProjectedMember): boolean {
  if (y.memberId === x.memberId) return false;
  let shared = 0;
  let strictly = false;
  for (const d of DOMINANCE_DIMENSIONS) {
    const ry = y.cells[d].rating;
    const rx = x.cells[d].rating;
    if (ry == null || rx == null) continue;
    shared++;
    if (ry < rx) return false;
    if (ry > rx) strictly = true;
  }
  return shared >= DECOY_MIN_SHARED && strictly;
}

/**
 * The decoy rule. The registry (comparative-shortlist-evaluation /
 * minimum-cohort-before-a-comparative-claim, "decoy or attraction effect"): adding a
 * member dominated on every dimension by another can shift the choice toward the member
 * who dominates them, so such a member is flagged. That effect distorts a choice AMONG
 * CONTENDERS: it needs a near copy of a real option. So dominance alone is not enough —
 * X is a decoy of Y only when
 *   1. Y dominates X (>= DECOY_MIN_SHARED shared rated merit dimensions, >= on all, > on one),
 *   2. their FIT bands overlap (inclusive: touching bands overlap) — X reads as a
 *      slightly worse copy of Y, not as a different tier, and
 *   3. Y is a contender: its fitRank is within NARRATIVE_TOP.
 * A weak, off-profile member dominated by an all-rounder is not a decoy; it is simply
 * further down the order, which the ranking already says.
 */
export function isDecoyOf(y: ProjectedMember, x: ProjectedMember, ranks: Map<string, number>): boolean {
  const rank = ranks.get(y.memberId);
  if (rank == null || rank > NARRATIVE_TOP) return false;
  const by = bandOf(y, "fit");
  const bx = bandOf(x, "fit");
  if (!by || !bx || by.lo > bx.hi || bx.lo > by.hi) return false;
  return dominates(y, x);
}

/** decoyOf: among the members X is a decoy of, the one with the best fit rank (then memberId order). */
export function decoys(members: ProjectedMember[], ranks: Map<string, number>): Map<string, string> {
  const out = new Map<string, string>();
  const rankOf = (id: string) => ranks.get(id) ?? Number.POSITIVE_INFINITY;
  for (const x of members) {
    const over = members.filter((y) => isDecoyOf(y, x, ranks));
    if (!over.length) continue;
    over.sort((a, b) => rankOf(a.memberId) - rankOf(b.memberId) || byId(a.memberId, b.memberId));
    out.set(x.memberId, over[0].memberId);
  }
  return out;
}

// ---- the whole set -----------------------------------------------------------------

export function computeCohortClaims(
  members: ProjectedMember[],
  cohortId: string
): { claims: CohortClaims; fitRank: Map<string, number>; decoyOf: Map<string, string>; neutralIndex: Map<string, number> } {
  const byDimension = {} as Record<CohortDimension, DimensionClaim>;
  for (const d of COHORT_DIMENSIONS) byDimension[d] = dimensionClaim(members, d);
  const fit = byDimension.fit;
  const fitRank = fitRanks(members);
  const neutralIndex = new Map(neutralOrder(cohortId, members.map((m) => m.memberId)).map((id, i) => [id, i] as const));
  return {
    claims: {
      overall: { leader: fit.leader, separation: fit.separation, robustness: robustnessOf(members) },
      byDimension,
    },
    fitRank,
    decoyOf: decoys(members, fitRank),
    neutralIndex,
  };
}
