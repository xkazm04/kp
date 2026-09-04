import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefreshCoalescer, LIVE_REFRESH_DEBOUNCE_MS } from "./live-refresh.ts";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The bus fires twice for one mutation on a multi-window setup (window event +
// BroadcastChannel), and a simulation step fires it in bursts — the debounce is
// what stops every open view re-fetching once per signal. It had no test.

test("a burst of signals coalesces into ONE reload", async () => {
  let runs = 0;
  const c = createRefreshCoalescer(() => runs++, 10);
  c.signal();
  c.signal();
  c.signal();
  assert.equal(runs, 0, "nothing runs synchronously");
  await tick(30);
  assert.equal(runs, 1);
  c.cancel();
});

test("signals further apart than the window each get their own reload", async () => {
  let runs = 0;
  const c = createRefreshCoalescer(() => runs++, 10);
  c.signal();
  await tick(30);
  c.signal();
  await tick(30);
  assert.equal(runs, 2);
  c.cancel();
});

test("cancel drops a pending reload — an unmounted view never fetches", async () => {
  let runs = 0;
  const c = createRefreshCoalescer(() => runs++, 10);
  c.signal();
  c.cancel();
  await tick(30);
  assert.equal(runs, 0);
});

test("the coalescer always calls the LATEST handler (no re-subscribe churn)", async () => {
  const seen: string[] = [];
  let which = "first";
  const c = createRefreshCoalescer(() => seen.push(which), 10);
  c.signal();
  which = "second";
  await tick(30);
  assert.deepEqual(seen, ["second"]);
  c.cancel();
});

test("the default debounce window is the shared constant", () => {
  assert.equal(LIVE_REFRESH_DEBOUNCE_MS, 250);
});
