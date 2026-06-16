// Automation ROI ledger (idea-b39992b1). The automation panel reports auto/human
// COUNTS but never VALUE — and buyers won't pay for automation they can't measure.
// This attaches a per-action "minutes a recruiter would have spent doing this by
// hand" estimate to each automated event kind, then aggregates into hours and CZK
// saved over the window. Grounded in the real event trail (the same kind counts
// the auto/human rollup folds), not a vanity number.
//
// Pure + import-free so the math is unit-testable and runs under bare node --test.
// The map intentionally lists ONLY automated kinds that REPLACE recruiter work —
// failure/sentinel kinds (onboarding_failed, fairness_gate_unknown_archetype,
// intake_degraded, observed_minted…) are excluded: they aren't saved labor.

// Conservative manual-time estimates, in minutes per automated action.
export const MINUTES_SAVED_PER_KIND: Record<string, number> = {
  interview_prep_generated: 25, // assembling a tailored prep pack by hand
  interview_scorecard: 20, // writing up a structured scorecard
  offer_drafted: 15, // drafting an offer from the template + terms
  scored: 8, // reading a CV and scoring it against the role
  outreach_sent: 6, // composing + sending a first-touch message
  matched: 5, // shortlisting a candidate against a role
  rematched: 5, // re-shortlisting onto a new role
  auto_rejected: 5, // reviewing + writing a considered pass
  rejection_sent: 4, // composing + sending the rejection note
  interview_invite_sent: 4, // composing + sending the invite + link
  advanced: 3, // reviewing + moving a candidate a stage on
  acknowledgement_sent: 2, // the application-received reply
  interview_reminder_sent: 2, // the nudge before a scheduled screen
  screening_hold: 2, // flagging a borderline for human review
};

// Blended recruiter hourly cost (CZK) used when the org hasn't set its own. A
// stated, override-able assumption — not a hidden constant — so the savings
// figure stays defensible.
export const DEFAULT_RECRUITER_HOURLY_CZK = 600;

export type RoiAction = {
  kind: string;
  count: number;
  minutesEach: number;
  minutesTotal: number;
};

export type AutomationRoi = {
  actions: RoiAction[]; // per-kind breakdown, highest time-saved first
  totalActions: number;
  minutesSaved: number;
  hoursSaved: number; // 1 decimal
  hourlyRateCzk: number;
  czkSaved: number;
};

/** Aggregate the time/cost an automated event trail saved. `kindCounts` is the
 *  same GROUP-BY-kind map the auto/human rollup consumes; only kinds present in
 *  MINUTES_SAVED_PER_KIND with a positive count contribute. */
export function automationRoi(
  kindCounts: Record<string, number>,
  hourlyRateCzk?: number | null
): AutomationRoi {
  const rate = hourlyRateCzk != null && hourlyRateCzk > 0 ? hourlyRateCzk : DEFAULT_RECRUITER_HOURLY_CZK;
  const actions: RoiAction[] = [];
  let minutesSaved = 0;
  let totalActions = 0;
  for (const [kind, minutesEach] of Object.entries(MINUTES_SAVED_PER_KIND)) {
    const count = kindCounts[kind] ?? 0;
    if (count <= 0) continue;
    const minutesTotal = count * minutesEach;
    actions.push({ kind, count, minutesEach, minutesTotal });
    minutesSaved += minutesTotal;
    totalActions += count;
  }
  actions.sort((a, b) => b.minutesTotal - a.minutesTotal);
  const hoursSaved = Math.round((minutesSaved / 60) * 10) / 10;
  const czkSaved = Math.round((minutesSaved / 60) * rate);
  return { actions, totalActions, minutesSaved, hoursSaved, hourlyRateCzk: rate, czkSaved };
}
