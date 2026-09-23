// Admission LANES: background spawns wait their turn, they never refuse themselves.
//
// python-runner admits every spawn through ONE process-wide semaphore. Before lanes it
// had one FIFO waiter list and one 20 s refusal for everybody, a rule written for an
// HTTP request whose client has its own deadline. The task runner's work (a group
// eval's six concurrent reasoning spawns against a ceiling of 4, a background rank, the
// automation clock's pass) went through the same door: a waiter queued behind four LLM
// round-trips was refused ENGINE_BUSY by the engine's OWN gate after 20 s, although the
// task had a fifteen-minute budget. And a recruiter's click that arrived during a
// background fan-out queued FIFO behind every background waiter.
//
// Two named lanes, assigned at ONE authority (the task runner's scope and the clock's
// tick, via withSpawnLane in llm-request-context.ts), never per call site:
//   - interactive (the default, outside any lane scope): today's rule, unchanged.
//   - background: queues BEHIND interactive waiters, may hold at most ceiling-1 slots
//     (never fewer than 1), and waits KP_PYTHON_BACKGROUND_WAIT_MS (a long bound, not
//     an infinite one) instead of the interactive 20 s.
//
// The guard case "no lane scope, ceiling full, the overflow is refused 503 ENGINE_BUSY
// after KP_PYTHON_QUEUE_WAIT_MS" is pinned by python-runner-concurrency.test.ts and is
// deliberately not repeated here.
//
// Hermetic: `node` stands in for PYTHON_CMD, metering is off. Each test keeps its env
// for its WHOLE duration, because the ceiling is read live when a slot is released.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PYTHON_CMD = process.execPath;
process.env.KP_LLM_USAGE_LOG = "0";
const runner = await import("./python-runner.ts");
const ctx = await import("./llm-request-context.ts");
const { spawnPython, pythonSpawnLoad, engineRefusal, SpawnFailure } = runner;

type Lane = "interactive" | "background";
type LaneLoad = { inFlight: number; queued: number };
type LoadWithLanes = { inFlight: number; queued: number; ceiling: number; lanes?: Record<Lane, LaneLoad> };

const withSpawnLane = <T,>(lane: Lane, fn: () => T): T =>
  (ctx as unknown as { withSpawnLane: (l: Lane, f: () => T) => T }).withSpawnLane(lane, fn);
const load = (): LoadWithLanes => pythonSpawnLoad() as LoadWithLanes;
const lane = (l: Lane): LaneLoad | undefined => load().lanes?.[l];

/** A child that stays alive for `ms` and then exits 0 printing a JSON line. */
const sleeper = (ms: number) => `setTimeout(()=>{process.stdout.write('{"ok":true}');},${ms});`;
const spawnSleeper = (ms: number, signal?: AbortSignal) =>
  spawnPython(["-e", sleeper(ms)], { timeoutMs: 20_000, signal }).result;
const settle = <T,>(p: Promise<T>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );

