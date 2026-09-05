// The guided tour's run-control ordering — the part of SimulationProvider that had
// no test at all, including its ONE destructive operation.
//
// The defect these pin: reset fired `fetch("/api/sim/reset").catch(() => undefined)`
// and then set `status.reset` unconditionally, so a failed purge (a 500 out of the
// DELETE transaction, or an offline server) reported "Reset" while every (SIM) row
// was still on the board — the demo then re-ran on top of its own residue.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIM_DOOR_IDLE,
  __resetSimDoor,
  consoleMode,
  parseSimDoor,
  performReset,
  refreshSimDoor,
  runControlFlags,
  simDoorSnapshot,
  subscribeSimDoor,
} from "./simRunControl.ts";

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

// --- The status door (/perfect wave 44) ---------------------------------------
//
// The defect these pin: the console's state was a BROWSER fact. The lease lives on
// the server, the provider boots to IDLE_STATE, and nothing asked — so a reloaded
// tab wore the ops deck while its own five-minute lease was still held, and the one
// control that reaches the console from there (`guideAction` → "start") was refused
// with copy telling the presenter to stop a run their tab no longer knew about.

test("a tenant that holds a lease wears the console, even with a freshly booted state", () => {
  const idleState = { running: false, done: false, error: null };
  assert.equal(consoleMode(idleState, false, SIM_DOOR_IDLE), "ops", "a clean tenant still hands the deck back");
  assert.equal(
    consoleMode(idleState, false, { runActive: true, ownedByMe: false, residue: 0 }),
    "sim",
    "a live lease this tab did not claim is exactly when Start is about to be refused"
  );
});

test("residue alone opens the console — Reset must be reachable without starting a run", () => {
  assert.equal(consoleMode({ running: false, done: false, error: null }, false, { runActive: false, ownedByMe: false, residue: 4 }), "sim");
});

test("the three existing reasons are untouched", () => {
  const off = SIM_DOOR_IDLE;
  assert.equal(consoleMode({ running: true, done: false, error: null }, false, off), "sim");
  assert.equal(consoleMode({ running: false, done: true, error: null }, false, off), "sim");
  assert.equal(consoleMode({ running: false, done: false, error: "boom" }, false, off), "sim");
  assert.equal(consoleMode({ running: false, done: false, error: null }, true, off), "sim", "?sim=auto");
});

test("a body that is not the door's shape means NOTHING known, never a fabricated run", () => {
  assert.deepEqual(parseSimDoor(null), SIM_DOOR_IDLE);
  assert.deepEqual(parseSimDoor("<html>502</html>"), SIM_DOOR_IDLE);
  assert.deepEqual(parseSimDoor({ runActive: "yes", residue: 9 }), SIM_DOOR_IDLE, "wrong types are not truthy facts");
  assert.deepEqual(parseSimDoor({ runActive: true, ownedByMe: true, residue: { total: 3 } }), {
    runActive: true,
    ownedByMe: true,
    residue: 3,
  });
});

test("refreshSimDoor publishes a change once, and keeps the last answer when the door is unreachable", async () => {
  __resetSimDoor();
  let notified = 0;
  const stop = subscribeSimDoor(() => notified++);
  const ok = (body: unknown) => async () => ({ ok: true, json: async () => body }) as unknown as Response;

  await refreshSimDoor(ok({ runActive: true, ownedByMe: false, residue: { total: 2 } }) as unknown as typeof fetch);
  assert.deepEqual(simDoorSnapshot(), { runActive: true, ownedByMe: false, residue: 2 });
  assert.equal(notified, 1);

  // Same facts: the snapshot object must not change identity, or every reader
  // re-renders on a poll that learned nothing.
  const before = simDoorSnapshot();
  await refreshSimDoor(ok({ runActive: true, ownedByMe: false, residue: { total: 2 } }) as unknown as typeof fetch);
  assert.equal(simDoorSnapshot(), before);
  assert.equal(notified, 1);

  const dead = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  await refreshSimDoor(dead);
  assert.equal(simDoorSnapshot(), before, "an unreachable door is not evidence the tenant is clean");
  stop();
  __resetSimDoor();
});
