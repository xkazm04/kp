import type { RoleBrief } from "./rolespec";

// Pure projection of a RoleBrief onto the JD builder's inputs (promote step,
// docs/concepts/role-intake-dialog.md). No imports beyond the type so the
// contract is unit-testable without a DB (intake-brief.test.ts).

export function briefMustSkills(brief: RoleBrief): string[] {
  return (brief.requirements ?? []).filter((r) => r.kind === "must_have").map((r) => r.skill);
}

export function briefNiceSkills(brief: RoleBrief): string[] {
  return (brief.requirements ?? []).filter((r) => r.kind === "nice_to_have").map((r) => r.skill);
}

// The composed need text the JD build (and its persisted build_input) receives:
// the brief's content, flattened in the order the design chain reads best —
// narrative, outcomes, graded requirements, then the situational facets. This
// is what makes a promoted intake a RICHER need than the old free-text
// textarea, while staying replayable through the existing pipeline.
export function needTextFromBrief(brief: RoleBrief): string {
  const lines: string[] = [];
  if (brief.summary) lines.push(brief.summary);
  for (const s of brief.successCriteria ?? []) lines.push(`Done in 90 days: ${s}`);
  for (const r of brief.responsibilities ?? []) lines.push(r);
  for (const skill of briefMustSkills(brief)) lines.push(`Must have: ${skill}`);
  for (const skill of briefNiceSkills(brief)) lines.push(`Nice to have: ${skill}`);
  for (const f of brief.facets ?? []) {
    if (f.value) lines.push(`${f.label || f.key || "Context"}: ${f.value}`);
  }
  return lines.join("\n").trim();
}

// Whether a brief carries enough to build a role from — mirrors the JD
// builder's min-need contract in spirit: a title plus at least one graded
// dealbreaker or a 90-day outcome.
export function briefReadyToPromote(brief: RoleBrief | null): brief is RoleBrief {
  if (!brief) return false;
  const hasTitle = Boolean(brief.title?.trim());
  const hasSubstance = briefMustSkills(brief).length > 0 || (brief.successCriteria ?? []).length > 0;
  return hasTitle && hasSubstance;
}
