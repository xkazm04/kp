// shortlist-to-group-eval — the compact URL grammar for pre-arming the Decisions
// group-eval selection from another surface (today: the Match tab's shortlist
// handoff): `?tab=decisions&job=<jobId>&arm=<entryId,entryId,…>`.
//
// The param carries an EXPLICIT candidate selection for round-9's selection mode
// (RoleDecisionRow picking state). It is deliberately weak-trust: ids are shape-
// validated here, membership-checked against the role's live pending cohort at
// seed time (ids that left the cohort are silently dropped), and the server
// re-validates membership + cap again before any evaluation runs. The URL can
// therefore never do more than pre-tick checkboxes — the recruiter always clicks
// "Compare N" themselves (a group eval is a paid LLM run; never auto-fired).
//
// Pure + dependency-free (mirrors group-eval-cohort.ts) so both ends of the deep
// link — the Match CTA that builds it and DecisionsTab that consumes it — share
// one grammar, unit-testable without React.

import { GROUP_EVAL_CAP, GROUP_EVAL_MIN_COHORT } from "@/app/_lib/group-eval-cohort";

/** The tab-scoped query param carrying the selection (see tabs.ts allowlist). */
export const ARM_PARAM = "arm";

// Pipeline entry ids are minted as `m-…` slugs already stripped to this alphabet
// (createPipelineEntry), bounded at 90 chars. Anything else in the param is junk.
const ENTRY_ID_RE = /^[A-Za-z0-9_-]{1,90}$/;

/** Serialize a selection into the `arm` value: dedup, shape-validate, cap. */
export function buildArmParam(entryIds: readonly string[]): string {
  return [...new Set(entryIds.filter((id) => ENTRY_ID_RE.test(id)))].slice(0, GROUP_EVAL_CAP).join(",");
}

/**
 * Parse an incoming `arm` value. Returns the validated ids, or null when the
 * param is absent/malformed or carries fewer than a comparable pair — a
 * selection that can't compare anything must not arm the picking mode at all.
 */
export function parseArmParam(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter((id) => ENTRY_ID_RE.test(id)))].slice(
    0,
    GROUP_EVAL_CAP
  );
  return ids.length >= GROUP_EVAL_MIN_COHORT ? ids : null;
}

/**
 * The ids to actually pre-pick for one role: the requested selection filtered to
 * the role's CURRENT pending cohort (deep-linked ids may have been decided,
 * moved, or belong elsewhere — dropped silently; the server re-validates anyway)
 * and capped client-side at GROUP_EVAL_CAP. Empty when fewer than a comparable
 * pair survive: arming a selection that cannot compare would be a dead affordance.
 */
export function seedArmSelection(
  requested: readonly string[] | null | undefined,
  cohortIds: readonly string[]
): string[] {
  if (!requested || requested.length === 0) return [];
  const cohort = new Set(cohortIds);
  const picked = [...new Set(requested)].filter((id) => cohort.has(id)).slice(0, GROUP_EVAL_CAP);
  return picked.length >= GROUP_EVAL_MIN_COHORT ? picked : [];
}
