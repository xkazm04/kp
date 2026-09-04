// The scheduler control's pure state machine — the subtlest logic in the
// pipeline context and, until this file, the only part of it with no test.
//
// Four properties are pinned here:
//   1. LIVENESS never lets an armed-but-dead clock read green. `sched.enabled`
//      is a stored FLAG; whether the tick loop is alive is a separate signal
//      (app/_lib/scheduler-health.ts) that only the health/ops routes consumed.
//   2. describeTick turns a tick outcome into one legible chip, driven by the
//      one bucket table so chip and badges cannot drift.
//   3. clampInterval refuses to persist a cadence the engine will not honor.
//   4. The poll backs off on failure instead of hammering a dead engine at a
//      fixed 30s forever.
//
// Runner: node:test via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLL_BASE_MS,
  POLL_MAX_MS,
  SUMMARY_BUCKETS,
  clampInterval,
  describeTick,
  enabledPillTone,
  livenessChip,
  nextPollDelay,
} from "./schedulerRunState.ts";

// A translator double: echoes the key plus its interpolations, so an assertion
// reads as "which key, with what numbers" rather than as English copy.
const t = (key: string, values?: Record<string, unknown>) =>
  values && Object.keys(values).length ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

test("livenessChip: an ARMED but stalled clock never reads healthy", () => {
  const chip = livenessChip(true, "stalled");
  assert.ok(chip, "an armed clock's liveness must be shown");
  assert.equal(chip.tone, "danger");
  assert.equal(chip.labelKey, "liveStalled");
  // The regression this guards: the ON pill rendering the stored flag alone.
  assert.equal(enabledPillTone(true, "stalled"), "degraded");
});

test("livenessChip: healthy and starting are distinct, and starting is not green", () => {
  assert.deepEqual(livenessChip(true, "healthy"), { tone: "ok", labelKey: "liveHealthy" });
  assert.deepEqual(livenessChip(true, "starting"), { tone: "warn", labelKey: "liveStarting" });
  assert.equal(enabledPillTone(true, "healthy"), "on");
  assert.equal(enabledPillTone(true, "starting"), "degraded");
});

test("livenessChip: a DISARMED clock reports nothing — off is what the pill already says", () => {
  assert.equal(livenessChip(false, "stalled"), null);
  assert.equal(livenessChip(false, "healthy"), null);
  assert.equal(enabledPillTone(false, "stalled"), "off");
});

test("livenessChip: an older server that sends no liveness renders no chip", () => {
  assert.equal(livenessChip(true, null), null);
  assert.equal(livenessChip(true, undefined), null);
  // …and the pill falls back to the flag rather than crying stalled.
  assert.equal(enabledPillTone(true, null), "on");
});

test("describeTick: an error tick carries the detail verbatim", () => {
  assert.deepEqual(describeTick({ ran: false, error: "boom" }, t), { tone: "error", text: "boom" });
});

test("describeTick: nothing due is neutral, not a success", () => {
  assert.deepEqual(describeTick({ ran: false }, t), { tone: "neutral", text: "nothingDue" });
});

test("describeTick: a run with counts names every non-zero bucket, in table order", () => {
  const r = describeTick({ ran: true, summary: { advanced: 2, held: 1, errors: 0 } }, t);
  assert.equal(r.tone, "ok");
  assert.equal(r.text, "ranWith(parts=summaryAdvanced(n=2), summaryHeld(n=1))");
});

test("describeTick: a run that changed nothing still reads as a run", () => {
  assert.deepEqual(describeTick({ ran: true, summary: {} }, t), { tone: "ok", text: "ranNoChanges" });
  assert.deepEqual(describeTick({ ran: true, summary: null }, t), { tone: "ok", text: "ranNoChanges" });
});

test("SUMMARY_BUCKETS is the one bucket table, in display order", () => {
  assert.deepEqual(
    SUMMARY_BUCKETS.map((b) => b.key),
    ["advanced", "rejected", "held", "alerts", "errors"]
  );
});

test("clampInterval: holds the engine's [1, 1440] window", () => {
  assert.equal(clampInterval("5000", 15), 1440);
  assert.equal(clampInterval("0.2", 15), 1);
  assert.equal(clampInterval("60", 15), 60);
  assert.equal(clampInterval("7.6", 15), 8);
});

test("clampInterval: empty / zero / garbage is 'no change', not a stored 0", () => {
  assert.equal(clampInterval("", 15), 15);
  assert.equal(clampInterval("0", 15), 15);
  assert.equal(clampInterval("-4", 15), 15);
  assert.equal(clampInterval("abc", 15), 15);
});

test("nextPollDelay: doubles from the base and stops at the cap", () => {
  assert.equal(nextPollDelay(0), POLL_BASE_MS);
  assert.equal(nextPollDelay(1), 2 * POLL_BASE_MS);
  assert.equal(nextPollDelay(2), 4 * POLL_BASE_MS);
  assert.equal(nextPollDelay(9), POLL_MAX_MS);
  // Monotonic and never below the base — a retry storm is the failure mode.
  for (let i = 0; i < 12; i += 1) {
    assert.ok(nextPollDelay(i) >= POLL_BASE_MS);
    assert.ok(nextPollDelay(i) <= POLL_MAX_MS);
    assert.ok(nextPollDelay(i + 1) >= nextPollDelay(i));
  }
});
