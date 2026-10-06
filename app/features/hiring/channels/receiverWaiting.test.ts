import test from "node:test";
import assert from "node:assert/strict";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { WAIT_POLL_MS, WAIT_STALL_MS, startWaitPoll, waitingFor, waitingReceivers } from "./receiverWaiting";

const hook = (over: Partial<ChannelWebhookRecord>) =>
  ({ token: "t", receivedCount: 0, acceptedCount: 0, firstReceivedAt: null, pullUrl: null, lastPullError: null, ...over }) as ChannelWebhookRecord;

// A manual clock: one registered interval the test fires by hand.
function clock() {
  let fn: (() => void) | null = null;
  let cleared = 0;
  return {
    setTimer: (f: () => void) => ((fn = f), 1),
    clearTimer: () => {
      cleared++;
      fn = null;
    },
    fire: () => fn?.(),
    get cleared() {
      return cleared;
    },
    get armed() {
      return fn !== null;
    },
  };
}

test("only a never-reached receiver is waiting", () => {
  const list = [hook({ token: "a" }), hook({ token: "b", receivedCount: 1 }), hook({ token: "c", acceptedCount: 2, receivedCount: 2 })];
  assert.deepEqual(waitingReceivers(list).map((w) => w.token), ["a"]);
  assert.deepEqual(waitingReceivers(null), []);
});

test("listening shows elapsed time and goes stalled only past the threshold", () => {
  const created = "2026-10-06T10:00:00.000Z";
  const at = (ms: number) => Date.parse(created) + ms;
  assert.deepEqual(waitingFor(created, at(60_000)), { elapsedMs: 60_000, stalled: false });
  assert.equal(waitingFor(created, at(WAIT_STALL_MS))?.stalled, true);
  assert.equal(waitingFor(created, at(-5_000))?.elapsedMs, 0, "clock skew never yields negative time");
  assert.equal(waitingFor("not a date", at(0)), null);
});

test("the poll re-reads while waiting, skips while hidden", () => {
  const c = clock();
  let hidden = false;
  let loads = 0;
  startWaitPoll({ load: () => loads++, isActive: () => true, isHidden: () => hidden, setTimer: c.setTimer, clearTimer: c.clearTimer });
  c.fire();
  assert.equal(loads, 1);
  hidden = true;
  c.fire();
  assert.equal(loads, 1, "no polling while the tab is hidden");
  hidden = false;
  c.fire();
  assert.equal(loads, 2);
});

test("a poll that returns verified flips the state and the poll stops itself", () => {
  const c = clock();
  let receivers = [hook({ token: "a" })];
  let loads = 0;
  // The "server" answers verified on the second read.
  startWaitPoll({
    load: () => {
      loads++;
      if (loads === 2) receivers = [hook({ token: "a", receivedCount: 1, firstReceivedAt: "2026-10-06T10:05:00.000Z" })];
    },
    isActive: () => waitingReceivers(receivers).length > 0,
    isHidden: () => false,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  c.fire();
  assert.equal(waitingReceivers(receivers).length, 1);
  c.fire();
  assert.equal(waitingReceivers(receivers).length, 0, "the receiver is no longer waiting");
  c.fire(); // the next tick notices nothing waits and tears down
  assert.equal(c.armed, false);
  assert.equal(loads, 2, "no read after verified");
});

test("polling stops on unmount and stop is idempotent", () => {
  const c = clock();
  let loads = 0;
  const stop = startWaitPoll({ load: () => loads++, isActive: () => true, isHidden: () => false, setTimer: c.setTimer, clearTimer: c.clearTimer });
  stop();
  stop();
  c.fire();
  assert.equal(loads, 0);
  assert.equal(c.cleared, 1);
});

test("the default interval is modest", () => {
  assert.ok(WAIT_POLL_MS >= 10_000);
});
