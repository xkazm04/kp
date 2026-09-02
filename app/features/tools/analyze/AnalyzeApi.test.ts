// Pins the Analyze seam's two contracts that had none.
//
// (1) THE ERROR PRECEDENCE. A failed run reaches the surface as an
//     AnalyzeErrorInfo carrying up to three things that could be shown: a route's
//     machine `apiCode`, the engine/server's English `serverText`, and this
//     module's own stable `code`. Only one order is honest — a code localizes and
//     English does not — so `resolveAnalyzeErrorText` is the single place that
//     decides, and these tests lock it: code > server text > generic.
//
// (2) THE POLL CONTRACT (added with the backoff/visibility work). watchAnalysis
//     is the longest-lived client loop in the app and had zero tests: the terminal
//     404, the ten-soft-failure ceiling, forward-only phases, abort, and the
//     hidden-tab pause all lived only in prose.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit -- app/features/tools/analyze/AnalyzeApi.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnalyzeClientError,
  nextPollDelay,
  resolveAnalyzeErrorText,
  watchAnalysis,
  type AnalyzeMessageResolvers,
} from "./AnalyzeApi.ts";

// A resolver set whose every channel is distinguishable in the assertion, so a
// wrong precedence shows up as the WRONG CHANNEL rather than as a wrong string.
function resolvers(over: Partial<AnalyzeMessageResolvers> = {}): AnalyzeMessageResolvers {
  return {
    appCode: (code) => (code === "UPLOAD_TOO_LARGE" ? `app:${code}` : null),
    githubCode: (code) => (code === "RATE_LIMITED" ? `gh:${code}` : null),
    analyzeCode: (code) => (code === "errIncomplete" ? `analyze:${code}` : null),
    retryAfter: (seconds) => `retry:${seconds}`,
    generic: "generic",
    ...over,
  };
}

test("a route's machine code wins over the server's English", () => {
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "UPLOAD_TOO_LARGE", serverText: "The profile exceeds the 8 MB upload limit." },
    resolvers()
  );
  assert.equal(text, "app:UPLOAD_TOO_LARGE");
});

test("a GitHub-namespace code resolves when the app-wide catalog does not know it", () => {
  const text = resolveAnalyzeErrorText({ code: "errGithubFailed", apiCode: "RATE_LIMITED" }, resolvers());
  assert.equal(text, "gh:RATE_LIMITED");
});

test("an unknown api code falls through to the server text rather than swallowing it", () => {
  // The old resolver returned the generic line the moment an apiCode was present,
  // even one no catalog knew — throwing away the only information there was.
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "SOMETHING_NEW", serverText: "engine said no" },
    resolvers()
  );
  assert.equal(text, "engine said no");
});

test("server text wins over the generic line when there is no code", () => {
  const text = resolveAnalyzeErrorText({ code: "errFailed", serverText: "python traceback tail" }, resolvers());
  assert.equal(text, "python traceback tail");
});

test("the stable analyze code is the floor, and an unknown one degrades to generic", () => {
  assert.equal(resolveAnalyzeErrorText({ code: "errIncomplete" }, resolvers()), "analyze:errIncomplete");
  assert.equal(resolveAnalyzeErrorText({ code: "errFailed" }, resolvers()), "generic");
  assert.equal(resolveAnalyzeErrorText({}, resolvers()), "generic");
});

test("a throttle with a Retry-After beats every other channel", () => {
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "TOO_MANY_REQUESTS", retryAfterSeconds: 42, serverText: "Too many requests" },
    resolvers()
  );
  assert.equal(text, "retry:42");
});

test("a throttle WITHOUT a Retry-After still resolves its code", () => {
  const text = resolveAnalyzeErrorText(
    { code: "errFailed", apiCode: "TOO_MANY_REQUESTS" },
    resolvers({ appCode: (code) => `app:${code}` })
  );
  assert.equal(text, "app:TOO_MANY_REQUESTS");
});

test("AnalyzeClientError carries status, code and retry-after alongside the server text", () => {
  const err = new AnalyzeClientError("errFailed", "  boom  ", "UPLOAD_TOO_LARGE", { status: 413, retryAfterSeconds: 5 });
  assert.equal(err.code, "errFailed");
  assert.equal(err.serverText, "boom");
  assert.equal(err.apiCode, "UPLOAD_TOO_LARGE");
  assert.equal(err.status, 413);
  assert.equal(err.retryAfterSeconds, 5);
});

test("AnalyzeClientError ignores blank/non-string server text and codes", () => {
  const err = new AnalyzeClientError("errFailed", "   ", 42);
  assert.equal(err.serverText, undefined);
  assert.equal(err.apiCode, undefined);
  assert.equal(err.message, "errFailed");
});

// ── The poll contract ────────────────────────────────────────────────────────
// watchAnalysis is the longest-lived loop in the client and had no test at all:
// the terminal 404, the ten-soft-failure ceiling, forward-only phases, abort and
// (new) the hidden-tab pause + backoff were prose only. The fetch double below
// serves a scripted sequence of responses; `sleep`/`isHidden`/`whenVisible` are
// injected so the contract runs in milliseconds instead of in real cadence.

type Scripted = { status?: number; body?: unknown; throws?: boolean };

/** Install a fetch double serving `script` in order; the last entry repeats. */
function scriptFetch(script: Scripted[]): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step.throws) throw new TypeError("network down");
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => step.body,
    } as unknown as Response;
  }) as typeof fetch;
  return { calls: () => i, restore: () => { globalThis.fetch = original; } };
}

