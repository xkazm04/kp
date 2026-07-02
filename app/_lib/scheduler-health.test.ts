import { test } from "node:test";
import assert from "node:assert/strict";
import { isCurrentRunError, RUN_ERROR_TTL_MS } from "./scheduler-health.ts";

// OO-L2-15 — the automation strip must not render a historic scheduler_runs
// error row as a live failure. Window logic pinned here.

const NOW = Date.parse("2026-07-02T17:40:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

test("a fresh, unsuperseded error is current", () => {
  assert.equal(
    isCurrentRunError({ status: "error", startedAt: iso(-5 * 60_000) }, { lastRunAt: iso(-5 * 60_000), now: NOW }),
    true
  );
});

test("a 14-day-old error row is history, never a live banner", () => {
  assert.equal(
    isCurrentRunError(
      { status: "error", startedAt: "2026-06-18T09:00:00.000Z" },
      { lastRunAt: iso(-2 * 60_000), now: NOW }
    ),
    false
  );
});

test("the TTL boundary: just inside shows, just outside does not", () => {
  const run = (age: number) => ({ status: "error", startedAt: iso(-age) });
  assert.equal(isCurrentRunError(run(RUN_ERROR_TTL_MS - 1000), { now: NOW }), true);
  assert.equal(isCurrentRunError(run(RUN_ERROR_TTL_MS + 1000), { now: NOW }), false);
});

test("a later successful check supersedes a recent error (zero-send sweeps record no rows)", () => {
  // Error an hour ago; the job's last_run_at shows a check ran since without
  // recording a newer error row → the job recovered, the error is history.
  assert.equal(
    isCurrentRunError({ status: "error", startedAt: iso(-60 * 60_000) }, { lastRunAt: iso(-60_000), now: NOW }),
    false
  );
});

test("the error's own claim timestamp does not supersede it", () => {
  // claimDueRun writes last_run_at BEFORE the run's startedAt is captured, so
  // for the failing run itself lastRunAt <= startedAt — still current.
  assert.equal(
    isCurrentRunError({ status: "error", startedAt: iso(-60_000) }, { lastRunAt: iso(-61_000), now: NOW }),
    true
  );
});

test("non-error rows, missing rows, and unparseable timestamps are never current errors", () => {
  assert.equal(isCurrentRunError({ status: "ok", startedAt: iso(-1000) }, { now: NOW }), false);
  assert.equal(isCurrentRunError(null, { now: NOW }), false);
  assert.equal(isCurrentRunError(undefined, { now: NOW }), false);
  assert.equal(isCurrentRunError({ status: "error", startedAt: "not-a-date" }, { now: NOW }), false);
  // Garbled lastRunAt falls back to the TTL check alone.
  assert.equal(
    isCurrentRunError({ status: "error", startedAt: iso(-1000) }, { lastRunAt: "junk", now: NOW }),
    true
  );
});
