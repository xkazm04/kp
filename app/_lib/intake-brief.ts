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

// The graded projection the devcase chain consumes (DevNeed.statedRequirements
// ↔ pipeline/jobfit/devcase/models.py::StatedRequirement): the requestor's own
// must/nice + hardness split with weights, minus the intake-only fields
// (rationale/provenance/confidence stay on the brief).
export type StatedRequirement = { skill: string; kind: string; hardness: string; weight: number };

export function briefStatedRequirements(brief: RoleBrief): StatedRequirement[] {
  return (brief.requirements ?? [])
    .filter((r) => r.skill)
    .map((r) => ({ skill: r.skill, kind: r.kind, hardness: r.hardness, weight: r.weight }));
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
//
// Reads BOTH homes via the evidence helpers below (same UAT L2-NEW-2 shape the
// promote gate had to learn): live sessions file their hard conditions and
// 90-day outcomes as FACET prose with `requirements[]` / `successCriteria[]`
// empty, so a digest reading only the graded arrays returned null for exactly
// the briefs richest in stated intent — the interviewer then ran with no role
// grounding at all and never probed the dealbreakers. Facet values are prose
// (capped at 600 chars by the sanitizer), so each line is trimmed before it
// rides inside the already-long agent brief.
const INTENT_ITEM_MAX = 200;

export function briefIntentSummary(brief: RoleBrief | null): string | null {
  if (!brief) return null;
  const musts = briefDealbreakerEvidence(brief).map((s) => s.trim().slice(0, INTENT_ITEM_MAX));
  const success = briefOutcomeEvidence(brief).map((s) => s.trim().slice(0, INTENT_ITEM_MAX));
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

// UAT L2-NEW-2 (escalated minor → major, recurrence 2): the dialog captures a
// dealbreaker or a 90-day outcome in EITHER of two homes — the graded
// `requirements[]` / `successCriteria[]` arrays, or a facet whose key names the
// same thing (`dealbreaker_context`, `success_90d`). Live, the model took the
// facet every time: all five recertify sessions stored their hard conditions as
// facet prose with `requirements: []`, so a gate reading only the arrays refused
// briefs holding nine stated facets and the recertifier had to PATCH the brief
// over the API to promote at all. The routing half is fixed in the extraction
// contract (pipeline/jobfit/intake.py, prompt v2); this is the deterministic
// half — read the substance wherever the dialog actually put it. Keys only:
// facet labels are free localized prose and would match by accident.
const DEALBREAKER_FACET_KEY = /(dealbreaker|must[_-]?have|hard[_-]?condition|non[_-]?negotiable|requirement)/i;
const OUTCOME_FACET_KEY = /(success[_-]?90|first[_-]?90|90[_-]?day|outcome)/i;

function facetsMatching(brief: RoleBrief, re: RegExp): string[] {
  return (brief.facets ?? [])
    .filter((f) => f.value?.trim() && re.test(f.key ?? ""))
    .map((f) => f.value);
}

// Every dealbreaker the session holds, from both homes (graded rows first).
export function briefDealbreakerEvidence(brief: RoleBrief | null): string[] {
  if (!brief) return [];
  return [...briefMustSkills(brief).filter(Boolean), ...facetsMatching(brief, DEALBREAKER_FACET_KEY)];
}

// Every 90-day outcome the session holds, from both homes.
export function briefOutcomeEvidence(brief: RoleBrief | null): string[] {
  if (!brief) return [];
  return [...(brief.successCriteria ?? []).filter(Boolean), ...facetsMatching(brief, OUTCOME_FACET_KEY)];
}

// What stands between this brief and a JD build. Empty = promotable. Ordered as
// the requestor should fix them; the UI names them on the disabled button
// (UAT L2-RC-1 — a gate that refuses without saying why).
export type BriefPromoteBlocker = "title" | "substance";

export function briefPromoteBlockers(brief: RoleBrief | null): BriefPromoteBlocker[] {
  if (!brief) return ["title", "substance"];
  const blockers: BriefPromoteBlocker[] = [];
  if (!brief.title?.trim()) blockers.push("title");
  if (briefDealbreakerEvidence(brief).length === 0 && briefOutcomeEvidence(brief).length === 0) {
    blockers.push("substance");
  }
  return blockers;
}

// Whether a brief carries enough to build a role from — mirrors the JD
// builder's min-need contract in spirit: a title plus at least one dealbreaker
// or a 90-day outcome, in whichever home the dialog recorded it.
export function briefReadyToPromote(brief: RoleBrief | null): brief is RoleBrief {
  return brief !== null && briefPromoteBlockers(brief).length === 0;
}
