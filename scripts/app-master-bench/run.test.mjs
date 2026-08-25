// The night loop's settle wait, over a fake reconcile.
//
//   node --test scripts/app-master-bench/
//
// What this is really about: an `overnight` tick DISPATCHES fleet sessions and
// returns. The branches those sessions author appear minutes later. The
// 2026-08-25 sweep ticked overnight → reconcile → report in ONE call,
// reconciled 173 ms after a 3-session dispatch, saw `branchesSeen: 0`, and every
// delivery and gate lane in the run stayed unmeasured. `settleDispatch` is the
// wait that closes that hole, and these pin its three exits: accounted,
// stalled, timed out — plus the rule that it never claims to have waited for a
// dispatch nobody reported.

import test from "node:test";
import assert from "node:assert/strict";
import { accountedBy, dispatchedCount, mergeTickSummaries, settleDispatch } from "./run.mjs";

/** A journal that records instead of writing, so a test reads what a run would. */
const recorder = () => {
  const lines = [];
  return { lines, write: (kind, data) => lines.push({ kind, ...data }) };
};

/** A fake clock + a `wait` that advances it without sleeping. */
function fakeClock() {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

/** A reconcile that answers `counts` from the list, in order, last one repeating. */
const scripted = (answers) => {
  let i = 0;
  return async () => {
    const counts = answers[Math.min(i++, answers.length - 1)];
    return { ok: true, summary: { phases: [{ phase: "reconcile", ran: true, counts }] } };
  };
};

const ZERO = { projects: 1, branchesSeen: 0, newlyRecorded: 0, gated: 0, errors: [] };
const THREE = { projects: 1, branchesSeen: 3, newlyRecorded: 3, gated: 3, errors: [] };

test("accountedBy: nothing reported is null, not zero", () => {
  assert.equal(accountedBy(null), null);
  assert.equal(accountedBy({ projects: 1 }), null, "a counts block with none of the three fields is unread");
  assert.equal(accountedBy(ZERO), 0, "a reported zero IS a reading");
  assert.equal(accountedBy({ branchesSeen: 2 }), 2);
  assert.equal(accountedBy({ newlyRecorded: 1, gated: 1 }), 2);
  assert.equal(accountedBy({ branchesSeen: 5, newlyRecorded: 1, gated: 1 }), 5, "the larger account wins");
});

test("dispatchedCount reads both wire shapes, and an unreported count stays null", () => {
  assert.equal(dispatchedCount({ phases: [{ phase: "overnight", counts: { dispatched: 3 } }] }), 3);
  assert.equal(dispatchedCount({ phases: { overnight: { counts: { dispatched: 1 } } } }), 1);
  assert.equal(dispatchedCount({ phases: { overnight: { dispatchedCount: 2 } } }), 2);
  assert.equal(dispatchedCount({ phases: [{ phase: "overnight", ran: true }] }), null);
  assert.equal(dispatchedCount(null), null);
});

test("the settle loop waits until the dispatch is accounted for", async () => {
  const clock = fakeClock();
  const journal = recorder();
  // Branches show up on the THIRD reconcile — the shape a real fleet has.
  const record = await settleDispatch({
    tickReconcile: scripted([ZERO, ZERO, THREE]),
    journal,
    night: 1,
    dispatched: 3,
    pollMs: 1_000,
    timeoutMs: 60_000,
    now: clock.now,
    wait: clock.wait,
  });
  assert.equal(record.stoppedBy, "accounted");
  assert.equal(record.polls.length, 3);
  // 3 branches seen AND 3 recorded + 3 gated: the account overshoots the
  // dispatch, which is fine — the question a stop condition answers is "has the
  // fleet's work shown up yet", not "exactly how much".
  assert.equal(record.accounted, 6);
  assert.equal(record.ms, 2_000, "it slept between polls, not before the first one");
  // Every poll is journalled AS IT HAPPENS — a wait nobody can read is a wait
  // nobody can debug.
  assert.equal(journal.lines.filter((l) => l.kind === "settle-poll").length, 3);
  assert.deepEqual(
    journal.lines.map((l) => l.accounted),
    [0, 0, 6]
  );
});

test("the settle loop gives up when the counts stop moving", async () => {
  const clock = fakeClock();
  const journal = recorder();
  const record = await settleDispatch({
    tickReconcile: scripted([ZERO]),
    journal,
    night: 2,
    dispatched: 3,
    pollMs: 100,
    timeoutMs: 600_000,
    now: clock.now,
    wait: clock.wait,
  });
  assert.equal(record.stoppedBy, "stalled");
  // Three consecutive polls that did not move the account, starting with the
  // first: ~3 minutes at the 90s default, then the night reports what it has.
  assert.equal(record.polls.length, 3, "three consecutive polls that did not move it");
  assert.equal(record.accounted, 0, "a stalled settle reports what it DID account for");
});

test("a partial account still stalls out rather than waiting forever", async () => {
  const clock = fakeClock();
  const one = { branchesSeen: 1, newlyRecorded: 0, gated: 0 };
  const record = await settleDispatch({
    tickReconcile: scripted([one, ZERO]),
    journal: recorder(),
    night: 3,
    dispatched: 3,
    pollMs: 10,
    timeoutMs: 600_000,
    now: clock.now,
    wait: clock.wait,
  });
  assert.equal(record.stoppedBy, "stalled");
  assert.equal(record.accounted, 1, "1 of 3 accounted for — the run says so instead of rounding it up");
});

test("the settle budget is a hard stop, and it never sleeps past it", async () => {
  const clock = fakeClock();
  const record = await settleDispatch({
    tickReconcile: async () => ({ ok: true, summary: { phases: [{ phase: "reconcile", counts: { branchesSeen: 0 } }] } }),
    journal: recorder(),
    night: 4,
    dispatched: 9,
    pollMs: 400,
    timeoutMs: 1_000,
    now: clock.now,
    wait: clock.wait,
    stallPolls: 99,
  });
  assert.equal(record.stoppedBy, "timeout");
  assert.ok(record.ms <= 1_000, `settled for ${record.ms}ms, over its 1000ms budget`);
});

test("a night that dispatched nothing does not pretend to have waited", async () => {
  const journal = recorder();
  const record = await settleDispatch({
    tickReconcile: async () => assert.fail("a night with no dispatch must not tick reconcile at all"),
    journal,
    night: 5,
    dispatched: 0,
    pollMs: 1,
    timeoutMs: 1,
  });
  assert.equal(record.stoppedBy, "nothing-dispatched");
  assert.deepEqual(record.polls, []);
  assert.equal(journal.lines[0].kind, "settle-skip");
});

test("an UNREPORTED dispatch count is not read as zero", async () => {
  const record = await settleDispatch({
    tickReconcile: async () => assert.fail("nothing to wait for"),
    journal: recorder(),
    night: 6,
    dispatched: null,
    pollMs: 1,
    timeoutMs: 1,
  });
  assert.equal(record.stoppedBy, "dispatch-unreported");
});

test("a refusing reconcile is recorded, not thrown", async () => {
  const clock = fakeClock();
  const journal = recorder();
  const record = await settleDispatch({
    tickReconcile: async () => ({ ok: false, summary: null, error: "503 bridge is restarting" }),
    journal,
    night: 7,
    dispatched: 2,
    pollMs: 5,
    timeoutMs: 10_000,
    now: clock.now,
    wait: clock.wait,
  });
  assert.equal(record.stoppedBy, "stalled");
  assert.equal(record.polls[0].ok, false);
  assert.match(record.polls[0].error, /503/);
  assert.equal(record.polls[0].counts, null, "an errored poll reports no counts, never zeroes");
});

test("mergeTickSummaries folds one night's three ticks into one summary", () => {
  const merged = mergeTickSummaries([
    { projectId: "p", phases: [{ phase: "overnight", counts: { dispatched: 3 } }] },
    { projectId: "p", phases: [{ phase: "reconcile", counts: { branchesSeen: 3 } }] },
    { projectId: "p", phases: [{ phase: "report", counts: { pushed: 1 } }] },
  ]);
  assert.equal(merged.projectId, "p");
  assert.deepEqual(merged.phases.map((p) => p.phase), ["overnight", "reconcile", "report"]);

  // The stub's object shape merges too.
  const stub = mergeTickSummaries([
    { phases: { overnight: { counts: { dispatched: 1 } } } },
    null,
    { phases: { report: { delivered: true } } },
  ]);
  assert.deepEqual(Object.keys(stub.phases), ["overnight", "report"]);
  assert.equal(mergeTickSummaries([null, undefined]), null);
});
