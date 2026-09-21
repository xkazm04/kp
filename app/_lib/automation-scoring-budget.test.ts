// The scoring sweep's TOTAL, and why the concurrency ceiling could never be it.
//
// `spawnPython`'s admission semaphore (KP_PYTHON_MAX_CONCURRENT) is a STOCK cap:
// it counts interpreters alive right now and releases the slot on settle. The
// pre-policy scoring sweep in automation-pass runs SEQUENTIALLY — one paid
// interpreter per job group, awaited — so it never holds more than one slot and
// the ceiling can never fire on it however low it is set. What one pass may spend
// was therefore bounded by nothing, and the sweep's length is read out of the
// database at run time (distinct jobs with unscored entries, across every
// workspace), not enumerated in code.
//
// These tests pin the second number: a per-pass total, derived from the ceiling,
// whose overflow is DEFERRED to the next scheduled pass rather than dropped.
//
// RED-FIRST (measured 2026-09-17): with the `spawned >= budget` check removed from
// runScoringSweep, the first test fails — "the budget binds the pass's total" reads
// 12 spawns instead of 4, which is the arm-A number the second test asserts on
// purpose. The starvation test fails the same way if progress is not persisted.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScoringSweep, scoringSpawnBudget } from "./automation-pass.ts";

/** Twelve job groups, the shape `scoreUnscoredEntries` builds from the database. */
const twelveGroups = (): Map<string, string[]> =>
  new Map(Array.from({ length: 12 }, (_, i) => [`job-${i}`, [`entry-${i}`]] as const));

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const prev = Object.entries(vars).map(([k]) => [k, process.env[k]] as const);
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the budget binds the pass's TOTAL, which the concurrency ceiling cannot", async () => {
  const issued: string[] = [];
  const { spawned, deferred } = await runScoringSweep(twelveGroups(), 4, async (jobId) => {
    issued.push(jobId);
    return true;
  });

  assert.equal(spawned, 4, "four paid interpreters, not twelve");
  assert.equal(deferred, 8, "and the eight it did not reach are COUNTED, not silently skipped");
  assert.deepEqual(issued, ["job-0", "job-1", "job-2", "job-3"], "admission stops at the budget, in list order");
});

test("arm A: with no total, one sequential pass spends one interpreter per group", async () => {
  // The seam as it was. A budget the sweep cannot reach is the unbudgeted loop:
  // every group gets its spawn, nothing is deferred, and no cap anywhere fires.
  const { spawned, deferred } = await runScoringSweep(twelveGroups(), Number.POSITIVE_INFINITY, async () => true);
  assert.equal(spawned, 12, "twelve groups, twelve paid interpreters");
  assert.equal(deferred, 0);
});

test("the counter counts SPAWNS, not iterations", async () => {
  // POSITIVE CONTROL for the instrument: at a budget far above the work, the
  // observed number must be the work (12), not the budget (100) — otherwise the
  // test above would pass for a counter that simply reports its own limit.
  const generous = await runScoringSweep(twelveGroups(), 100, async () => true);
  assert.equal(generous.spawned, 12);
  assert.equal(generous.deferred, 0);

  // And a group that resolves no candidate issues no interpreter, so it must not
  // consume the allowance: 12 groups, every other one free, budget 4 -> the four
  // paid ones are admitted and the six free ones cost nothing.
  const paid: string[] = [];
  const mixed = await runScoringSweep(twelveGroups(), 4, async (jobId) => {
    const free = Number(jobId.slice("job-".length)) % 2 === 0;
    if (free) return false;
    paid.push(jobId);
    return true;
  });
  assert.equal(mixed.spawned, 4, "the budget is spent on spawns only");
  assert.deepEqual(paid, ["job-1", "job-3", "job-5", "job-7"]);
});

test("FLOOR: the deferred tail is scored by later passes, because progress is persisted", async () => {
  // The whole safety argument for a total cap over a re-derived work list: an
  // admitted group's score is written, so the filter that builds the next pass's
  // list no longer selects it. Three passes at budget 4 must cover all twelve,
  // each exactly once — no work lost, no work repeated.
  const scored = new Map<string, number>();
  let passes = 0;
  while (scored.size < 12) {
    passes += 1;
    assert.ok(passes <= 5, "a re-derived list must converge, not loop");
    // Re-derive the pass's work list the way the sweep does: only the unscored.
    const remaining = new Map(Array.from(twelveGroups()).filter(([jobId]) => !scored.has(jobId)));
    await runScoringSweep(remaining, 4, async (jobId) => {
      assert.equal(scored.has(jobId), false, "no group is scored twice");
      scored.set(jobId, passes);
      return true;
    });
  }
  assert.equal(passes, 3, "12 groups at 4 per pass is exactly three passes");
  assert.equal(scored.size, 12, "every group is scored");
  assert.deepEqual(
    [...new Set(scored.values())].sort(),
    [1, 2, 3],
    "each pass took its own four — the tail advanced instead of starving",
  );
});

test("the tail STARVES when the work list is re-derived unchanged", async () => {
  // POSITIVE CONTROL for the floor above: the same budget over a list that does
  // not shrink admits the same prefix forever. This is the condition the total cap
  // needs and the concurrency cap does not — a stock cap only ever delays the work
  // it refuses, so its overflow is queued; a total cap's overflow is deferred, and
  // deferral is only safe when the admitted work leaves the list.
  const seen = new Set<string>();
  for (let pass = 0; pass < 3; pass += 1) {
    await runScoringSweep(twelveGroups(), 4, async (jobId) => {
      seen.add(jobId);
      return true;
    });
  }
  assert.equal(seen.size, 4, "three passes, still only the first four groups");
  assert.equal(seen.has("job-11"), false, "the tail is never reached");
});

test("the budget is DERIVED from the interpreter ceiling, not typed beside it", () => {
  // limits-are-derived, as a test rather than a comment: raising the machine's
  // admission ceiling must raise the sweep's allowance with it. A hand-typed
  // constant would return the same number under both ceilings.
  const low = withEnv({ KP_PYTHON_MAX_CONCURRENT: "2" }, () => scoringSpawnBudget());
  const high = withEnv({ KP_PYTHON_MAX_CONCURRENT: "6" }, () => scoringSpawnBudget());
  assert.ok(high > low, `the budget tracks the ceiling (ceiling 2 -> ${low}, ceiling 6 -> ${high})`);
  assert.equal(high / low, 3, "and tracks it proportionally");

  // An explicit operator override wins over the derivation, and a garbage value
  // falls back to the derived number rather than to zero — a budget of 0 would
  // defer every group and stall the funnel's front door silently.
  const pinned = withEnv({ KP_PYTHON_MAX_CONCURRENT: "2", KP_AUTOMATION_SCORING_SPAWNS_MAX: "5" }, () =>
    scoringSpawnBudget(),
  );
  assert.equal(pinned, 5);
  const garbage = withEnv({ KP_PYTHON_MAX_CONCURRENT: "2", KP_AUTOMATION_SCORING_SPAWNS_MAX: "nope" }, () =>
    scoringSpawnBudget(),
  );
  assert.equal(garbage, low, "an unparseable override resolves to the derivation, never to off");
  assert.ok(garbage >= 1);
});
