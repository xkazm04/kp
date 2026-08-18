// Automation ROI ledger (idea-b39992b1). The automation panel reports auto/human
// COUNTS but never VALUE — and buyers won't pay for automation they can't measure.
// This attaches a per-action "minutes a recruiter would have spent doing this by
// hand" estimate to each automated event kind, then aggregates into hours and CZK
// saved over the window. Grounded in the real event trail (the same kind counts
// the auto/human rollup folds), not a vanity number.
//
// Pure + import-free so the math is unit-testable and runs under bare node --test.
// The map intentionally lists ONLY automated kinds that REPLACE recruiter work —
// failure/sentinel kinds (rejection_comms_failed, fairness_gate_unknown_archetype,
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
  auto_rejected: 5, // reviewing + writing a considered pass. LIVE — produced by the screen-wave bulk reject (screen-wave.ts, actor "system"), NOT by the automation pass (which never rejects unattended; it queues a rejection_review).
  rejection_sent: 4, // composing + sending the rejection note
  interview_invite_sent: 4, // composing + sending the invite + link
  auto_advanced: 3, // the policy pass moving a candidate a stage on (the machine's OWN advance). The human `advanced` is a recruiter click — NOT saved automation labor — so it is deliberately absent (bug-ui-scan §hiring-automation #3).
  acknowledgement_sent: 2, // the application-received reply
  interview_reminder_sent: 2, // the nudge before a scheduled screen
  screening_hold: 2, // flagging a borderline for human review
};

// Blended recruiter hourly cost (CZK) used when the org hasn't set its own. A
// stated, override-able assumption — not a hidden constant — so the savings
// figure stays defensible.
export const DEFAULT_RECRUITER_HOURLY_CZK = 600;

// Manual recruiter labor ONE hire takes end-to-end, by hand — the baseline the
// saved hours are measured against, so the number reads as a REDUCTION a leader
// can size, not a bare figure (UAT M7). Research anchor: ~40–51 h total per hire
// (≈23 h of it screening, ~13 h sourcing); 42 is the defensible mid-point.
// Stated + override-able (pass `manualBaselineHoursPerHire`), never a hidden hex.
//
// UAT KAT-L1-005 — "override-able" was true of the signature and false of the
// product: no call site passed the parameter, so the org's own anchor could not
// reach it. db/analytics.ts now feeds it from the reserved MANUAL_HOURS_TARGET_KEY
// goal row, and this constant is the fallback for an org that has not set one.
export const MANUAL_HOURS_PER_HIRE = 42;

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
  // Baseline-relative framing (UAT M7) — null until there are hires to amortise
  // the saved labor over, so the per-hire figures are never a divide-by-zero lie.
  hires: number;
  hoursSavedPerHire: number | null; // 1 decimal
  czkSavedPerHire: number | null;
  manualBaselineHoursPerHire: number; // the stated manual anchor (echoed for the UI)
  // Share of the manual per-hire effort offset, as a percentage. UNBOUNDED ABOVE —
  // see the note at the computation: a figure over 100 is a real signal, not an
  // overflow to be tidied away.
  pctOfManualBaseline: number | null;
};

/** Aggregate the time/cost an automated event trail saved. `kindCounts` is the
 *  same GROUP-BY-kind map the auto/human rollup consumes; only kinds present in
 *  MINUTES_SAVED_PER_KIND with a positive count contribute. `hires` anchors the saved
 *  labor against the manual per-hire baseline so the figure reads as a measured
 *  reduction, not a bare counterfactual.
 *
 *  `hires` MUST be counted on the same basis as `kindCounts` — hires that CLOSED in the
 *  window, since kindCounts is events that HAPPENED in it. Feeding a creation-cohort
 *  count instead divides a full window of automated work by whatever fraction of its
 *  hires happened to also start inside the window (UAT KAT-ANA-4). */
export function automationRoi(
  kindCounts: Record<string, number>,
  hourlyRateCzk?: number | null,
  hires?: number | null,
  manualBaselineHoursPerHire: number = MANUAL_HOURS_PER_HIRE
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

  // Per-hire only when there's a hire to divide by; otherwise null (honest gap,
  // mirroring cost-per-hire) instead of inflating a tiny denominator.
  const hireCount = hires != null && hires > 0 ? hires : 0;
  const rawHoursPerHire = hireCount > 0 ? minutesSaved / 60 / hireCount : null;
  const hoursSavedPerHire = rawHoursPerHire != null ? Math.round(rawHoursPerHire * 10) / 10 : null;
  const czkSavedPerHire = rawHoursPerHire != null ? Math.round(rawHoursPerHire * rate) : null;
  // UAT KAT-L1-005 / KAT-ANA-4 — NOT capped. The old Math.min(100, …) was defended as
  // "you can't offset more than the full manual effort", which is true of the CONCEPT
  // and false of the ARITHMETIC: this ratio also exceeds 100 when the denominator is
  // wrong (a mixed-basis hire count) or when the org's baseline is set too low. The cap
  // rendered 437% as a clean, plausible 100% — it hid the one reading that proves the
  // number needs looking at. An implausible figure now shows itself; that is the signal.
  const pctOfManualBaseline =
    rawHoursPerHire != null && manualBaselineHoursPerHire > 0
      ? Math.round((rawHoursPerHire / manualBaselineHoursPerHire) * 100)
      : null;

  return {
    actions,
    totalActions,
    minutesSaved,
    hoursSaved,
    hourlyRateCzk: rate,
    czkSaved,
    hires: hireCount,
    hoursSavedPerHire,
    czkSavedPerHire,
    manualBaselineHoursPerHire,
    pctOfManualBaseline,
  };
}
