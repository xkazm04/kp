import { runAutomationPass } from "./automation-pass";
import { advanceAfterForcedRun, claimDueRun, ensureSchedule, recordRun } from "./scheduler-store";

// The clock's per-tick work: atomically claim a due run, run the SHARED policy
// pass, and record it durably. Called by the heartbeat in instrumentation.ts and
// by the schedule API's manual "tick".
export async function tickScheduler(opts?: { force?: boolean; trigger?: string }): Promise<{
  ran: boolean;
  summary?: unknown;
  error?: string;
}> {
  ensureSchedule();
  // claimDueRun is the lock: exactly one caller wins per due window, and it
  // advances next_due_at so a restart / second process can't double-fire.
  if (!opts?.force && !claimDueRun()) return { ran: false };
  // A forced/manual tick skips claimDueRun (the only writer of next_due_at on the
  // run path). Advance the clock here — exactly as claimDueRun would on the clock
  // path — so the still-due window isn't immediately re-claimed by the next
  // heartbeat, which would double-fire the pass seconds later.
  if (opts?.force) advanceAfterForcedRun();

  const startedAt = new Date().toISOString();
  try {
    const { summary } = await runAutomationPass();
    recordRun({ status: "ok", summary, startedAt, trigger: opts?.trigger ?? "clock" });
    return { ran: true, summary };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    recordRun({ status: "error", error, startedAt, trigger: opts?.trigger ?? "clock" });
    return { ran: true, error };
  }
}
