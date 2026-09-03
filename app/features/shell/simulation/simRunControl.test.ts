// The guided tour's run-control ordering — the part of SimulationProvider that had
// no test at all, including its ONE destructive operation.
//
// The defect these pin: reset fired `fetch("/api/sim/reset").catch(() => undefined)`
// and then set `status.reset` unconditionally, so a failed purge (a 500 out of the
// DELETE transaction, or an offline server) reported "Reset" while every (SIM) row
// was still on the board — the demo then re-ran on top of its own residue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { performReset, runControlFlags } from "./simRunControl.ts";

const IDLE = { stop: false, paused: false };

test("start clears BOTH flags — a stale stop must not kill the new run at its first checkpoint", () => {
  assert.deepEqual(runControlFlags("start", { stop: true, paused: true }), { flags: IDLE, wakes: false });
});

test("pause sets paused without waking; resume clears it and THEN wakes", () => {
  const paused = runControlFlags("pause", IDLE);
  assert.deepEqual(paused, { flags: { stop: false, paused: true }, wakes: false });
  // The woken walk re-reads `paused`, so a wake with the flag still set re-parks it.
  const resumed = runControlFlags("resume", paused.flags);
  assert.equal(resumed.flags.paused, false);
  assert.equal(resumed.wakes, true);
});

test("stop wakes a parked gate — otherwise the flag is never observed and reset waits forever", () => {
  assert.deepEqual(runControlFlags("stop", { stop: false, paused: true }), { flags: { stop: true, paused: true }, wakes: true });
});

test("reset runs stop → settle → purge, in that order", async () => {
  const order: string[] = [];
  const out = await performReset({
    requestStop: () => void order.push("stop"),
    settleRun: async () => void order.push("settle"),
    purge: async () => {
      order.push("purge");
      return true;
    },
  });
  // Purging before the in-flight mutation settles deletes rows it then re-creates.
  assert.deepEqual(order, ["stop", "settle", "purge"]);
  assert.deepEqual(out, { cleared: true, steps: ["stop", "settle", "purge"] });
});

test("a purge that answers non-2xx reports cleared:false — never a green 'Reset'", async () => {
  const out = await performReset({ requestStop: () => {}, settleRun: async () => {}, purge: async () => false });
  assert.equal(out.cleared, false);
});

test("a purge that THROWS is a failed cleanup, not a swallowed success", async () => {
  const out = await performReset({
    requestStop: () => {},
    settleRun: async () => {},
    purge: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(out.cleared, false, "the old `.catch(() => undefined)` reported success here");
  assert.deepEqual(out.steps, ["stop", "settle", "purge"], "the purge step still happened — it just failed");
});
