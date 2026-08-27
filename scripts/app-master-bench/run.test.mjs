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
//
// The second half of the file pins `buildWithRetry` (P6h): Personas' one-shot
// build fails a meaningful fraction of hires for reasons unrelated to the role,
// so a `failed` build is re-dispatched ONCE — but a timeout never is, and every
// attempt is recorded either way.

import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BUILD_ATTEMPTS, accountedBy, buildFailureReason, buildWithRetry, dispatchedCount, mergeTickSummaries, settleDispatch } from "./run.mjs";

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

// ─── the build retry (P6h) ──────────────────────────────────────────────────
//
// Personas' one-shot build fails a meaningful fraction of hires for reasons
// that have nothing to do with the role under test, and each failure used to
// cost a whole scenario. `buildWithRetry` re-dispatches a FAILED build once —
// and these pin the three lines it must not cross: a timeout is never retried
// (it left an orphan build running), a decision is never retried, and every
// attempt is recorded whether the retry saved the run or not.

/** An `activate` scripted from a list of outcomes, counting its calls. */
const activations = (outcomes) => {
  const calls = [];
  const fn = async (attempt) => {
    calls.push(attempt);
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
};

const FAILED = { ok: false, terminal: "failed", ladder: ["onboarding", "failed"], requestId: "req-1", hiredAgentId: "agent-1" };
const ACTIVE = { ok: true, row: { personaId: "persona-2" }, ladder: ["onboarding", "active"] };

test("a build that ends `failed` is dispatched once more, and BOTH attempts are recorded", async () => {
  const journal = recorder();
  const dispatched = [];
  const activate = activations([FAILED, ACTIVE]);
  const build = await buildWithRetry({
    limitWaitMs: 1,
    wait: async () => {},
    activate,
    dispatch: async (attempt) => dispatched.push(attempt),
    journal,
    reasonFor: async (requestId) => (requestId === "req-1" ? "promotion held: tools never called" : null),
  });

  assert.equal(build.ok, true, "the retry stood the hire up");
  assert.equal(build.attempts, 2);
  assert.deepEqual(dispatched, [2], "exactly one re-dispatch, for the SAME intake");
  assert.equal(activate.calls.length, 2);
  assert.equal(build.row.personaId, "persona-2", "the SECOND build's persona is the one that was hired");

  // The dead build is still in the record — a run that passed on the retry must
  // not read like a clean first-try hire.
  assert.equal(build.failures.length, 1);
  const { buildMs, ...failure } = build.failures[0];
  assert.ok(typeof buildMs === "number" && buildMs >= 0, "each failure records how long the build ran — instant vs real deaths differ");
  assert.deepEqual(failure, {
    attempt: 1,
    requestId: "req-1",
    hiredAgentId: "agent-1",
    terminal: "failed",
    ladder: ["onboarding", "failed"],
    reason: "promotion held: tools never called",
  });
  const retry = journal.lines.find((l) => l.kind === "build-retry");
  assert.ok(retry, "the retry is journalled as it happens");
  assert.equal(retry.attempt, 2);
  assert.equal(retry.previousRequestId, "req-1");
  assert.match(retry.reason, /tools never called/);
});

test("a TIMED-OUT activate is never retried — its build is still running", async () => {
  // A timeout leaves an orphan Personas build session with no cancel endpoint.
  // A second dispatch would race two live builds for one intake and burn two
  // subscription seats to measure one hire, so the throw goes straight through.
  const journal = recorder();
  let dispatches = 0;
  const timeout = new Error('poll("the hire to reach `active`") timed out after 5400000ms');
  await assert.rejects(
    buildWithRetry({
    limitWaitMs: 1,
    wait: async () => {},
      activate: activations([timeout, ACTIVE]),
      dispatch: async () => { dispatches += 1; },
      journal,
    }),
    /timed out/
  );
  assert.equal(dispatches, 0, "a timeout must not re-dispatch");
  assert.deepEqual(journal.lines, [], "…and must not claim a retry it never made");
});

test("a terminal decision is not a flake: `rejected` and `retired` are never retried", async () => {
  for (const terminal of ["rejected", "retired"]) {
    let dispatches = 0;
    const build = await buildWithRetry({
    limitWaitMs: 1,
    wait: async () => {},
      activate: activations([{ ok: false, terminal, ladder: ["onboarding", terminal], requestId: "req-9" }]),
      dispatch: async () => { dispatches += 1; },
      journal: recorder(),
    });
    assert.equal(build.ok, false);
    assert.equal(build.terminal, terminal);
    assert.equal(build.attempts, 1, `${terminal} is a decision about the hire, not a build flake`);
    assert.equal(dispatches, 0);
    assert.equal(build.failures.length, 1, "…and it is still recorded as a build that did not stand");
  }
});

test("the retry is ONE retry: a second failed build ends the run, with both failures recorded", async () => {
  const journal = recorder();
  let dispatches = 0;
  const build = await buildWithRetry({
    limitWaitMs: 1,
    wait: async () => {},
    // These are REAL build deaths, not limit-window refusals — nothing here is
    // "instant", so the wait-it-out third attempt must not fire.
    instantFailureMs: 0,
    activate: activations([FAILED, { ...FAILED, requestId: "req-2", hiredAgentId: "agent-2" }]),
    dispatch: async () => { dispatches += 1; },
    journal,
    reasonFor: async (requestId) => `died in ${requestId}`,
  });
  assert.equal(build.ok, false);
  assert.equal(build.attempts, MAX_BUILD_ATTEMPTS);
  assert.equal(dispatches, 1, "one retry, never a third attempt");
  assert.deepEqual(build.failures.map((f) => f.requestId), ["req-1", "req-2"]);
  assert.deepEqual(build.failures.map((f) => f.reason), ["died in req-1", "died in req-2"]);
});

test("the caller's accumulator survives a throw on the retry", async () => {
  // `result.hire.buildFailures` is the array passed in, so a timeout on the
  // SECOND attempt still leaves the first failure in the run record.
  const failures = [];
  await assert.rejects(
    buildWithRetry({
    limitWaitMs: 1,
    wait: async () => {},
      activate: activations([FAILED, new Error("poll timed out")]),
      dispatch: async () => undefined,
      journal: recorder(),
      failures,
    }),
    /timed out/
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].requestId, "req-1");
  assert.equal(failures[0].reason, null, "no reason was read, and none was invented");
});

