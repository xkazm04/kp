import { dispatchInterviewReminder } from "./comms-dispatch";
import { claimReminder, dueReminders, releaseReminder } from "./schedule-store";
import { REMINDER_LEAD_MS } from "./interview-reminder-policy";

// Time-based interview reminders. Run on the instrumentation heartbeat (every
// ~60s), independent of the policy scheduler's enabled/claim gate — reminders
// are time-sensitive and benign, so they should not require opting into
// auto-advance. Sends once per confirmed interview when its start enters the
// REMINDER_LEAD_MS look-ahead window; short-notice bookings (covered by their
// confirmation note) are filtered out by dueReminders per interview-reminder-policy.ts.
export async function sendDueInterviewReminders(windowMs: number = REMINDER_LEAD_MS): Promise<number> {
  const due = dueReminders(windowMs);
  let sent = 0;
  for (const inv of due) {
    // Claim before dispatching: the atomic NULL→now flip means a second instance
    // or an overlapping tick can't also send this reminder. Only the winner runs.
    if (!claimReminder(inv.id)) continue;
    try {
      await dispatchInterviewReminder(
        { id: inv.entryId, candidateLabel: inv.candidateLabel, jobTitle: inv.jobTitle },
        inv.slot ?? "your scheduled time"
      );
      sent += 1;
    } catch {
      releaseReminder(inv.id); // delivery failed — let the next tick retry
    }
  }
  return sent;
}
