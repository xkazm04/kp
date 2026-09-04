// What a simulation actually COSTS the recruiter's allowance (wave 18b).
//
// The start panel told the recruiter the demo's length and nothing else, while
// /api/interview/simulate reserves — and /api/interview/complete debits — up to
// `maxBillableInterviewMin(durationMin)`, i.e. TWICE the booked length, on
// `interview_minutes`: the one meter with real per-unit cost. So "a 5-minute
// demo" could take 10 minutes of a prepaid allowance the recruiter is never
// shown before clicking, and the 402 that follows lands on a real candidate
// screen later. The number the gate computes was already there; the panel just
// never said it.
//
// Why the ceiling is re-stated here rather than imported from the gate:
// `app/_lib/billing/enforce.ts` reaches better-sqlite3 through `getBillingState`,
// so a "use client" module cannot import it at all. `simBilling.test.ts` closes
// that gap the only way that stays honest — it imports BOTH and asserts they
// produce the same number for every sim mode, so the two can never drift apart
// silently. If that test fails, the panel is lying and the fix is here, not there.
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import { DEMO_CASE_SCENARIO, STUDENT_SCRIPT_MIN } from "@/app/_lib/student-interview";
import type { SimMode } from "./InterviewModeCards";

/** The booked length /api/interview/simulate mints for each mode. */
export function simDurationMin(mode: SimMode): number {
  if (mode === "student") return STUDENT_SCRIPT_MIN;
  if (mode === "student-case") return DEMO_CASE_SCENARIO.durationMin;
  return QUICK_SCREEN_MIN;
}

/** Mirror of `maxBillableInterviewMin` — the ceiling /complete clamps its debit
 *  to and /simulate reserves. Pinned against the real helper by simBilling.test.ts. */
export const BILLABLE_CEILING_FACTOR = 2;

/** The most this simulation can take off `interview_minutes`. */
export function simBillableCeilingMin(mode: SimMode): number {
  return simDurationMin(mode) * BILLABLE_CEILING_FACTOR;
}