/** Hold `vars` for the whole async body, then restore. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev = Object.keys(vars).map((k) => [k, process.env[k]] as const);
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("six background spawns against a ceiling of 4 all run; none is refused at the interactive bound", async () => {
  await withEnv({ KP_PYTHON_MAX_CONCURRENT: "4", KP_PYTHON_QUEUE_WAIT_MS: "50" }, async () => {
    // The group-eval shape: Promise.all over six reasoning spawns inside the task scope.
    const outcomes = await Promise.all(
      withSpawnLane("background", () => [0, 1, 2, 3, 4, 5].map(() => settle(spawnSleeper(300)))),
    );
    const refused = outcomes.filter((o) => !o.ok);
    assert.equal(refused.length, 0, `no background spawn is refused (got ${refused.map((o) => String(!o.ok && o.e)).join("; ")})`);
    assert.deepEqual(
      outcomes.map((o) => (o.ok ? o.v.exitCode : null)),
      [0, 0, 0, 0, 0, 0],
    );
    assert.deepEqual({ inFlight: load().inFlight, queued: load().queued }, { inFlight: 0, queued: 0 });
  });
});

test("background may hold at most ceiling-1 slots: an interactive spawn is admitted at once beside it", async () => {
  await withEnv({ KP_PYTHON_MAX_CONCURRENT: "4", KP_PYTHON_QUEUE_WAIT_MS: "10000" }, async () => {
    const background = withSpawnLane("background", () => [0, 1, 2, 3, 4].map(() => spawnSleeper(400)));
    assert.deepEqual(lane("background"), { inFlight: 3, queued: 2 }, "three run, two wait for a background slot");
    const interactive = spawnSleeper(50);
    assert.deepEqual(lane("interactive"), { inFlight: 1, queued: 0 }, "the reserved slot is taken without waiting");
    assert.equal(lane("background")?.inFlight, 3);
    assert.equal(load().inFlight, 4, "the ceiling still holds: 3 + 1");
    const results = await Promise.all([...background, interactive]);
    assert.ok(results.every((r) => r.exitCode === 0), "the queued background spawns still run afterwards");
  });
});

test("an interactive waiter is admitted before a background waiter that queued earlier", async () => {
  await withEnv({ KP_PYTHON_MAX_CONCURRENT: "4", KP_PYTHON_QUEUE_WAIT_MS: "10000" }, async () => {
    const stop = new AbortController();
    const short = spawnSleeper(200);
    const long = [0, 1, 2].map(() => settle(spawnSleeper(15_000, stop.signal)));
    const bgWaiter = settle(withSpawnLane("background", () => spawnSleeper(15_000, stop.signal)));
    const intWaiter = settle(spawnSleeper(15_000, stop.signal));
    assert.deepEqual(lane("background"), { inFlight: 0, queued: 1 });
    assert.deepEqual(lane("interactive"), { inFlight: 4, queued: 1 });
    await short; // one slot frees (the runner releases before the caller's await resumes)
    assert.deepEqual(lane("interactive"), { inFlight: 4, queued: 0 }, "the interactive waiter took the freed slot");
    assert.deepEqual(lane("background"), { inFlight: 0, queued: 1 }, "the earlier background waiter is still queued");
    stop.abort();
    await Promise.all([...long, bgWaiter, intWaiter]);
    assert.deepEqual({ inFlight: load().inFlight, queued: load().queued }, { inFlight: 0, queued: 0 });
  });
});

test("a queued background waiter whose signal fires is dropped cleanly and rejects as aborted", async () => {
  await withEnv({ KP_PYTHON_MAX_CONCURRENT: "1", KP_PYTHON_QUEUE_WAIT_MS: "10000" }, async () => {
    const holder = spawnSleeper(500);
    const before = load();
    const controller = new AbortController();
    const waiter = settle(withSpawnLane("background", () => spawnSleeper(10, controller.signal)));
    assert.deepEqual(lane("background"), { inFlight: 0, queued: 1 });
    controller.abort();
    const out = await waiter;
    assert.ok(!out.ok, "the aborted waiter rejects");
    assert.ok(out.e instanceof SpawnFailure && out.e.kind === "aborted");
    assert.equal((out.e as Error).message, "Python process aborted");
    assert.deepEqual({ inFlight: load().inFlight, queued: load().queued }, { inFlight: before.inFlight, queued: before.queued });
    assert.deepEqual(lane("background"), { inFlight: 0, queued: 0 });
    assert.equal((await holder).exitCode, 0);
  });
});

test("the background wait is bounded by KP_PYTHON_BACKGROUND_WAIT_MS, then refused ENGINE_BUSY 503", async () => {
  await withEnv(
    { KP_PYTHON_MAX_CONCURRENT: "1", KP_PYTHON_QUEUE_WAIT_MS: "10000", KP_PYTHON_BACKGROUND_WAIT_MS: "80" },
    async () => {
      const holder = spawnSleeper(1500);
      const started = Date.now();
      const out = await settle(withSpawnLane("background", () => spawnSleeper(10)));
      assert.ok(!out.ok, "a background waiter is not queued forever");
      assert.deepEqual(engineRefusal(out.e), { code: "ENGINE_BUSY", status: 503 });
      assert.ok(Date.now() - started < 1200, "refused at the background bound, not at the holder's exit");
      assert.equal(lane("background")?.queued, 0);
      assert.equal((await holder).exitCode, 0);
    },
  );
});

test("a ceiling of 1 reserves nothing: a lone background spawn on an idle engine is admitted", async () => {
  await withEnv({ KP_PYTHON_MAX_CONCURRENT: "1", KP_PYTHON_QUEUE_WAIT_MS: "50" }, async () => {
    const p = withSpawnLane("background", () => spawnSleeper(50));
    assert.deepEqual(lane("background"), { inFlight: 1, queued: 0 }, "admitted at once, never starved outright");
    assert.equal((await p).exitCode, 0);
  });
});

test("the lane is assigned at the two authorities that know a request's class, and nowhere else", async () => {
  // priority-and-fairness: the class of a request is decided once, where it is known.
  // The task runner wraps every handler; the clock wraps its own pass (a forced
  // "Run now" has an operator waiting and stays interactive). A handler that assigned
  // itself a lane would be a second rule.
  const { readFileSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const lib = path.resolve(import.meta.dirname);
  const tasks = readFileSync(path.join(lib, "tasks.ts"), "utf-8");
  const scheduler = readFileSync(path.join(lib, "scheduler.ts"), "utf-8");
  assert.match(tasks, /withLlmRequestId\(id, \(\) =>\s*withSpawnLane\("background", \(\) =>\s*spec\.run\(/);
  assert.match(scheduler, /opts\?\.force\s*\?\s*runAutomationPass\(\)\s*:\s*withSpawnLane\("background", \(\) => runAutomationPass\(\)\)/);
  const assigners = readdirSync(lib, { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => /withSpawnLane\(/.test(readFileSync(path.join(lib, f), "utf-8")))
    .map((f) => f.split(path.sep).join("/"))
    .sort();
  assert.deepEqual(assigners, ["scheduler.ts", "tasks.ts"]);
});
