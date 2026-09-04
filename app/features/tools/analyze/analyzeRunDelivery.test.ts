// The abort tail of the Analyze run.
//
// Two leaks lived here and neither had a test. (1) The result-delivery timer was
// a bare `window.setTimeout(() => onResult(parsed), 320)` — never cleared, never
// signal-checked — so a run cancelled or a tab unmounted inside that 320 ms
// window still slammed a superseded analysis into a torn-down surface. (2) the
// GitHub deep-dive took no AbortSignal at all: superseding it only made the
// callbacks *ignored*, while the request (and its extract-text Python hop) ran to
// completion on the recruiter's bill.
//
// The delivery half is pinned on the pure builder (`scheduleResultDelivery`) with
// an injected timer surface, so no browser clock is needed. The signal half is
// pinned on `executeGithubAnalysis` against a stub `fetch` that records the init
// it was handed, plus a source-level guard for the hop the stub can't observe.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/features/tools/analyze/analyzeRunDelivery.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RESULT_SETTLE_MS, scheduleResultDelivery, type DeliveryTimers } from "./analyzeRunDelivery.ts";

// A hand-cranked clock: `run()` fires every timer that has not been cleared, so a
// test asserts on delivery/non-delivery without waiting 320 real milliseconds.
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timers: DeliveryTimers = {
    set(fn, ms) {
      assert.equal(ms, RESULT_SETTLE_MS, "the settle delay must come from the shared constant");
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
  };
  return {
    timers,
    get scheduled() {
      return pending.size;
    },
    run() {
      for (const fn of [...pending.values()]) fn();
      pending.clear();
    },
  };
}

test("scheduleResultDelivery delivers the result once the settle delay elapses", () => {
  const clock = fakeTimers();
  const seen: string[] = [];
  scheduleResultDelivery("analysis", (value) => seen.push(value), undefined, clock.timers);
  assert.deepEqual(seen, [], "delivery is deferred, not immediate");
  clock.run();
  assert.deepEqual(seen, ["analysis"]);
});

test("an already-aborted signal schedules no delivery timer at all", () => {
  const clock = fakeTimers();
  const controller = new AbortController();
  controller.abort();
  const seen: string[] = [];
  scheduleResultDelivery("analysis", (value) => seen.push(value), controller.signal, clock.timers);
  assert.equal(clock.scheduled, 0);
  clock.run();
  assert.deepEqual(seen, []);
});

test("aborting inside the settle window clears the timer — nothing is delivered", () => {
  const clock = fakeTimers();
  const controller = new AbortController();
  const seen: string[] = [];
  scheduleResultDelivery("analysis", (value) => seen.push(value), controller.signal, clock.timers);
  assert.equal(clock.scheduled, 1);
  controller.abort();
  assert.equal(clock.scheduled, 0, "the abort listener must clear the pending timer");
  clock.run();
  assert.deepEqual(seen, [], "a cancelled run must not write its result back");
});

test("a timer that survives the clear still re-checks the signal at fire time", () => {
  // The listener and the timer can race in either order (an abort dispatched
  // while the timer callback is already queued), so the callback carries its own
  // guard. Modelled by a timer surface whose clear() is a no-op.
  const fired: string[] = [];
  const queued: Array<() => void> = [];
  const deaf: DeliveryTimers = { set: (fn) => (queued.push(fn), 1), clear: () => {} };
  const controller = new AbortController();
  scheduleResultDelivery("analysis", (value) => fired.push(value), controller.signal, deaf);
  controller.abort();
  for (const fn of queued) fn();
  assert.deepEqual(fired, [], "the fire-time signal check is the second door");
});

test("the delivery cancel handle drops a pending delivery", () => {
  const clock = fakeTimers();
  const seen: string[] = [];
  const cancel = scheduleResultDelivery("analysis", (value) => seen.push(value), undefined, clock.timers);
  cancel();
  clock.run();
  assert.deepEqual(seen, []);
});

// --- the GitHub deep-dive's signal ------------------------------------------

type FetchInit = { signal?: AbortSignal } & Record<string, unknown>;

async function runGithub(opts: {
  signal?: AbortSignal;
  respond: (init: FetchInit) => Promise<unknown> | unknown;
}) {
  const seenInits: FetchInit[] = [];
  const original = globalThis.fetch;
  const events: string[] = [];
  // A test double for the browser fetch this module calls: it only ever needs to
  // record the init and answer with `ok` + `json()`, so it is cast in rather than
  // implementing the full Response surface.
  globalThis.fetch = (async (_url: string, init: FetchInit) => {
    seenInits.push(init);
    const payload = await opts.respond(init);
    return { ok: true, json: async () => payload } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  try {
    const { executeGithubAnalysis } = await import("./analyzeGithubRun.ts");
    await executeGithubAnalysis(
      "octocat",
      { jobDescriptionText: "Backend engineer", jobDescriptionFile: null },
      {
        onLoading: () => events.push("loading"),
        onResult: () => events.push("result"),
        onError: () => events.push("error"),
        onWarning: () => events.push("warning"),
      },
      opts.signal
    );
  } finally {
    globalThis.fetch = original;
  }
  return { seenInits, events };
}

test("executeGithubAnalysis forwards the run's signal to the deep-dive fetch", async () => {
  const controller = new AbortController();
  const { seenInits } = await runGithub({
    signal: controller.signal,
    respond: () => ({ profile: "octocat", summary: "", signals: [], repos: [] }),
  });
  assert.equal(seenInits.length, 1);
  assert.equal(seenInits[0].signal, controller.signal, "the fetch must carry the run's signal");
});

test("an already-aborted deep-dive never even reports loading", async () => {
  const controller = new AbortController();
  controller.abort();
  const { seenInits, events } = await runGithub({
    signal: controller.signal,
    respond: () => ({}),
  });
  assert.deepEqual(seenInits, [], "no request is made for a run that is already superseded");
  assert.deepEqual(events, [], "and no callback fires on the torn-down surface");
});

test("an aborted deep-dive surfaces no error toast", async () => {
  const controller = new AbortController();
  const { events } = await runGithub({
    signal: controller.signal,
    respond: () => {
      controller.abort();
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    },
  });
  assert.deepEqual(
    events,
    ["loading"],
    "an intentional abort is not a failure — it must not reach onError"
  );
});

// The extract-text hop happens only for a file-only JD, which needs a File the
// module then streams; a source-level guard is the honest check that the same
// signal reaches it (and that the delivery timer is no longer a bare setTimeout).
test("the extraction hop and the delivery timer are both signal-aware in source", () => {
  const gh = readFileSync(fileURLToPath(new URL("./analyzeGithubRun.ts", import.meta.url)), "utf8");
  assert.match(gh, /extractFileText\(jd\.jobDescriptionFile, signal\)/, "the JD extraction hop takes the signal");
  const run = readFileSync(fileURLToPath(new URL("./analyzeRunAnalysis.ts", import.meta.url)), "utf8");
  assert.ok(
    !/window\.setTimeout\(\(\) => callbacks\.onResult/.test(run),
    "the uncleared 320ms delivery timer must be gone"
  );
  assert.match(run, /scheduleResultDelivery\(parsed, callbacks\.onResult, signal\)/);
  const api = readFileSync(fileURLToPath(new URL("./AnalyzeApi.ts", import.meta.url)), "utf8");
  assert.match(api, /"\/api\/extract-text", \{ method: "POST", body: form, signal \}/);
});
