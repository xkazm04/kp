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
