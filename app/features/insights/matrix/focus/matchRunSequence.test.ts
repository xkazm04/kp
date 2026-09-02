// grid-narrative-says-what-it-is (b). The pure half of the stale-response guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunSequence } from "./matchRunSequence.ts";

test("only the most recently started run is current", () => {
  const seq = createRunSequence();
  const first = seq.start();
  assert.equal(seq.isCurrent(first), true);
  const second = seq.start();
  assert.equal(seq.isCurrent(second), true);
  // The whole bug: a slower EARLIER run resolving after a newer one started.
  assert.equal(seq.isCurrent(first), false, "a superseded run must never reach the screen");
});

test("a ticket stays current across repeated checks (the settle and the finally both ask)", () => {
  const seq = createRunSequence();
  const t = seq.start();
  assert.equal(seq.isCurrent(t), true);
  assert.equal(seq.isCurrent(t), true);
});

test("a ticket that was never issued is never current, including 0", () => {
  const seq = createRunSequence();
  assert.equal(seq.isCurrent(0), false, "0 must not read as current before the first run");
  seq.start();
  assert.equal(seq.isCurrent(0), false);
  assert.equal(seq.isCurrent(99), false);
});

test("two sequences are independent (one per hook instance)", () => {
  const a = createRunSequence();
  const b = createRunSequence();
  const ta = a.start();
  b.start();
  b.start();
  assert.equal(a.isCurrent(ta), true, "b's runs must not supersede a's");
});

// The ordering this guard exists for, played out end to end.
test("out-of-order resolution: the slow first response is dropped, the fast second wins", async () => {
  const seq = createRunSequence();
  const committed: string[] = [];
  const run = async (name: string, ms: number) => {
    const ticket = seq.start();
    await new Promise((res) => setTimeout(res, ms));
    if (!seq.isCurrent(ticket)) return;
    committed.push(name);
  };
  const slow = run("ada", 30);
  await new Promise((res) => setTimeout(res, 1));
  const fast = run("bo", 1);
  await Promise.all([slow, fast]);
  assert.deepEqual(committed, ["bo"], "ada's ranking must not overwrite bo's");
});
