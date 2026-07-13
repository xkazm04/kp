// Bounded synchronous retry for transient SQLite lock errors.
// bug-ui-scan-2026-07-09 (candidate-onboarding-hand-off #5): a best-effort cross-surface
// side effect (e.g. mirroring a candidate-intake save into the recruiter timeline via
// recordAutomationEvent, which writes on a DIFFERENT connection than the intake) was
// swallowed with only a console.error, so a momentary write contention could silently
// drop the "candidate engaged" signal even though the write it mirrors succeeded.
//
// Our connections set busy_timeout=5000 (db-path.ts), so the driver already WAITS out an
// ordinary busy lock; this covers the residual immediate-throw lock cases (a busy that
// survives the wait, or a WAL snapshot conflict) so a single transient blip no longer
// loses the signal on the first try. It is NOT a durable outbox — a genuinely permanent
// failure still throws to the caller (which logs it as the last resort).

/** True for the retryable transient SQLite lock error codes (better-sqlite3 sets
 *  `.code` on the thrown SqliteError). A constraint / logic error is NOT transient —
 *  it fails identically every attempt and must surface immediately, never loop. */
export function isTransientSqliteError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || code === "SQLITE_BUSY_SNAPSHOT";
}

/** Run a synchronous side effect, retrying it while it fails with a TRANSIENT lock
 *  error, up to `attempts` total tries. A non-transient error is re-thrown immediately
 *  (no pointless looping); after the budget is exhausted the last error is re-thrown so
 *  the caller can log/handle it. `attempts` is kept small by default so a request path
 *  can't block for long (each try may already wait out busy_timeout). */
export function retryTransientSync(fn: () => void, attempts = 2): void {
  for (let i = 0; ; i++) {
    try {
      fn();
      return;
    } catch (err) {
      if (i >= attempts - 1 || !isTransientSqliteError(err)) throw err;
    }
  }
}
