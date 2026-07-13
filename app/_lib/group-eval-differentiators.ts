// Differentiators for a Decisions group evaluation: the recommended lead's
// *role-relevant* edge — requirement skills the lead matched that every rival in
// the compared field missed.
//
// The modal surfaces these as "Unique strengths (lead)" chips and the summary
// presents them as the reason to pick the lead, so they have to be decision-
// relevant. The earlier rule derived them from each candidate's top self-declared
// skill *claims* (topSkills) minus every rival's claims, never filtered to the
// role — so a chip could be a skill the job never asked for, while the lead's
// real, role-relevant advantage stayed hidden.
//
// A differentiator is therefore defined as a skill that is, all three:
//   1. one of the role's declared requirements (role-relevant), AND
//   2. an actual match the lead has (matchedSkills — scored, not a raw claim), AND
//   3. matched by NO rival in the compared field (a genuine, exclusive edge).
//
// matchedSkills already only contains requirement skills (pipeline matching's
// score_skills appends req.skill on a match), but we intersect with the
// requirements explicitly so the role-relevance contract holds regardless of how
// matchedSkills was produced — legacy saved payloads, or a future scorer that
// emits bonus/inferred skills beyond the declared requirements. Must-have
// differentiators are ordered first so the strongest reason to pick the lead is
// never dropped by the display cap.

export type DifferentiatorCandidate = { matchedSkills?: string[] | null };
export type Requirement = { skill: string; kind: string };

export function computeDifferentiators(
  lead: DifferentiatorCandidate | null,
  rivals: DifferentiatorCandidate[],
  requirements: Requirement[],
  limit = 5,
): string[] {
  if (!lead) return [];
  // Min-cohort floor (bug-ui-scan-2026-07-09 #4): a "unique strength" is a requirement
  // skill NO rival matched — meaningless with no rivals. With an empty field EVERY
  // requirement skill trivially passes `!rivalMatched.has(skill)` and would be crowned a
  // differentiator ("all skills unique from n=1"). A genuine, EXCLUSIVE edge needs at
  // least one rival to be exclusive AGAINST — so with no rivals there is nothing to
  // differentiate.
  if (rivals.length === 0) return [];
  // Requirement skill -> kind, so the edge can be both constrained to role needs
  // and ordered must-have first.
  const reqKind = new Map(requirements.map((r) => [r.skill, r.kind] as const));
  const rivalMatched = new Set(rivals.flatMap((c) => c.matchedSkills ?? []));
  const edge: string[] = [];
  const seen = new Set<string>();
  for (const skill of lead.matchedSkills ?? []) {
    if (reqKind.has(skill) && !rivalMatched.has(skill) && !seen.has(skill)) {
      seen.add(skill);
      edge.push(skill);
    }
  }
  // Stable sort (V8 keeps insertion order within a tier), so must-haves lead while
  // requirement order is preserved within each tier — then cap, so a must-have
  // edge is never displaced by a nice-to-have one.
  edge.sort((a, b) => Number(reqKind.get(b) === "must_have") - Number(reqKind.get(a) === "must_have"));
  return edge.slice(0, limit);
}
