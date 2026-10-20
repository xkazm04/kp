import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeyedSaver, type SaveState, type SaverTimers } from "./serverDraft";

// The saver's promises, driven by hand: a fake clock (fire the one pending timer, see
// its delay) and a save whose answers the test decides.

function fakeTimers() {
  let next: { fn: () => void; ms: number } | null = null;
  const timers: SaverTimers = {
    set(fn, ms) {
      next = { fn, ms };
      return next;
    },
    clear(h) {
      if (next === h) next = null;
    },
  };
  return {
    timers,
    delay: () => next?.ms ?? null,
    async fire() {
      const t = next;
      assert.ok(t, "a timer is pending");
      next = null;
      t.fn();
      // let the drain's awaits settle
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

function harness(answers: boolean[] = []) {
  const clock = fakeTimers();
  const writes: [string, string][] = [];
  const states: [string, SaveState][] = [];
  const saver = createKeyedSaver<string>(
    async (key, value) => {
      writes.push([key, value]);
      return answers.length ? answers.shift()! : true;
    },
    (key, state) => states.push([key, state]),
    { delayMs: 800, retryMs: [2000, 5000], timers: clock.timers }
  );
  return { saver, clock, writes, states, last: (key: string) => [...states].reverse().find(([k]) => k === key)?.[1] };
}

test("a burst of pushes is ONE write of the newest value, after the debounce", async () => {
  const h = harness();
  h.saver.push("post-1", "D");
  h.saver.push("post-1", "De");
  h.saver.push("post-1", "Dear");
  assert.equal(h.clock.delay(), 800);
  assert.equal(h.writes.length, 0, "nothing is written while typing");
  assert.equal(h.last("post-1"), "pending");
  await h.clock.fire();
  assert.deepEqual(h.writes, [["post-1", "Dear"]]);
  assert.equal(h.last("post-1"), "saved");
  assert.equal(h.saver.isPending("post-1"), false);
});

test("keys are independent: switching postings never drops the first one's note", async () => {
  const h = harness();
  h.saver.push("post-1", "note one");
  h.saver.push("post-2", "note two");
  await h.clock.fire();
  assert.deepEqual(h.writes, [["post-1", "note one"], ["post-2", "note two"]]);
});

test("a failed write stays pending, says so, and is retried on the backoff until it lands", async () => {
  const h = harness([false, false, true]);
  h.saver.push("design", "editorial");
  await h.clock.fire();
  assert.equal(h.last("design"), "failed");
  assert.equal(h.saver.isPending("design"), true, "the value is kept, never dropped");
  assert.equal(h.clock.delay(), 2000);
  await h.clock.fire();
  assert.equal(h.last("design"), "failed");
  assert.equal(h.clock.delay(), 5000);
  await h.clock.fire();
  assert.equal(h.last("design"), "saved");
  assert.deepEqual(h.writes.map(([, v]) => v), ["editorial", "editorial", "editorial"]);
  assert.equal(h.clock.delay(), null, "nothing left to retry");
});

test("a value typed while its write is in flight is written after it, so the server ends on the newest", async () => {
  const clock = fakeTimers();
  const writes: string[] = [];
  let release: (ok: boolean) => void = () => {};
  const saver = createKeyedSaver<string>(
    (_key, value) => {
      writes.push(value);
      return writes.length === 1 ? new Promise<boolean>((r) => (release = r)) : Promise.resolve(true);
    },
    () => {},
    { timers: clock.timers }
  );
  saver.push("post-1", "first");
  await clock.fire();
  saver.push("post-1", "second");
  release(true);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(writes, ["first", "second"]);
  assert.equal(saver.isPending("post-1"), false);
});

test("flush writes now; a thrown save counts as a failure, not a crash", async () => {
  const clock = fakeTimers();
  const states: SaveState[] = [];
  const saver = createKeyedSaver<string>(
    async () => {
      throw new Error("offline");
    },
    (_k, s) => states.push(s),
    { timers: clock.timers }
  );
  saver.push("post-1", "text");
  saver.flush();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(states, ["pending", "saving", "failed"]);
  assert.equal(saver.isPending("post-1"), true);
  saver.dispose();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(states.slice(-2), ["saving", "failed"], "dispose flushes the pending value once");
  const before = states.length;
  saver.push("post-1", "after dispose");
  assert.equal(states.length, before, "a disposed saver takes nothing new and schedules no retry");
});
