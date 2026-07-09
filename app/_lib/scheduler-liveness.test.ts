import { test } from "node:test";
import assert from "node:assert/strict";
import {
  schedulerLiveness,
  schedulerLivenessReason,
  isCurrentRunError,
  SCHEDULER_TICK_MS,
  SCHEDULER_STALE_MS,
  SCHEDULER_BOOT_GRACE_MS,
} from "./scheduler-health.ts";

// bug-ui-scan-2026-07-09 #1 — the ops/health surface must NEVER report "Healthy"
// when the self-rescheduling automation clock is dead. Liveness is judged from
// the last_tick_at heartbeat's age; absence of a heartbeat is the exact wedged-
// clock bug and must not read as healthy.

const NOW = Date.parse("2026-07-09T12:00:00.000Z");
const PAST_GRACE = SCHEDULER_BOOT_GRACE_MS + 60_000; // uptime well past the fresh-boot window

test("the staleness threshold is derived from the tick interval, not a second magic number", () => {
  assert.equal(SCHEDULER_STALE_MS, 3 * SCHEDULER_TICK_MS);
  assert.equal(SCHEDULER_BOOT_GRACE_MS, 2 * SCHEDULER_TICK_MS);
});

test("fresh / no heartbeat is NOT healthy — the exact bug", () => {
  // Past the boot grace window, an absent heartbeat means the clock never ticked.
  assert.equal(schedulerLiveness(NOW, null, PAST_GRACE), "stalled");
  assert.equal(schedulerLiveness(NOW, undefined, PAST_GRACE), "stalled");
  // Within the grace window it is a benign "starting" — still NOT "healthy".
  const starting = schedulerLiveness(NOW, null, SCHEDULER_BOOT_GRACE_MS - 1000);
  assert.equal(starting, "starting");
  assert.notEqual(starting, "healthy");
  // Neither absence state may ever be healthy.
  assert.notEqual(schedulerLiveness(NOW, null, PAST_GRACE), "healthy");
});

test("a heartbeat older than the threshold is 'stalled'", () => {
  const stale = schedulerLiveness(NOW, NOW - (SCHEDULER_STALE_MS + 1000), PAST_GRACE);
  assert.equal(stale, "stalled");
  // Boundary: exactly at the threshold is still healthy; one ms past is stalled.
  assert.equal(schedulerLiveness(NOW, NOW - SCHEDULER_STALE_MS, PAST_GRACE), "healthy");
  assert.equal(schedulerLiveness(NOW, NOW - (SCHEDULER_STALE_MS + 1), PAST_GRACE), "stalled");
});

test("a recent heartbeat with clean error rows is 'healthy'", () => {
  // Liveness: a heartbeat one tick old is fresh.
  assert.equal(schedulerLiveness(NOW, NOW - SCHEDULER_TICK_MS, PAST_GRACE), "healthy");
  // ...and the independent error-currency sub-check is clean (no current error row).
  assert.equal(isCurrentRunError(null, { now: NOW }), false);
  assert.equal(isCurrentRunError({ status: "ok", startedAt: new Date(NOW - 1000).toISOString() }, { now: NOW }), false);
});

test("the reason names WHICH thing is broken (and is null when healthy)", () => {
  assert.equal(schedulerLivenessReason("healthy", "2026-07-09T11:59:00.000Z"), null);
  assert.match(schedulerLivenessReason("starting", null) ?? "", /starting/);
  assert.match(schedulerLivenessReason("stalled", "2026-07-09T09:00:00.000Z") ?? "", /stalled.*09:00/);
  // Absent-heartbeat stall spells out that the clock never started.
  assert.match(schedulerLivenessReason("stalled", null) ?? "", /never/);
});
