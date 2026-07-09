// OO-L2-15 / EB-L2-11 — is a scheduler_runs error row CURRENT, or history?
//
// The automation strip used to render the newest error row verbatim and
// undated. Zero-send sweeps deliberately record no run rows (only sends and
// errors do), so a 14-day-old migration error stayed "the newest row" forever
// and displayed beside "checked today" as if the job were failing right now —
// while scheduler.last_run_at proved it healthy.
//
// An error row is CURRENT only when BOTH hold:
//   1. it is recent (started within RUN_ERROR_TTL_MS), and
//   2. no later check superseded it — the job row's last_run_at is written at
//      claim time BEFORE the run's startedAt is captured (scheduler-store
//      claimDueRun → scheduler.ts tickScheduler), so for the error's own run
//      last_run_at <= startedAt; any lastRunAt STRICTLY AFTER startedAt is a
//      newer check that ran without recording an error → the job recovered.
//
// Pure + import-free so the Node unit runner loads it directly
// (scheduler-health.test.ts pins the window logic).

/** How long an unsuperseded error row may render as a live problem. */
export const RUN_ERROR_TTL_MS = 24 * 60 * 60 * 1000;

// ── Scheduler LIVENESS (bug-ui-scan-2026-07-09 #1) ─────────────────────────
// isCurrentRunError above answers "is the newest ERROR row current?" — it says
// nothing about whether the clock is still TICKING. A dead self-rescheduling
// chain (a broken re-arm, an unref'd loop that drained, a platform that reaped
// the worker, or an instrumentation hook that never fired) records no error at
// all: it simply stops. The ops/health surface then shows a green "Healthy" dot
// while interview reminders, offer-expiry lapses, and the GDPR consent sweep
// silently cease. Liveness is a SEPARATE signal: each clock tick stamps a
// last_tick_at heartbeat (scheduler_heartbeat, one row) and we judge its age.
//
// Pure + import-free like isCurrentRunError, so the node --test runner loads it
// directly and the DB read/write stay OUTSIDE this function (in the tick + the
// health/ops routes).

/** The clock's tick cadence. MIRRORS HEARTBEAT_MS in instrumentation-node.ts,
 *  which imports THIS constant as the single source so the two never drift. */
export const SCHEDULER_TICK_MS = 60_000;

/** The one liveness threshold — derived from the interval, never a second magic
 *  number. A heartbeat older than 3 ticks means the chain has stopped, not that
 *  we merely caught it mid-interval; 3× absorbs one slow tick (a slow LLM pass
 *  or a SQLite busy-wait) without crying wolf. */
export const SCHEDULER_STALE_MS = 3 * SCHEDULER_TICK_MS;

/** Fresh-boot grace: the first tick is armed a few seconds after boot, so before
 *  it lands "no heartbeat yet" is a STARTING clock, not a dead one. Past this
 *  window a missing heartbeat is a clock that never ticked = stalled. Its own
 *  named window (2 ticks), comfortably past the ~8s first-tick delay. */
export const SCHEDULER_BOOT_GRACE_MS = 2 * SCHEDULER_TICK_MS;

export type SchedulerLiveness = "healthy" | "starting" | "stalled";

/**
 * Pure liveness verdict from timestamps only — no DB, no imports.
 *
 *  - `nowMs`      wall clock (Date.now()).
 *  - `lastBeatMs` parsed last_tick_at, or null when the heartbeat row is ABSENT
 *                 (a fresh boot OR a clock that never ran).
 *  - `uptimeMs`   how long THIS process has been up (process.uptime()*1000) —
 *                 the only reference that tells a benign fresh boot apart from a
 *                 dead clock when no heartbeat exists yet.
 *
 * NEVER returns "healthy" on an absent heartbeat — that absence IS the wedged-
 * clock bug this guards against. Absence is "starting" only inside the boot
 * grace window; after it, absence is "stalled".
 */
export function schedulerLiveness(
  nowMs: number,
  lastBeatMs: number | null | undefined,
  uptimeMs: number
): SchedulerLiveness {
  if (lastBeatMs != null && Number.isFinite(lastBeatMs)) {
    return nowMs - lastBeatMs <= SCHEDULER_STALE_MS ? "healthy" : "stalled";
  }
  // No heartbeat recorded yet: benign only within the fresh-boot grace window.
  return uptimeMs < SCHEDULER_BOOT_GRACE_MS ? "starting" : "stalled";
}

/** The degradedReason a non-healthy liveness contributes to the ops/health
 *  payload — names WHICH thing is broken (not a bare "unhealthy"). Null when
 *  healthy. Pure. */
export function schedulerLivenessReason(
  liveness: SchedulerLiveness,
  lastTickAt: string | null | undefined
): string | null {
  if (liveness === "healthy") return null;
  if (liveness === "starting") return "scheduler starting — clock armed, awaiting first heartbeat";
  return lastTickAt
    ? `scheduler stalled — no clock heartbeat since ${lastTickAt}`
    : "scheduler stalled — the automation clock never recorded a heartbeat (it never started)";
}

export function isCurrentRunError(
  run: { status: string; startedAt: string } | null | undefined,
  opts: { lastRunAt?: string | null; now?: number } = {}
): boolean {
  if (!run || run.status !== "error") return false;
  const startedMs = Date.parse(run.startedAt);
  // An undated/garbled row can't be shown as "failing now" — it may be years old.
  if (Number.isNaN(startedMs)) return false;
  const now = opts.now ?? Date.now();
  if (now - startedMs > RUN_ERROR_TTL_MS) return false;
  const lastRunMs = opts.lastRunAt ? Date.parse(opts.lastRunAt) : NaN;
  // A check that started AFTER this error began — and recorded no newer error
  // row (this run is still the newest) — means the job has since run clean.
  if (!Number.isNaN(lastRunMs) && lastRunMs > startedMs) return false;
  return true;
}
