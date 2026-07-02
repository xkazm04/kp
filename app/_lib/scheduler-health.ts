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
