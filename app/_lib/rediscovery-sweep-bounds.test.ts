// Bounded rediscovery sweep (bug-ui-scan #2). sweepRediscoveryAlerts used to fan
// out one recruiter_cli subprocess per published role — sequentially, with no
// concurrency cap, no per-role timeout, and no ceiling — so a busy catalog turned
// one Refresh click into an unbounded, minutes-long subprocess storm. These pin
// the three bounds: a worker-pool concurrency cap, a roles-per-sweep ceiling (that
// LOGS when it truncates), and a per-role wall-clock timeout that aborts a hung
// ranking. All bounds are asserted through INJECTED stubs — no real subprocess.
//
// rediscover.ts pulls in the db barrel at import, so testing/unit-db.ts must be
// the FIRST project import (it sets KP_DB_PATH before db-path evaluates).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  raiseForJobBounded,
  runWithPool,
  SWEEP_CONCURRENCY,
  SWEEP_MAX_ROLES,
  sweepRediscoveryAlerts,
  type SweepDeps,
} from "./rediscover.ts";

after(() => cleanupUnitDb());

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

test("runWithPool never exceeds the concurrency cap and still processes every item", async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  let active = 0;
  let maxActive = 0;
  const done: number[] = [];
  await runWithPool(items, 4, async (n) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await tick();
    done.push(n);
    active -= 1;
  });
  assert.ok(maxActive <= 4, `peak concurrency ${maxActive} must not exceed the cap of 4`);
  assert.equal(maxActive, 4, "with 20 items and cap 4 the pool should saturate to exactly 4");
  assert.equal(done.length, 20, "every item is processed");
});

test("sweepRediscoveryAlerts caps roles per sweep, logs the truncation, and honors the worker-pool cap", async () => {
  const PUBLISHED = SWEEP_MAX_ROLES + 15; // well over the ceiling
  const roles = Array.from({ length: PUBLISHED }, (_, i) => `job-${i}`);
  let active = 0;
  let maxActive = 0;
  const seen: string[] = [];
  const deps: SweepDeps = {
    listPublishedJobIds: () => roles,
    raiseForJob: async (jobId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(jobId);
      await tick();
      active -= 1;
      return 1; // each role surfaces one alert
    },
  };

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => warnings.push(a.join(" "));
  let out: Awaited<ReturnType<typeof sweepRediscoveryAlerts>>;
  try {
    out = await sweepRediscoveryAlerts({}, deps);
  } finally {
    console.warn = origWarn;
  }

  // CEILING: only SWEEP_MAX_ROLES roles are actually processed — NOT all PUBLISHED.
  assert.equal(seen.length, SWEEP_MAX_ROLES, "the sweep must stop at the ceiling, not process every published role");
  assert.equal(out.jobsSwept, SWEEP_MAX_ROLES);
  assert.equal(out.newAlerts, SWEEP_MAX_ROLES);
  assert.equal(out.truncated, 15, "the deferred count is reported, never silently dropped");
  // TRUNCATION is logged, not silent.
  assert.ok(
    warnings.some((w) => /truncated/i.test(w) && /15/.test(w)),
    "a truncated sweep must warn with the deferred count"
  );
  // CONCURRENCY: bounded by the worker pool (and actually concurrent, not sequential).
  assert.ok(maxActive <= SWEEP_CONCURRENCY, `peak concurrency ${maxActive} exceeded cap ${SWEEP_CONCURRENCY}`);
  assert.equal(maxActive, SWEEP_CONCURRENCY, "the pool should saturate to the concurrency cap");
});

test("raiseForJobBounded aborts a role whose ranking outruns the per-role timeout", async () => {
  let sawAbort = false;
  // A ranking that never resolves on its own — only the timeout can end it.
  const hangingRaise = (_jobId: string, o: { signal?: AbortSignal }) =>
    new Promise<number>((resolve) => {
      o.signal?.addEventListener("abort", () => {
        sawAbort = true;
        resolve(0); // mirrors raiseRediscoveryAlertsForJob swallowing the abort → 0
      });
    });

  const started = Date.now();
  const n = await raiseForJobBounded("job-hang", undefined, { timeoutMs: 30, raise: hangingRaise });
  const elapsed = Date.now() - started;

  assert.equal(sawAbort, true, "the per-role timeout must abort the ranking's signal");
  assert.equal(n, 0, "an aborted role contributes zero alerts");
  assert.ok(elapsed >= 25, `should wait for the ~30ms timeout, waited ${elapsed}ms`);
  assert.ok(elapsed < 2000, "must not hang past the timeout");
});

test("raiseForJobBounded passes a fast ranking's result through untouched (no over-aborting)", async () => {
  let sawAbort = false;
  const fastRaise = (_jobId: string, o: { signal?: AbortSignal }) => {
    o.signal?.addEventListener("abort", () => { sawAbort = true; });
    return Promise.resolve(3);
  };
  const n = await raiseForJobBounded("job-fast", undefined, { timeoutMs: 1000, raise: fastRaise });
  assert.equal(n, 3, "the real alert count flows through");
  await tick();
  assert.equal(sawAbort, false, "a job that finished in time is never aborted");
});
