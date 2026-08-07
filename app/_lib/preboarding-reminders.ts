import { dispatchPreboardingReminder } from "./comms-dispatch";
import { getPipelineEntry } from "./db/pipeline";
import { duePreboardingReminders, markPreboardingReminded } from "./onboarding-store";
import { listOffersForEntry } from "./offers-store";
import { preboardingReminderCutoffIso } from "./preboarding-reminder-policy";
import { publicBaseUrl } from "./public-base-url";

// Pre-boarding intake reminders (candidate-onboarding-hand-off #3). Runs on the
// instrumentation heartbeat beside the offer/interview reminder sweeps: on accept the
// candidate is emailed their onboarding link once, but if they close the tab the
// questionnaire is never resent — so a hire's pre-boarding record stays empty exactly
// in the accept→day-one window where ghosting happens. This sends the single nudge.
//
// AT-MOST-ONCE by design, mirroring sendDueOfferReminders. The claim
// (markPreboardingReminded) CAS-stamps reminder_sent_at, but only AFTER the entry +
// the onboarding link are resolved, so a run we can't actually deliver to doesn't burn
// its one-shot claim. A dispatch failure after the claim is logged, not retried: a
// missed nudge is benign, a duplicate on a candidate-facing channel is not. The
// heartbeat never overlaps itself, so one claimed run is dispatched exactly once.
export async function sendDuePreboardingReminders(nowMs: number = Date.now()): Promise<number> {
  const due = duePreboardingReminders(preboardingReminderCutoffIso(nowMs));
  let sent = 0;
  for (const run of due) {
    if (!run.entryId) continue; // no entry → no deliverable recipient
    const entry = getPipelineEntry(run.entryId);
    if (!entry) continue; // entry vanished between the run row and now
    // The candidate's onboarding credential is their accepted offer's token (offers #5).
    const accepted = listOffersForEntry(run.entryId).find((o) => o.status === "accepted");
    if (!accepted) continue; // no accepted-offer token → can't link them to the questionnaire
    // Claim only once we know we can deliver, so a missing prerequisite above doesn't
    // consume the one-shot reminder.
    if (!markPreboardingReminded(run.id)) continue;
    const link = `${publicBaseUrl()}/onboarding/${accepted.token}`;
    try {
      await dispatchPreboardingReminder(entry, link);
      sent += 1;
    } catch (err) {
      // Claimed but not delivered. Logged, not re-armed: a missed nudge is benign; a
      // duplicate on this channel is not. The recruiter card still shows it pending.
      console.error(
        `[preboarding-reminder] claimed but dispatch failed for run ${run.id} (entry ${run.entryId}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return sent;
}
