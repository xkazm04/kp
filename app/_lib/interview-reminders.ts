import { dispatchInterviewReminder } from "./comms-dispatch";
import { claimReminderAttempt, dueReminders, markReminderSent } from "./schedule-store";
import { REMINDER_LEAD_MS, REMINDER_MAX_ATTEMPTS, reminderRetryDelayMs } from "./interview-reminder-policy";

// Time-based interview reminders. Run on the instrumentation heartbeat (every
// ~60s), independent of the policy scheduler's enabled/claim gate — reminders
// are time-sensitive and benign, so they should not require opting into
// auto-advance. Sends once per confirmed interview when its start enters the
// REMINDER_LEAD_MS look-ahead window; short-notice bookings (covered by their
// confirmation note) are filtered out by dueReminders per interview-reminder-policy.ts.
//
// BOUNDED RETRY (idea-edab792a). The previous loop reset the claim to NULL on ANY
// dispatch error so the next ~60s tick retried immediately. Two failure modes:
//   (1) a down comms provider turned every tick into a re-claim/re-fail/re-release
//       storm across every due invite — unbounded, no backoff, hammering the
//       failing dependency until the slot passed; and
//   (2) a dispatch that delivered but then threw (e.g. a post-send audit write)
//       got re-armed and sent the candidate a DUPLICATE.
// The fix: each attempt is claimed atomically (claimReminderAttempt records the
// attempt + stamps the time), retries are capped at REMINDER_MAX_ATTEMPTS and
// spaced by a growing backoff, and we give up loudly once the cap is hit. A
// dispatch throw now means "delivery did not complete" (post-send bookkeeping is
// swallowed inside dispatchInterviewReminder), so a failed attempt is simply left
// to age past its backoff — never released for an immediate re-send.
export async function sendDueInterviewReminders(windowMs: number = REMINDER_LEAD_MS): Promise<number> {
  const due = dueReminders(windowMs);
  const nowMs = Date.now();
  let sent = 0;
  for (const inv of due) {
    const priorAttempts = inv.reminderAttempts;
    // Eligible only if the previous attempt has aged past its backoff. The claim
    // re-checks this atomically (cutoff = now − required backoff) and bumps the
    // counter, so an overlapping tick/process can't also attempt this generation.
    const cutoffIso = new Date(nowMs - reminderRetryDelayMs(priorAttempts)).toISOString();
    if (!claimReminderAttempt(inv.id, priorAttempts, cutoffIso, REMINDER_MAX_ATTEMPTS)) continue;
    const attemptNo = priorAttempts + 1;
    try {
      await dispatchInterviewReminder(
        { id: inv.entryId, candidateLabel: inv.candidateLabel, jobTitle: inv.jobTitle, locale: inv.locale },
        inv.slot ?? "your scheduled time",
        { durationMin: inv.durationMin }
      );
    } catch (err) {
      // Delivery did not complete. The claim already recorded this attempt and its
      // time, so the backoff gate holds the next retry off — we neither release
      // (which caused the storm) nor immediately re-arm. Once the cap is reached the
      // invite is excluded from dueReminders for good, so log loudly: an operator
      // may need to reach the candidate another way.
      const reason = err instanceof Error ? err.message : String(err);
      if (attemptNo >= REMINDER_MAX_ATTEMPTS) {
        console.error(
          `[reminder] giving up on invite ${inv.id} (entry ${inv.entryId ?? "—"}) after ${attemptNo} attempt(s): ${reason}`
        );
      } else {
        console.warn(
          `[reminder] attempt ${attemptNo}/${REMINDER_MAX_ATTEMPTS} for invite ${inv.id} failed, will retry after backoff: ${reason}`
        );
      }
      continue; // failed delivery — leave it to age past its backoff
    }
    // Delivered. Recording terminal success is bookkeeping: if the write itself
    // fails the candidate has STILL been reminded, so treat it as sent (log, don't
    // re-arm) — re-arming over a persist failure is exactly the duplicate-send the
    // bounded-retry model is meant to avoid.
    try {
      markReminderSent(inv.id); // terminal success — drops it out of the sweep
    } catch (e) {
      console.error(
        `[reminder] delivered invite ${inv.id} but failed to mark it sent: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    sent += 1;
  }
  return sent;
}