test("buildFailureReason reads Personas' buildPhase, and never invents one", () => {
  assert.equal(buildFailureReason({ success: true, data: { status: "failed", buildPhase: "design pass wrote a literal {{param}}" } }), "design pass wrote a literal {{param}}");
  assert.equal(
    buildFailureReason({ data: { buildPhase: { phase: "design", status: "failed", reason: "promotion held: tools never called" } } }),
    "design: promotion held: tools never called"
  );
  assert.equal(buildFailureReason({ data: { buildPhase: { phase: "build", status: "failed" } } }), "build phase build (failed)");
  assert.equal(buildFailureReason({ data: { failureReason: "executor could not create the persona" } }), "executor could not create the persona");
  // An unenveloped body reads the same as an enveloped one.
  assert.equal(buildFailureReason({ status: "failed", error: "boom" }), "boom");
  // Nothing reported stays null — an absent reason is not a reason.
  assert.equal(buildFailureReason({ data: { status: "failed" } }), null);
  assert.equal(buildFailureReason({ data: { buildPhase: {} } }), null);
  assert.equal(buildFailureReason(null), null);
  assert.equal(buildFailureReason({ data: "failed" }), null);
});

test("settle keeps polling past raw 'accounted' until the roster confirms a committed proposal", async () => {
  const { settleDispatch } = await import("./run.mjs");
  // Every reconcile claims plenty of branches (stale ones — sweep #25's 16),
  // but the roster's tenure-scoped opened stays 0 until the third poll.
  let confirms = 0;
  const record = await settleDispatch({
    tickReconcile: async () => ({ ok: true, summary: { phases: [{ phase: "reconcile", ran: true, counts: { branchesSeen: 16, newlyRecorded: 1, gated: 0 } }] } }),
    journal: null,
    night: 1,
    dispatched: 1,
    pollMs: 1,
    timeoutMs: 5_000,
    wait: async () => {},
    confirmOpened: async () => (++confirms >= 3 ? 1 : 0),
  });
  assert.equal(record.stoppedBy, "opened-confirmed");
  assert.equal(record.opened, 1);
  assert.equal(confirms, 3, "the raw accounted arithmetic alone must not stop the loop");
  // And a worker that authors nothing ends on the flat guard, not forever.
  const flat = await settleDispatch({
    tickReconcile: async () => ({ ok: true, summary: { phases: [{ phase: "reconcile", ran: true, counts: { branchesSeen: 16, newlyRecorded: 0, gated: 0 } }] } }),
    journal: null,
    night: 1,
    dispatched: 1,
    pollMs: 1,
    timeoutMs: 5_000,
    wait: async () => {},
    confirmOpened: async () => 0,
  });
  assert.equal(flat.stoppedBy, "stalled");
});

test("an instant double-failure earns exactly one waited-out extra attempt; a real build death does not", async () => {
  const { buildWithRetry } = await import("./run.mjs");
  // Instant failures (mock activate returns immediately) → after both regular
  // attempts, one limit-window wait + attempt 3, which succeeds.
  let dispatches = 0;
  let waited = 0;
  const b = await buildWithRetry({
    activate: async (attempt) => (attempt >= 3 ? { ok: true, row: {}, ladder: [] } : { ok: false, terminal: "failed", requestId: `r${attempt}` }),
    dispatch: async () => { dispatches++; },
    wait: async (ms) => { waited = ms; },
    limitWaitMs: 1234,
  });
  assert.equal(b.ok, true);
  assert.equal(b.attempts, 3);
  assert.equal(waited, 1234, "the extra attempt must wait out the window first");
  // A slow (real) final failure gets no third attempt: simulate by faking a
  // long buildMs via a delayed activate is impractical here, so assert the
  // guard directly — instant flag requires buildMs < INSTANT_FAILURE_MS, and a
  // second instant double-failure would not wait twice:
  let waits = 0;
  const c = await buildWithRetry({
    activate: async () => ({ ok: false, terminal: "failed", requestId: "x" }),
    dispatch: async () => {},
    wait: async () => { waits++; },
    limitWaitMs: 1,
  });
  assert.equal(c.ok, false);
  assert.equal(waits, 1, "the limit-window wait is spent once per scenario, never looped");
});
