// The timebox rule on the TS side of the devcase — one function, over the SHARED
// bounds generated from pipeline/jobfit/devcase/models.py.
//
// Why this exists: the cap on a candidate's unpaid work (2h, UAT M8) was enforced in
// exactly one place — the Python designer's clamp on the LLM's own estimate — while
// the human approve gate accepted a reviewer-typed `timeboxHours` up to 80 and the
// Pydantic default sat at 4.0, DOUBLE the cap. Whatever number survives is rendered
// verbatim to the candidate (seed_materializer), so a typo at the review gate could
// hand someone a two-week "take-home". A rule enforced at one writer is not a rule.
//
// The bounds are imported, never re-typed: taxonomy.generated.ts is produced by
// `python -m pipeline.jobfit.codegen`, so the number can only be changed at its source.

import { DEVCASE_MAX_TIMEBOX_HOURS, DEVCASE_MIN_TIMEBOX_HOURS } from "@/app/_lib/taxonomy.generated";

export { DEVCASE_MAX_TIMEBOX_HOURS, DEVCASE_MIN_TIMEBOX_HOURS };

/** Bound a timebox to the policy window, mirroring models.clamp_timebox_hours.
 *  Returns null for anything that isn't a finite number (a non-numeric edit carries
 *  no intent — the caller keeps the designed value rather than inventing one). */
export function clampTimeboxHours(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, DEVCASE_MIN_TIMEBOX_HOURS), DEVCASE_MAX_TIMEBOX_HOURS);
}

/** The machine code for "the number the reviewer typed is not the number the
 *  candidate will receive". A code, never prose: the reviewer reads this in their
 *  own language (`devcase.review.timeboxClamped`) and the audit trail stores it in a
 *  parseable shape rather than an English sentence nobody can query. */
export const TIMEBOX_CLAMPED_CODE = "timebox_clamped";

export type TimeboxClamp = { code: typeof TIMEBOX_CLAMPED_CODE; from: number; to: number };

/** Describe a clamp, or null when the value survives untouched. The single producer
 *  for BOTH sides of the gate: the review panel renders it inline as the reviewer
 *  types, the approve route writes it to the audit trail — so the two can never
 *  disagree about what was clamped. */
export function timeboxClamp(raw: unknown): TimeboxClamp | null {
  const to = clampTimeboxHours(raw);
  if (to == null) return null;
  const from = typeof raw === "number" ? raw : Number(raw);
  if (to === from) return null;
  return { code: TIMEBOX_CLAMPED_CODE, from, to };
}

/** The number to SHOW for a case whose timebox is missing or out of policy.
 *  UI must never carry a timebox literal of its own: the design card's old `?? 4`
 *  was the exact stale Pydantic default this module was written to kill, and it
 *  rendered DOUBLE the enforced cap to the reviewer. Falls back to the cap, which
 *  is the largest thing any candidate can actually be handed. */
export function timeboxHoursForDisplay(raw: unknown): number {
  return clampTimeboxHours(raw) ?? DEVCASE_MAX_TIMEBOX_HOURS;
}
