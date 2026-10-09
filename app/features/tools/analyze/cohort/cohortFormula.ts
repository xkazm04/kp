// Cohort engine, the formulas: every formula-made rating, ONCE (spark analyze-v2-cohort).
//
// The cells (cohortProject.ts) round these floats into ratings and the why-engine
// (cohortWhy.ts) decomposes the SAME floats into a score anatomy, so a rating and the
// parts that explain it can never come from two copies of one formula.
//
// CLIENT-SAFE and pure: type-only imports, no I/O.
import type { Analysis, GithubAnalysis } from "../../../../_lib/schemas.ts";

export const clampRating = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export const norm = (s: string): string => s.trim().toLowerCase();

/** A part of 0 that came out of a negative product is -0; the wire and deepEqual want 0. */
const plainZero = (n: number): number => n + 0;

// ---- skills ------------------------------------------------------------------------

/** matched / missing / unproven, with unproven pulled out of the other two (case-insensitive). */
export function skillSets(analysis: Analysis): { matched: string[]; missing: string[]; unproven: string[] } | null {
  const jf = analysis.jobFit;
  if (!jf) return null;
  const unproven = jf.unprovenSkills ?? [];
  const u = new Set(unproven.map(norm));
  return {
    matched: jf.matchingSkills.filter((s) => !u.has(norm(s))),
    missing: jf.missingSkills.filter((s) => !u.has(norm(s))),
    unproven,
  };
}

/** An unproven skill earns half of a shown one. */
export const UNPROVEN_SHARE = 0.5;

/** (proven matched + half of unproven) / (matched + unproven + missing) * 100; null with nothing to measure. */
export function skillsRaw(sets: { matched: string[]; missing: string[]; unproven: string[] }): number | null {
  const total = sets.matched.length + sets.unproven.length + sets.missing.length;
  if (total === 0) return null;
  return ((sets.matched.length + UNPROVEN_SHARE * sets.unproven.length) / total) * 100;
}

// ---- experience --------------------------------------------------------------------

/** The maxima of the two score parts the experience rating reads. */
export const EXPERIENCE_MAX = { experience: 25, roleSeniority: 23 } as const;
/** score.experience (max 25) + score.roleSeniority (max 23) = 48. */
export const EXPERIENCE_SCALE = EXPERIENCE_MAX.experience + EXPERIENCE_MAX.roleSeniority;

export function experienceRaw(score: Analysis["score"]): number {
  return ((score.experience + score.roleSeniority) / EXPERIENCE_SCALE) * 100;
}

// ---- signals -----------------------------------------------------------------------

export const SIGNALS_BASE = 50;
export const SIGNAL_WEIGHT = 12;

/** The weight of a confidence the analysis did not state. */
export const confidenceOf = (c: number | null | undefined): number => (typeof c === "number" && Number.isFinite(c) ? c : 0.5);

export function signalsRaw(ss: NonNullable<Analysis["softSignals"]>): number {
  const plus = ss.strengths.reduce((a, s) => a + confidenceOf(s.confidence), 0);
  const minus = ss.antipatterns.reduce((a, s) => a + confidenceOf(s.confidence), 0);
  return SIGNALS_BASE + SIGNAL_WEIGHT * (plus - minus);
}

// ---- trust -------------------------------------------------------------------------

export const TRUST_BASE = 100;
export const TRUST_PENALTY = { warn: 15, blocker: 40 } as const;

export function trustRaw(findings: NonNullable<Analysis["trustFindings"]>): number {
  const warns = findings.filter((f) => f.severity === "warn").length;
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  return TRUST_BASE - TRUST_PENALTY.warn * warns - TRUST_PENALTY.blocker * blockers;
}

// ---- salary ------------------------------------------------------------------------

export const SALARY_BASE = 100;
/** Rating points lost per unit of relative distance outside the range. */
export const SALARY_SLOPE = 150;
/**
 * The criteria matrix's "partial": outside the range but within this fraction of the
 * nearest edge (the rating is still 85 or more). A presentation threshold over the
 * formula, never part of it.
 */
export const SALARY_SOFT_WINDOW = 0.1;

export type SalarySide = "inside" | "below" | "above";

