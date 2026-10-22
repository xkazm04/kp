// Pins the commit window's STORE (useDecisionCommitWindow.ts), the clock half that
// decisionsCommitWindow.test.ts cannot see: a timer armed for one decision must not
// commit another. The reducer's expire() reads the CURRENT state and refuses before
// the deadline, and schedule() clears the previous timer; this drives the real store
// under a mocked clock and counts the writes that reach fetch.
//
// Non-vacuity: with both guards removed (the timer commits whatever is pending, and
// schedule() leaves the old timer armed) the undo-then-rearm scenario below commits
// the second decision 5 s early. Either guard alone holds - that is the point of two.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { DECISION_UNDO_MS } from "./decisionsCommitWindow.ts";
import { armDecision, undoDecision } from "./useDecisionCommitWindow.ts";

const row = (entryId: string) => ({ entryId, action: "reject" as const, label: entryId, expectedStage: "Screened" });

async function withClock(run: (calls: string[]) => void | Promise<void>): Promise<void> {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  }) as typeof fetch;
  try {
    await run(calls);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // let the settled commit fold back to idle
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
}

test("1. a window closes only at its own deadline", async () => {
  await withClock((calls) => {
    armDecision(row("t1"));
    mock.timers.tick(DECISION_UNDO_MS - 1);
    assert.equal(calls.length, 0);
    mock.timers.tick(1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/pipeline\/t1$/);
  });
});

test("2. undo then re-arm: the first window's timer commits nothing, the second commits at its own deadline", async () => {
  await withClock((calls) => {
    armDecision(row("t2a"));
    mock.timers.tick(2000);
    undoDecision();
    mock.timers.tick(1000);
    armDecision(row("t2b")); // armed at 3 s, due at 3 s + window
    mock.timers.tick(DECISION_UNDO_MS - 3000); // t = A's old deadline
    assert.equal(calls.length, 0, "t2a's deadline must not commit t2b");
    mock.timers.tick(3000 + 1); // past B's deadline
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/pipeline\/t2b$/);
  });
});

test("3. undo inside the window writes nothing, ever", async () => {
  await withClock((calls) => {
    armDecision(row("t3"));
    mock.timers.tick(DECISION_UNDO_MS - 1);
    undoDecision();
    mock.timers.tick(DECISION_UNDO_MS * 3);
    assert.equal(calls.length, 0);
  });
});
