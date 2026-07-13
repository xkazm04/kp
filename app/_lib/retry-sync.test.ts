// bug-ui-scan-2026-07-09 (candidate-onboarding-hand-off #5): the bounded transient-lock
// retry that stops a best-effort cross-connection side effect (the candidate-intake
// timeline mirror) from being silently dropped on a single momentary SQLite lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransientSqliteError, retryTransientSync } from "./retry-sync.ts";

function sqliteErr(code: string): Error & { code: string } {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

test("isTransientSqliteError flags only the retryable lock codes", () => {
  assert.equal(isTransientSqliteError(sqliteErr("SQLITE_BUSY")), true);
  assert.equal(isTransientSqliteError(sqliteErr("SQLITE_LOCKED")), true);
  assert.equal(isTransientSqliteError(sqliteErr("SQLITE_BUSY_SNAPSHOT")), true);
  // A constraint / logic error is permanent — never retry it.
  assert.equal(isTransientSqliteError(sqliteErr("SQLITE_CONSTRAINT_UNIQUE")), false);
  assert.equal(isTransientSqliteError(new Error("boom")), false);
  assert.equal(isTransientSqliteError(null), false);
  assert.equal(isTransientSqliteError(undefined), false);
});

test("retryTransientSync retries a transient lock and then succeeds", () => {
  let calls = 0;
  retryTransientSync(() => {
    calls++;
    if (calls < 2) throw sqliteErr("SQLITE_BUSY");
  }, 3);
  assert.equal(calls, 2, "failed once, succeeded on the retry");
});

test("retryTransientSync does NOT retry a permanent error — it throws on the first try", () => {
  let calls = 0;
  assert.throws(
    () =>
      retryTransientSync(() => {
        calls++;
        throw sqliteErr("SQLITE_CONSTRAINT_UNIQUE");
      }, 3),
    /SQLITE_CONSTRAINT_UNIQUE/
  );
  assert.equal(calls, 1, "a permanent error never loops");
});

test("retryTransientSync re-throws the last error after exhausting the attempt budget", () => {
  let calls = 0;
  assert.throws(
    () =>
      retryTransientSync(() => {
        calls++;
        throw sqliteErr("SQLITE_BUSY");
      }, 2),
    /SQLITE_BUSY/
  );
  assert.equal(calls, 2, "tries exactly `attempts` times before giving up");
});

test("retryTransientSync runs the effect exactly once on success", () => {
  let calls = 0;
  retryTransientSync(() => {
    calls++;
  }, 3);
  assert.equal(calls, 1);
});