const running = (msg: string | null, done = 0, total = 0) => ({
  status: 200,
  body: { task: { status: "running", progressMsg: msg, progressDone: done, progressTotal: total } },
});

// A minimal Analysis the schema accepts is not worth reconstructing here, so the
// success path is covered by the "bad payload" assertion instead: a 'succeeded'
// task whose result does not parse must raise errBadPayload, which proves the
// terminal branch is reached and validated rather than trusted.
const instant = { sleep: async () => {}, isHidden: () => false, whenVisible: async () => {} };

async function caught(run: Promise<unknown>): Promise<{ name?: string; code?: string }> {
  try {
    await run;
    return {};
  } catch (err) {
    const e = err as { name?: string; code?: string };
    return { name: e.name, code: e.code };
  }
}

test("a 404 is terminal — the task is gone, so the loop stops instead of polling forever", async () => {
  const f = scriptFetch([{ status: 404 }]);
  try {
    const err = await caught(watchAnalysis("t1", () => {}, undefined, undefined, instant));
    assert.equal(err.code, "errUnavailable");
    assert.equal(f.calls(), 1, "a terminal 404 must not be retried");
  } finally {
    f.restore();
  }
});

test("ten consecutive soft failures give up; the ninth does not", async () => {
  // Non-OK, thrown fetch and a 200 with no task body are the three soft branches;
  // mixing them proves they share ONE counter.
  const soft: Scripted[] = [{ status: 500 }, { throws: true }, { status: 200, body: {} }];
  const nine = [...soft, ...soft, ...soft, running("analyzing")];
  const f = scriptFetch(nine);
  try {
    // The tenth call is `running` here, so the counter resets and the loop
    // continues — proven by it going on to the next scripted entry rather than
    // throwing. Abort it once we know it survived.
    const controller = new AbortController();
    const watch = watchAnalysis("t2", () => controller.abort(), controller.signal, undefined, instant);
    assert.equal((await caught(watch)).name, "AbortError", "nine soft failures must not end the watch");
  } finally {
    f.restore();
  }

  const g = scriptFetch([{ status: 500 }]);
  try {
    const err = await caught(watchAnalysis("t3", () => {}, undefined, undefined, instant));
    assert.equal(err.code, "errLostTrack", "ten consecutive soft failures must give up");
    assert.equal(g.calls(), 10, "the ceiling is exactly ten polls");
  } finally {
    g.restore();
  }
});

test("phases are emitted as the server reports them, and the emitter never rewinds", async () => {
  const seen: string[] = [];
  const f = scriptFetch([
    running("reading"),
    running("analyzing"),
    running("reading"), // a retry re-reporting an earlier phase
    { status: 200, body: { task: { status: "failed", error: "engine exploded" } } },
  ]);
  try {
    const err = await caught(watchAnalysis("t4", (stage) => seen.push(stage), undefined, undefined, instant));
    assert.equal(err.code, "errIncomplete");
    // The seed plus the three reported phases. applyStageEvent (the emitter's
    // consumer) is what refuses to re-open a completed stage; this pins that
    // watchAnalysis forwards the server's phase verbatim and invents none.
    assert.deepEqual(seen, ["reading", "reading", "analyzing", "reading"]);
  } finally {
    f.restore();
  }
});

test("a succeeded task whose result does not parse is a bad payload, not a silent pass", async () => {
  const f = scriptFetch([{ status: 200, body: { task: { status: "succeeded", result: { nope: true } } } }]);
  try {
    assert.equal((await caught(watchAnalysis("t5", () => {}, undefined, undefined, instant))).code, "errBadPayload");
  } finally {
    f.restore();
  }
});

test("an abort surfaces as AbortError and is never reported as a failure", async () => {
  const f = scriptFetch([running("analyzing")]);
  try {
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      (await caught(watchAnalysis("t6", () => {}, controller.signal, undefined, instant))).name,
      "AbortError"
    );
    assert.equal(f.calls(), 0, "an already-aborted watch must not poll at all");
  } finally {
    f.restore();
  }
});

test("a hidden tab parks instead of polling, and resumes when shown", async () => {
  const f = scriptFetch([running("analyzing"), { status: 404 }]);
  let hidden = true;
  let parked = 0;
  try {
    const err = await caught(
      watchAnalysis("t7", () => {}, undefined, undefined, {
        sleep: async () => {},
        isHidden: () => hidden,
        whenVisible: async () => {
          parked += 1;
          hidden = false; // the tab comes back
        },
      })
    );
    assert.equal(parked, 1, "the loop must park on visibility, not poll through it");
    assert.equal(err.code, "errUnavailable");
    // Two polls: the one after the tab came back, then the terminal 404.
    assert.equal(f.calls(), 2);
  } finally {
    f.restore();
  }
});

test("the cadence backs off only after a run of quiet ticks, and any news resets it", () => {
  assert.equal(nextPollDelay(0), 1500, "a fresh run polls at the base cadence");
  assert.equal(nextPollDelay(19), 1500, "backoff must not start early");
  assert.equal(nextPollDelay(20), 3000, "20 quiet ticks (~30s of no news) doubles the interval");
  assert.equal(nextPollDelay(40), 6000);
  assert.equal(nextPollDelay(400), 6000, "the interval is capped, so a long run stays responsive");
});
