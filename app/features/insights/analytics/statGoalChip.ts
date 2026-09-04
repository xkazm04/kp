// The goal pill's verdict, as a pure function.
//
// WHY IT IS A MODULE (82c2b8e8). The pill's copy is only „goal 30 d" — no verdict
// word — so THE COLOUR IS THE VERDICT: coral = missed, moss = met, grey = not
// measured. The rule was written inline in the cluster's JSX as
// `data.avgTimeToHireDays != null && data.avgTimeToHireDays > goal`, which collapses
// "this window produced no hires at all" onto `false`, i.e. onto the MET colour: a
// green goal pill beside a "—" and „no hires yet". A goal is not met by a cohort
// that produced no measurement. Grey is the tab's own answer for an unjudged number
// (analytics.briefNoGoalNote: "Stages without a goal stay grey: a reading, not a
// verdict"), so an unmeasured figure wears it too.
//
// Free of React and next-intl, like calibrationVerdict.ts: the rule is executed by a
// test rather than asserted by reading a .tsx.

/** The pill the Stat tile renders: an already-localized label plus the verdict.
 *  `missed: null` is NOT MEASURED and is not the same as "met". */
export type GoalChip = { text: string; missed: boolean | null };

/**
 * The time-to-hire goal pill.
 *
 * @param average  the window's average time to hire, null when no hire in the window
 *                 carried both timestamps.
 * @param goalDays the recruiter-set goal, null when no goal exists (no pill at all).
 * @param text     the localized pill label, e.g. "goal 30 d".
 */
export function timeToHireGoalChip(
  average: number | null,
  goalDays: number | null,
  text: string
): GoalChip | undefined {
  if (goalDays == null) return undefined;
  // Strictly greater: a window that lands exactly ON the goal met it.
  return { text, missed: average == null ? null : average > goalDays };
}