/** Where a midpoint sits against [min, max] (either edge may be open), as a fraction of the nearest edge. */
export function salaryDistance(midpoint: number, min: number | null, max: number | null): { side: SalarySide; fraction: number } {
  if (min != null && midpoint < min) return { side: "below", fraction: (min - midpoint) / Math.max(min, 1) };
  if (max != null && midpoint > max) return { side: "above", fraction: (midpoint - max) / Math.max(max, 1) };
  return { side: "inside", fraction: 0 };
}

/** 100 inside; 100 - 150 * distance outside (unclamped). */
export function salaryRaw(midpoint: number, min: number | null, max: number | null): number {
  const { side, fraction } = salaryDistance(midpoint, min, max);
  return side === "inside" ? SALARY_BASE : SALARY_BASE - SALARY_SLOPE * fraction;
}

/**
 * Rate a midpoint against a range [min, max] (either edge may be null = open).
 * Inside (inclusive) -> 100. Outside -> 100 - 150 * d, where d is the distance to the
 * nearest edge as a fraction of that edge: 10% outside = 85, 20% = 70, 1/3 = 50,
 * 2/3 or more = 0. Symmetric on purpose: far below the band is a seniority question,
 * far above it a budget question, and neither is "better".
 */
export function rateAgainstRange(midpoint: number, min: number | null, max: number | null): number {
  return clampRating(salaryRaw(midpoint, min, max));
}

// ---- public work -------------------------------------------------------------------

/** Stars saturate at 1000: log10(1 + stars) / log10(1001). */
export const STAR_SATURATION = 1000;
/** Active repos saturate at 10. */
export const ACTIVE_SATURATION = 10;
/** Rating points per factor: with a JD skill comparison, and without one (the two measured parts carry it all). */
export const PUBLIC_WORK_WEIGHTS = { compared: { skills: 40, active: 30, stars: 30 }, noJd: { skills: 0, active: 50, stars: 50 } } as const;

export function publicWorkFactors(gh: GithubAnalysis): { matched: number; compared: number; active: number; stars: number } {
  const matched = gh.jobFitSignals.matchingSkills.length;
  return {
    matched,
    compared: matched + gh.jobFitSignals.potentialGaps.length,
    active: Math.min(gh.metrics.activeRepos, ACTIVE_SATURATION) / ACTIVE_SATURATION,
    stars: Math.min(1, Math.log10(1 + Math.max(0, gh.metrics.totalStars)) / Math.log10(1 + STAR_SATURATION)),
  };
}

/** 40% matched-skill ratio + 30% active + 30% stars; with no JD skill compared, 50/50 of the two measured parts. */
export function publicWorkRaw(gh: GithubAnalysis): number {
  const { matched, compared, active, stars } = publicWorkFactors(gh);
  // No JD skill was compared: the two measured parts carry the whole weight (30/60 each)
  // rather than scoring an unread ratio as 0.
  if (compared === 0) return ((0.3 * active + 0.3 * stars) / 0.6) * 100;
  return (0.4 * (matched / compared) + 0.3 * active + 0.3 * stars) * 100;
}

export function publicWorkRating(gh: GithubAnalysis): number {
  return clampRating(publicWorkRaw(gh));
}

// ---- exact decomposition -------------------------------------------------------------

/**
 * Integer points per part that sum EXACTLY to `target` (largest-remainder apportionment):
 * every part is floored, and the units still owed go one each to the parts with the
 * largest fractional remainders (ties: list order). Each part ends within 1 point of its
 * exact value. Float noise that would leave units owed beyond that is put on the
 * largest part, so the sum is exact whatever the input.
 */
export function apportion(exact: readonly number[], target: number): number[] {
  if (exact.length === 0) return [];
  const out = exact.map((x) => Math.floor(x));
  let owed = target - out.reduce((a, b) => a + b, 0);
  const order = exact.map((_, i) => i).sort((a, b) => exact[b] - out[b] - (exact[a] - out[a]) || a - b);
  for (let j = 0; owed > 0 && j < order.length; j++, owed--) out[order[j]] += 1;
  if (owed !== 0) {
    const largest = exact.reduce((best, x, i) => (Math.abs(x) > Math.abs(exact[best]) ? i : best), 0);
    out[largest] += owed;
  }
  return out.map(plainZero);
}
