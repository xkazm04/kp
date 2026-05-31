import { dispatchInterviewReminder } from "./comms-dispatch";
import { claimReminder, dueReminders, releaseReminder } from "./schedule-store";

// Time-based interview reminders. Run on the instrumentation heartbeat (every
// ~60s), independent of the policy scheduler's enabled/claim gate — reminders
// are time-sensitive and benign, so they should not require opting into
// auto-advance. Sends once per confirmed interview, ~24h before it starts.
export async function sendDueInterviewReminders(windowHours = 24): Promise<number> {
  const due = dueReminders(windowHours * 3_600_000);
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
