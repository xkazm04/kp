import type { EvalCandidate } from "./types";

// Returns the catalog key for the source pill; resolved through t() at the call site.
export const sourceLabelKey = (s?: string) => (s === "llm" ? "sourceLlm" : s === "partial" ? "sourcePartial" : "sourceDeterministic");

export const ranWhen = (iso?: string | null): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : null;
};

export const percentOf = (c: EvalCandidate, key: string) => c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;

/** The value that wins a comparison row, or null when NOBODY wins it.
 *
 *  The leader wash is a claim ("this column leads the row"), so it must only appear
 *  when the row actually discriminates. Two states produce no leader:
 *    • every value is absent (null) — an all-unscored field. The row used to map
 *      absent → a -1 SENTINEL and take Math.max, and `-1 > -Infinity` passed, so the
 *      wash was painted on EVERY column of a row where nothing was measured.
 *    • every PRESENT value is identical — an exact tie is a tie, not a lead. (A single
 *      measured value among absent ones falls here too: the wash claims "this column
 *      beat the others", and an unscored column was never in the race.)
 *  A tie AT the top of an otherwise-varying row keeps the wash on each tied column:
 *  they genuinely share the lead, and the row still discriminates against the rest. */
export function rowLeader(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  if (present.every((v) => v === present[0])) return null;
  return Math.max(...present);
}
export const coverageCount = (c: EvalCandidate, mustRows: string[]) => mustRows.filter((s) => (c.matchedSkills ?? []).includes(s)).length;

// Canonical skill rows: the role's requirements (must-have first), else the union
// of every matched/missing skill (a skill is "missing" only when must-have).
export function buildSkillRows(candidates: EvalCandidate[], requirements: { skill: string; kind: string }[]) {
  let rows: { skill: string; mustHave: boolean }[];
  if (requirements.length) {
    rows = requirements.map((r) => ({ skill: r.skill, mustHave: r.kind === "must_have" }));
  } else {
    const union = new Set<string>();
    const must = new Set<string>();
    for (const c of candidates) {
      (c.matchedSkills ?? []).forEach((s) => union.add(s));
      (c.missingSkills ?? []).forEach((s) => {
        union.add(s);
        must.add(s);
      });
    }
    rows = [...union].map((s) => ({ skill: s, mustHave: must.has(s) }));
  }
  rows.sort((a, b) => Number(b.mustHave) - Number(a.mustHave) || a.skill.localeCompare(b.skill));
  return { rows, mustRows: rows.filter((r) => r.mustHave).map((r) => r.skill) };
}

// SCOR3 — one place to assemble the explainable-potential payload off an eval
// candidate, so the two pill sites can't drift.
export function potentialOf(c: EvalCandidate) {
  return {
    score: c.potentialScore ?? 0,
    learningSignals: c.learningSignals,
    transferableSkills: c.transferableSkills,
    domainDistance: c.domainDistance,
  };
}
