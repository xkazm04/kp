// Measured counts of automated actions, for the Pipeline overview. REAL COUNTS ONLY: this module
// maps event kinds to a count and nothing else. No minutes, no hours, no money. (automation-roi.ts
// owns the estimate model and the Analytics tab; the Pipeline surface deliberately does not read it.)
//
// Pure + import-free so it runs under bare node --test and in the browser.

/** The event kinds that are the machine DOING a piece of work (a score run, a message sent, a
 *  candidate moved by the policy pass). Refusals, holds and sentinels (`screening_hold`,
 *  `outreach_halted`, `screen_wave_holdout`, ...) are deliberately absent: they are not work done,
 *  and a hold is a hand-off TO a human. A human move (`advanced`, `rejected`) is absent too. */
export const AUTOMATED_ACTION_KINDS = [
  "scored",
  "matched",
  "rematched",
  "outreach_sent",
  "interview_invite_sent",
  "interview_reminder_sent",
  "acknowledgement_sent",
  "rejection_sent",
  "auto_advanced",
  "auto_rejected",
  "interview_prep_generated",
  "interview_scorecard",
  "offer_drafted",
] as const;

export type AutomatedActionKind = (typeof AUTOMATED_ACTION_KINDS)[number];

export const AUTOMATION_COUNT_WINDOW_DAYS = 7;

export type AutomationCounts = {
  /** Every automated action in the window (the sum over AUTOMATED_ACTION_KINDS). */
  total: number;
  /** Candidates scored (the screen run). */
  screens: number;
  /** First-touch outreach messages sent. */
  outreach: number;
  /** Interview invitations sent. */
  invites: number;
};

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);

/** Fold a GROUP-BY-kind map (events that HAPPENED in the window) into the displayed counts. Unknown
 *  kinds, negatives and non-numbers contribute nothing. */
export function automationCounts(kindCounts: Record<string, number> | null | undefined): AutomationCounts {
  const k = kindCounts ?? {};
  let total = 0;
  for (const kind of AUTOMATED_ACTION_KINDS) total += n(k[kind]);
  return { total, screens: n(k.scored), outreach: n(k.outreach_sent), invites: n(k.interview_invite_sent) };
}

/** ISO cutoff for a rolling window ending at `nowMs`. */
export function windowCutoffIso(nowMs: number, days: number = AUTOMATION_COUNT_WINDOW_DAYS): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}
