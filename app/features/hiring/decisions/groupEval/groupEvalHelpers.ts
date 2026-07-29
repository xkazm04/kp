import type { EvalCandidate } from "@/app/features/shared/groupEvalTypes";

// Returns the catalog key for the source pill; resolved through t() at the call site.
export const sourceLabelKey = (s?: string) => (s === "llm" ? "sourceLlm" : s === "partial" ? "sourcePartial" : "sourceDeterministic");

export const ranWhen = (iso?: string | null): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : null;
};

export const percentOf = (c: EvalCandidate, key: string) => c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;
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
