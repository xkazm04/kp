// shortlist-to-group-eval — the compact URL grammar for pre-arming the Decisions
// group-eval selection from another surface (today: the Match tab's shortlist
// handoff): `?tab=decisions&job=<jobId>&arm=<entryId,entryId,…>`.
//
// The param carries an EXPLICIT candidate selection for round-9's selection mode
// (RoleDecisionRow picking state). It is deliberately weak-trust: ids are shape-
// validated here, membership-checked against the role's live pending cohort at
// seed time (ids that left the cohort are dropped from `picked` and named in
// `dropped` so the handoff can toast), and the server re-validates membership +
// cap again before any evaluation runs. The URL can therefore never do more than
// pre-tick checkboxes — the recruiter always clicks "Compare N" themselves (a
// group eval is a paid LLM run; never auto-fired).
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

/** Result of seeding a deep-linked arm: `picked` is what the row should tick,
 *  `dropped` is the requested ids that are no longer in the live cohort. */
export type ArmSelectionReport = { picked: string[]; dropped: string[] };

/**
 * The ids to actually pre-pick for one role, plus the ones the live cohort no
 * longer contains. Deep-linked ids may have been decided, moved, or belong
 * elsewhere — they leave `picked` and appear in `dropped` so Decisions can
 * explain the gap instead of looking like a broken link. Capped client-side at
 * GROUP_EVAL_CAP. `picked` is empty when fewer than a comparable pair survive:
 * arming a selection that cannot compare would be a dead affordance. Cap extras
 * that are still in the cohort are not dropped (they never left).
 */
export function seedArmSelectionReport(
  requested: readonly string[] | null | undefined,
  cohortIds: readonly string[]
): ArmSelectionReport {
  if (!requested || requested.length === 0) return { picked: [], dropped: [] };
  const cohort = new Set(cohortIds);
  const seen = new Set<string>();
  const dropped: string[] = [];
  const kept: string[] = [];
  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (cohort.has(id)) kept.push(id);
    else dropped.push(id);
  }
  const capped = kept.slice(0, GROUP_EVAL_CAP);
  return {
    picked: capped.length >= GROUP_EVAL_MIN_COHORT ? capped : [],
    dropped,
  };
}

/**
 * The ids to actually pre-pick for one role. Same filter as
 * {@link seedArmSelectionReport}; callers that only need the ticks use this.
 */
export function seedArmSelection(
  requested: readonly string[] | null | undefined,
  cohortIds: readonly string[]
): string[] {
  return seedArmSelectionReport(requested, cohortIds).picked;
}
