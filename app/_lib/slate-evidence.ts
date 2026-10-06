import type { RubricAxis } from "./schemas.generated";
import type { AxisEvidence, CandidateEvidence } from "./role-rubric";

// The evidence adapters of ADR-0012 §3: what a CV analysis (a person) or an
// agent-fit spec (an agent) says about each rubric axis, in the one shape
// evaluateAgainstRubric reads. Pure — no DB read, no model call, no I/O — and
// deliberately not wired anywhere yet: where evidence is computed and persisted
// is the next increment, and opening a board must not trigger scoring.
//
// Only `requirement_coverage` axes are ever filled (their sources are `analysis`
// for a person, `agent_fit` for an agent). Facet and cost axes belong to other
// producers. An axis the evidence does not name is LEFT OUT — unassessed, never 0.

/** The producer's own scale (pipeline/jobfit/agentfit.py, the coverage ratio). */
export const AGENT_COVERAGE_SCORE: Readonly<Record<string, number>> = Object.freeze({
  automatable: 1,
  assisted: 0.5,
  human_only: 0,
});

/** The key deriveRoleRubric gives a requirement: whitespace collapsed, lower-cased. */
function requirementKey(skill: string): string | null {
  const label = skill.split(/\s+/).filter(Boolean).join(" ");
  return label ? `req:${label.toLowerCase()}` : null;
}

/** Keys of the axes this adapter may fill, so a stray name can never reach a facet or cost axis. */
function fillableKeys(axes: readonly RubricAxis[]): Set<string> {
  return new Set(axes.filter((a) => a.evidenceClass === "requirement_coverage").map((a) => a.key));
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Person: skills the analysis matched score 1, skills it names missing score 0.
 *  A skill in both lists is contradictory and left unassessed. */
export function humanEvidence(
  axes: readonly RubricAxis[],
  analysis: { jobFit?: { matchingSkills?: readonly string[] | null; missingSkills?: readonly string[] | null } | null } | null | undefined,
  evidenceRef: string
): CandidateEvidence {
  const fillable = fillableKeys(axes);
  const keysOf = (list: unknown) => {
    const out = new Set<string>();
    for (const skill of strings(list)) {
      const key = requirementKey(skill);
      if (key && fillable.has(key)) out.add(key);
    }
    return out;
  };
  const matching = keysOf(analysis?.jobFit?.matchingSkills);
  const missing = keysOf(analysis?.jobFit?.missingSkills);
  const out: Record<string, AxisEvidence> = {};
  for (const key of matching) if (!missing.has(key)) out[key] = { score: 1, evidenceRef };
  for (const key of missing) if (!matching.has(key)) out[key] = { score: 0, evidenceRef };
  return { population: "human", axes: out };
}

/** Agent: each `fit.coverage[]` row is scored on the producer's scale. `fit` is
 *  stored as unknown, so anything malformed yields no axes. */
export function agentEvidence(axes: readonly RubricAxis[], fit: unknown, evidenceRef: string): CandidateEvidence {
  const out: Record<string, AxisEvidence> = {};
  const rows = fit && typeof fit === "object" ? (fit as { coverage?: unknown }).coverage : undefined;
  if (Array.isArray(rows)) {
    const fillable = fillableKeys(axes);
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const { item, coverage } = row as { item?: unknown; coverage?: unknown };
      if (typeof item !== "string" || typeof coverage !== "string") continue;
      if (!Object.prototype.hasOwnProperty.call(AGENT_COVERAGE_SCORE, coverage)) continue;
      const key = requirementKey(item);
      if (key && fillable.has(key)) out[key] = { score: AGENT_COVERAGE_SCORE[coverage], evidenceRef };
    }
  }
  return { population: "agent", axes: out };
}
