import { isPassInFlight, runAutomationPass } from "./automation-pass";
import { advanceAfterForcedRun, claimDueRun, ensureSchedule, getSchedule, recordRun } from "./scheduler-store";

// The clock's per-tick work: atomically claim a due run, run the SHARED policy
// pass, and record it durably. Called by the heartbeat in instrumentation.ts and
// by the schedule API's manual "tick".
export async function tickScheduler(opts?: { force?: boolean; trigger?: string }): Promise<{
  ran: boolean;
  summary?: unknown;
  error?: string;
  reason?: string;
}> {
  ensureSchedule();
  // bug-ui-scan-2026-07-09 (hiring-automation-scheduler #2): `force` was meant to
  // bypass only the DUE-gate, not the ENABLED gate. On the clock path claimDueRun
  // already refuses a disabled job — but a forced/manual "Run now" tick skipped
  // that check and ran a full APPLYING pass even with automation toggled OFF as a
  // kill-switch (advanceAfterForcedRun no-ops when disabled, but runAutomationPass
  // did not). "Off" must mean off: refuse a forced pass on a disabled schedule.
  if (opts?.force && !getSchedule().enabled) return { ran: false, reason: "disabled" };
  // claimDueRun is the lock: exactly one caller wins per due window, and it
  // advances next_due_at so a restart / second process can't double-fire.
  if (!opts?.force && !claimDueRun()) return { ran: false };

  // Whether THIS tick will START the pass vs JOIN an in-flight one — captured
  // synchronously before the call (no await between, so it's accurate). Single-flight
  // dedupes the WORK but not the bookkeeping: a forced tick (or a clock tick) that joins
  // an already-running pass must NOT advance the clock again or write a second
  // scheduler_runs row for the one executed pass.
  const startsPass = !isPassInFlight();
  // A forced/manual tick skips claimDueRun (the only writer of next_due_at on the
  // run path). Advance the clock here — exactly as claimDueRun would on the clock
  // path — so the still-due window isn't immediately re-claimed by the next
  // heartbeat. Only when this tick actually starts the pass (a joined tick's pass
  // was already advanced+logged by whoever started it).
  if (opts?.force && startsPass) advanceAfterForcedRun();

  const startedAt = new Date().toISOString();
  try {
    const { summary, decisions } = await runAutomationPass();
    if (startsPass) recordRun({ status: "ok", summary, decisions, startedAt, trigger: opts?.trigger ?? "clock" });
    return { ran: true, summary };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (startsPass) recordRun({ status: "error", error, startedAt, trigger: opts?.trigger ?? "clock" });
    return { ran: true, error };
  }
}
