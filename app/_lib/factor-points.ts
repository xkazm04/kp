import type { Analysis } from "./schemas.ts";

// The score-breakdown chart's normalization contract, kept OUT of FactorChart.tsx so it is
// unit-testable: that component imports recharts + React, which a bare `node --test` cannot
// load. Type-only import above is erased at runtime, so this module stays import-free.

// Fixed per-factor ceilings — the max points each score component can reach. Each factor has
// a DIFFERENT ceiling, so raw values are NOT comparable across bars; normalizing by these
// makes every bar a 0..1 fraction of its own max.
export const FACTOR_MAXES = [
  { id: "experience", max: 25 },
  { id: "skills", max: 30 },
  { id: "role", max: 23 },
  { id: "education", max: 12 },
  { id: "traits", max: 10 },
] as const;

// The chart's Y-axis is PINNED to this domain. Bars encode value/max in [0,1].
//
// Previously the `<YAxis>` carried no `domain`, so recharts auto-scaled it to the largest
// bar VALUE. A candidate whose components were all weak (experience 8/25, skills 7/30, ...)
// had their tallest bar drawn at full height — a recruiter reads "maxed out" where the true
// figure is 8/25. The domain also floated per candidate, so two charts could not be compared
// by eye. Height now means the same thing in every chart.
export const FACTOR_DOMAIN: readonly [number, number] = [0, 1];

export type FactorId = (typeof FACTOR_MAXES)[number]["id"];
export type FactorPoint = { id: FactorId; value: number; max: number; ratio: number };

/** Pure, render-free projection of a score into per-factor points: the raw `value`, its
 *  `max`, and `ratio` = value/max clamped to [0,1], which is what the bar height encodes.
 *  The raw `value`/`max` ride along for the tooltip so the true figure is never hidden. */
export function factorPoints(score: Analysis["score"]): FactorPoint[] {
  const raw: Record<FactorId, number> = {
    experience: score.experience,
    skills: score.skills,
    role: score.roleSeniority,
    education: score.education,
    traits: score.traits,
  };
  return FACTOR_MAXES.map(({ id, max }) => {
    const value = raw[id] ?? 0;
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    return { id, value, max, ratio };
  });
}
