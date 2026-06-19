// Next.js instrumentation — runs once per server process at startup. This is the
// app's clock: a heartbeat that drives the durable automation scheduler so the
// Task-7 policy pass happens on a cadence instead of only on a manual click.
//
// Safe by default: the schedule is DISABLED unless enabled via the Pipeline UI
// toggle or AUTOMATION_SCHEDULER_AUTOSTART=1, so the heartbeat ticks but does
// nothing until you opt in. An external cron hitting /api/automation/run remains
// an alternative for deployments that don't keep a long-lived Node process.

export async function register(): Promise<void> {
  // Only run in the Node.js server runtime (not edge / not the browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { __kpClockStarted?: boolean };
  if (g.__kpClockStarted) return; // guard against duplicate intervals across HMR
  g.__kpClockStarted = true;

  // Eager recovery: the in-process task queue is volatile, but the `tasks` rows
  // are the source of truth, so promptly mark any 'running' row a previous process
  // left mid-flight as 'interrupted'. Never-started 'queued' rows are intentionally
  // left for the task runner (ensureRecovered) to re-enqueue on first read rather
  // than abandoned — that path owns the in-process queue and resumes the work.
  try {
    const { interruptStaleTasks } = await import("./app/_lib/db");
    interruptStaleTasks();
  } catch (e) {
    console.error("[clock] task recovery failed:", e);
  }

  const HEARTBEAT_MS = 60_000;
  const tick = async () => {
    try {
      const { tickScheduler } = await import("./app/_lib/scheduler");
      const r = await tickScheduler();
      if (r.ran && !r.error) console.log("[clock] policy pass ran:", JSON.stringify(r.summary));
      else if (r.error) console.error("[clock] policy pass error:", r.error);
    } catch (e) {
      console.error("[clock] tick failed:", e);
    }
    // Interview reminders — independent of the policy schedule (time-sensitive,
    // no auto-advance opt-in required) but, since AUTO6, a REGISTERED scheduler
    // job: claimDueRun gates the sweep (its row defaults ON at the historical
    // every-minute cadence, and pausing it from the UI actually pauses sends),
    // last_run_at proves the sweep is alive, and sends/failures land in
    // scheduler_runs instead of living only in server logs. Zero-send sweeps
    // record no run row — at a 1-minute cadence that would be pure noise.
    try {
      const { ensureReminderJob, claimDueRun, recordRun, REMINDERS_JOB } = await import("./app/_lib/scheduler-store");
      ensureReminderJob();
      if (claimDueRun(REMINDERS_JOB)) {
        const startedAt = new Date().toISOString();
        try {
          const { sendDueInterviewReminders } = await import("./app/_lib/interview-reminders");
          const n = await sendDueInterviewReminders();
          if (n) {
            recordRun({ job: REMINDERS_JOB, status: "ok", summary: { sent: n }, startedAt });
            console.log("[clock] interview reminders sent:", n);
          }
        } catch (e) {
          recordRun({
            job: REMINDERS_JOB,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            startedAt,
          });
          console.error("[clock] reminder sweep failed:", e);
        }
      }
    } catch (e) {
      console.error("[clock] reminder job bookkeeping failed:", e);
    }
    // Lapse expired offers (idea-29361408) — independent, best-effort, idempotent.
    // The candidate read/respond paths also lazily lapse on access; this sweep is
    // what flips an un-opened offer to 'expired' on the recruiter board on time.
    try {
      const { lapseExpiredOffers } = await import("./app/_lib/offers-store");
      const lapsed = lapseExpiredOffers();
      if (lapsed) console.log("[clock] offers lapsed (expired):", lapsed);
    } catch (e) {
      console.error("[clock] offer lapse sweep failed:", e);
    }
    // Proactive offer-expiry reminders (idea-29361408 follow-up) — the heads-up sent at
    // T-48h before the lapse above, so a candidate who forgot doesn't lose a live offer
    // to silence. Independent, best-effort, at-most-once (the sweep CAS-claims
    // reminded_at before dispatch, so a re-tick can't double-send a candidate-facing nudge).
    try {
      const { sendDueOfferReminders } = await import("./app/_lib/offer-reminders");
      const reminded = await sendDueOfferReminders();
      if (reminded) console.log("[clock] offer reminders sent:", reminded);
    } catch (e) {
      console.error("[clock] offer reminder sweep failed:", e);
    }
    // GDPR consent-expiry sweep (consent.ts) — independent, best-effort, idempotent.
    // Anonymizes candidates whose data-processing consent has lapsed (PII scrubbed,
    // scores/notes/stage retained for re-engagement). The candidate erasure path
    // also anonymizes on demand; this sweep is what honors a silent expiry on time.
    try {
      const { anonymizeExpiredConsents } = await import("./app/_lib/db");
      const anonymized = anonymizeExpiredConsents();
      if (anonymized) console.log("[clock] consents expired → anonymized:", anonymized);
    } catch (e) {
      console.error("[clock] consent anonymization sweep failed:", e);
    }
  };

  // Self-rescheduling chain instead of setInterval: arm the NEXT tick only AFTER the
  // current one fully settles, so a slow run (slow LLM calls, or SQLite contention
  // where busy_timeout makes a writer wait up to 5s) can never overlap the next and
  // re-enter the scheduler + reminder sweep concurrently — two overlapping sweeps
  // could both read the same due reminders and double-send candidate-facing messages.
  const armNext = (delay: number) => {
    const handle = setTimeout(runTick, delay);
    if (typeof (handle as { unref?: () => void }).unref === "function") {
      (handle as { unref: () => void }).unref(); // never keep the process alive for the clock alone
    }
  };
  const runTick = async () => {
    try {
      await tick();
    } finally {
      armNext(HEARTBEAT_MS); // only re-arm once this tick has resolved
    }
  };

  armNext(8_000); // let the server finish booting before the first tick
}
