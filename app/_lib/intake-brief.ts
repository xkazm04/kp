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

// A compact, interviewer-internal digest of the hiring intent for grounding
// downstream conversations (Phase 3 — brief-as-reference). Deliberately short:
// it rides inside an already-long agent brief. Returns null when the brief
// carries nothing worth grounding on.
export function briefIntentSummary(brief: RoleBrief | null): string | null {
  if (!brief) return null;
  const musts = briefMustSkills(brief);
  const success = (brief.successCriteria ?? []).filter(Boolean);
  const urgency = (brief.facets ?? []).find((f) => f.key === "urgency")?.value;
  if (musts.length === 0 && success.length === 0) return null;
  const parts: string[] = [];
  if (success.length) parts.push(`success in the first 90 days means: ${success.slice(0, 3).join("; ")}`);
  if (musts.length) parts.push(`the stated dealbreakers are: ${musts.slice(0, 6).join(", ")}`);
  if (urgency) parts.push(`urgency: ${urgency.slice(0, 160)}`);
  return (
    "ROLE INTENT — internal context captured in the hiring-intake conversation with the requestor: " +
    parts.join("; ") +
    ". Weigh answers against this intent and probe the dealbreakers naturally; never read this note aloud."
  );
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
