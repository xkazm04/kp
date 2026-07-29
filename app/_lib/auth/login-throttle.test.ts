import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// bug-ui-scan-2026-07-09 #4 — the persisted login throttle behind /api/auth/login.
// Pins the guarantee the route now relies on: N failures inside the window refuse
// the N+1 (per account AND per IP), the window RESETS so a mistyped-password user
// is never locked out for good, a success frees the bucket immediately, keys are
// independent, and the counter is DURABLE (a second connection — i.e. another
// process — sees it), which is the whole reason for SQLite over an in-memory Map.
//
// NON-VACUITY: before this fix the login route had no attempt accounting at all —
// every POST reached verifyCredentials/constant-time-compare and returned 401,
// never 429. That is behaviourally `isThrottled(...) === false` for every key.
// Under that pre-fix behaviour the "6th attempt must be throttled" assertion below
// (which expects `true`) FAILS, and the reset/clear/independence tests are moot.
// The tests are green only because the throttle store now exists and trips.
//
// Runner: node --test with type stripping via the test:unit alias loader.

// Point every isolated store at a throwaway DB BEFORE importing the store: db-path
// reads KP_DB_PATH at module load, and login-throttle opens its connection lazily.
// This MUST stay the first project import.
//
// It used to be a hand-rolled `os.tmpdir()/kp-login-throttle-test-${process.pid}.sqlite`.
// `--test-isolation=process` gives each FILE a fresh process, but the OS RECYCLES pids: a
// later run drawing a pid this file had used before re-opened that run's leftover database
// and inherited its committed login_attempts rows (the after() unlink is best-effort and
// silently loses to the store's still-open handle on Windows), so the count-based assertions
// could start from a non-empty bucket. unit-db.ts is the repo-wide fix: a mkdtemp'd run
// directory (unique by construction, never pid-derived), a liveness-gated sweep of abandoned
// dirs, and cleanupUnitDb() to remove our own.
const { cleanupUnitDb, UNIT_DB_PATH: TMP } = await import("../testing/unit-db.ts");
after(cleanupUnitDb);

const { isThrottled, recordFailedAttempt, clearFailures } = await import("./login-throttle.ts");

const OPTS = { limit: 5, windowMs: 15 * 60_000 };
const T0 = 1_700_000_000_000; // fixed base "now" so tests are deterministic

// Fresh state per test — the store persists across tests in one process.
beforeEach(() => {
  for (const k of ["k:brute", "k:reset", "k:legit", "acct:a", "acct:b", "ip:x"]) clearFailures(k);
});

test("under the limit is admitted; the Nth failure inside the window trips the N+1", () => {
  const key = "k:brute";
  for (let i = 0; i < OPTS.limit; i++) {
    assert.equal(isThrottled(key, OPTS, T0 + i), false, `attempt ${i + 1} should be allowed`);
    recordFailedAttempt(key, OPTS, T0 + i);
  }
  // limit failures now recorded within the window → the next attempt is refused.
  assert.equal(isThrottled(key, OPTS, T0 + OPTS.limit), true, "the (limit+1)th attempt must be throttled");
});

test("the window RESETS after windowMs — a throttled key is admitted again", () => {
  const key = "k:reset";
  for (let i = 0; i <= OPTS.limit; i++) recordFailedAttempt(key, OPTS, T0 + i);
  assert.equal(isThrottled(key, OPTS, T0 + 100), true, "still inside the window → throttled");
  assert.equal(isThrottled(key, OPTS, T0 + OPTS.windowMs + 1), false, "a fresh window must admit again (no permanent lockout)");
  // And a failure after the window opens a fresh count of 1, not limit+1.
  assert.equal(recordFailedAttempt(key, OPTS, T0 + OPTS.windowMs + 2), 1, "post-window failure starts a new window at 1");
});

test("a correct password (clearFailures) frees the bucket within the window", () => {
  const key = "k:legit";
  for (let i = 0; i < OPTS.limit; i++) recordFailedAttempt(key, OPTS, T0 + i);
  assert.equal(isThrottled(key, OPTS, T0 + OPTS.limit), true);
  clearFailures(key); // the next attempt used the right password
  assert.equal(isThrottled(key, OPTS, T0 + OPTS.limit + 1), false, "a cleared bucket is immediately usable again");
});

test("keys are independent — one hot account can't throttle another", () => {
  for (let i = 0; i <= OPTS.limit; i++) recordFailedAttempt("acct:a", OPTS, T0 + i);
  assert.equal(isThrottled("acct:a", OPTS, T0 + OPTS.limit), true);
  assert.equal(isThrottled("acct:b", OPTS, T0 + OPTS.limit), false, "a different account is unaffected");
});

test("the counter is DURABLE across connections (multi-process safety)", () => {
  const key = "ip:x";
  recordFailedAttempt(key, OPTS, T0);
  recordFailedAttempt(key, OPTS, T0 + 1);
  // A separate connection on the same file — as a second server process would open —
  // sees the persisted count. An in-memory Map would show nothing here.
  const raw = new Database(TMP);
  const row = raw.prepare(`SELECT fail_count FROM login_attempts WHERE bucket_key = ?`).get(key) as
    | { fail_count: number }
    | undefined;
  raw.close();
  assert.equal(row?.fail_count, 2, "the failure count is persisted, not per-process");
});
