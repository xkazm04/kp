// The two things spawnPython never did: COUNT its interpreters, and kill what they
// started.
//
// 1. ADMISSION. Every request that needed the engine forked its own CPython with
//    nothing bounding the total, so a burst of analyze/match/devcase calls was a burst
//    of ~150 MB interpreters and the failure mode was the Node server being starved —
//    every route down, not just the one that overcommitted. A process-wide semaphore
//    now admits `KP_PYTHON_MAX_CONCURRENT` at a time and REFUSES the overflow with a
//    503 ENGINE_BUSY after a bounded wait, rather than queueing sockets whose clients
//    have already given up.
// 2. THE KILL. `child.kill()` signals ONE pid. The CLIs shell out (the Claude CLI
//    adapter, `git` in a repo scan), so a timeout or an abandoned request killed the
//    interpreter and left the grandchild running — holding the CPU and the provider
//    connection the kill was meant to reclaim. killProcessTree signals the whole group
//    (POSIX `detached` + negative pid) or the whole tree (Windows `taskkill /T /F`).
//
// Hermetic: `node` stands in for PYTHON_CMD, so no Python toolchain and no DB. Metering
// is switched off (KP_LLM_USAGE_LOG=0) so nothing here touches the llm_usage ledger.
//
// RED-FIRST: with the semaphore removed, the first test sees inFlight 4 / queued 0 and
// the second resolves instead of rejecting; with killProcessTree reverted to
// `child.kill("SIGKILL")`, the third test's grandchild is still alive after the abort.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PYTHON_CMD = process.execPath;
process.env.KP_LLM_USAGE_LOG = "0";
const { spawnPython, pythonSpawnLoad, PipelineError, ENGINE_BUSY_CODE } = await import("./python-runner.ts");

/** A child that stays alive for `ms` and then exits 0 printing a JSON line. */
const sleeper = (ms: number) => `setTimeout(()=>{process.stdout.write('{"ok":true}');},${ms});`;

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const prev = Object.entries(vars).map(([k]) => [k, process.env[k]] as const);
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("spawnPython admits at most KP_PYTHON_MAX_CONCURRENT interpreters and queues the rest", async () => {
  // The env has to still be in place when the ceiling is READ — maxConcurrentSpawns()
  // reads it live, so restoring first would report the default instead of the 2 the
  // spawns were admitted under.
  const { running, load } = withEnv({ KP_PYTHON_MAX_CONCURRENT: "2", KP_PYTHON_QUEUE_WAIT_MS: "10000" }, () => {
    const promises = [0, 1, 2, 3].map(() => spawnPython(["-e", sleeper(120)], { timeoutMs: 15_000 }).result);
    // acquireSlot runs synchronously inside spawnPython, so the ceiling is observable the
    // moment the four calls return: two forked, two waiting at the door.
    return { running: promises, load: pythonSpawnLoad() };
  });
  assert.equal(load.ceiling, 2, "the ceiling comes from KP_PYTHON_MAX_CONCURRENT");
  assert.equal(load.inFlight, 2, "only two interpreters may exist at once");
  assert.equal(load.queued, 2, "the overflow waits for a slot instead of forking");

  const results = await Promise.all(running);
  assert.deepEqual(
    results.map((r) => r.exitCode),
    [0, 0, 0, 0],
    "every queued spawn eventually runs — the ceiling delays, it does not drop",
  );
  assert.deepEqual(
    { inFlight: pythonSpawnLoad().inFlight, queued: pythonSpawnLoad().queued },
    { inFlight: 0, queued: 0 },
    "slots are released on settle, so the ceiling is not leaked away one spawn at a time",
  );
});

test("a spawn that waits out the queue budget is refused with a 503 ENGINE_BUSY PipelineError", async () => {
  const [held, refused] = withEnv({ KP_PYTHON_MAX_CONCURRENT: "1", KP_PYTHON_QUEUE_WAIT_MS: "120" }, () => [
    spawnPython(["-e", sleeper(1200)], { timeoutMs: 15_000 }).result,
    spawnPython(["-e", sleeper(10)], { timeoutMs: 15_000 }).result,
  ]);
  const err = await refused.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(err instanceof PipelineError, "the overflow is refused as a PipelineError, not a generic Error");
  assert.equal(err.status, 503, "503 — the engine is saturated, the request is not malformed");
  assert.equal(err.code, ENGINE_BUSY_CODE, "and it carries the machine code the routes forward");
  // The holder still finishes normally: the refusal is admission control, not a kill.
  assert.equal((await held).exitCode, 0);
  assert.equal(pythonSpawnLoad().inFlight, 0, "the refused waiter never took a slot");
});

test("an aborted spawn kills the whole process tree, not just the direct child", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-tree-"));
  const marker = path.join(dir, "grandchild.pid");
  try {
    // The child forks TWO grandchildren, records their pids where the test can read
    // them, then stays alive so only the abort ends it.
    //
    //   plain — the shape of the Claude-CLI / git shell-outs. On POSIX it inherits the
    //     child's process group, so it dies with `kill(-pid)`; nothing else reaps it,
    //     and before this change it was re-parented to init and outlived the request.
    //   loose — a grandchild that detaches itself (a CLI that daemonizes, or anything
    //     that calls setsid). MEASURED on this Windows: a direct `child.kill()` leaves
    //     it running and `taskkill /T /F` reaps it, so it is what gives the Windows arm
    //     of this test teeth — the plain one dies either way here, because this
    //     Node/Windows already propagates a kill to a non-detached descendant.
    //     Asserted on win32 ONLY: on POSIX a detached grandchild is its own group
    //     leader by definition and is deliberately outside what a group kill can reach.
    const script =
      "const{spawn}=require('node:child_process'),fs=require('node:fs');" +
      "const mk=o=>spawn(process.execPath,['-e','setTimeout(()=>{},600000)'],o);" +
      "const plain=mk({stdio:'ignore'});" +
      "const loose=mk({stdio:'ignore',detached:true});loose.unref();" +
      "fs.writeFileSync(process.argv[1],plain.pid+' '+loose.pid);setTimeout(()=>{},600000);";
    const controller = new AbortController();
    const { result } = spawnPython(["-e", script, marker], { signal: controller.signal, timeoutMs: 20_000 });
    const settled = result.then(
      () => null,
      (e: unknown) => e,
    );

    const deadline = Date.now() + 10_000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(existsSync(marker), "the child must have forked its grandchildren before we abort");
    const pids = readFileSync(marker, "utf-8").trim().split(" ").map(Number);
    assert.equal(pids.length, 2);
    assert.ok(
      pids.every((n) => Number.isInteger(n) && n > 0),
      "two real grandchild pids",
    );
    for (const pid of pids) assert.doesNotThrow(() => process.kill(pid, 0), `grandchild ${pid} is alive before the abort`);

    controller.abort();
    const err = await settled;
    assert.ok(err instanceof Error && /aborted/i.test(err.message), "the abort rejects the spawn");

    // The reap is asynchronous on both platforms (a signal to a group; a taskkill child
    // on Windows), so poll rather than assume it landed by the time the promise settled.
    const reaped = async (pid: number): Promise<boolean> => {
      const deadlineMs = Date.now() + 10_000;
      for (;;) {
        try {
          process.kill(pid, 0);
        } catch {
          return true; // ESRCH — gone, which is the whole assertion
        }
        if (Date.now() >= deadlineMs) return false;
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const [plainPid, loosePid] = pids;
    try {
      assert.equal(
        await reaped(plainPid),
        true,
        "the grandchild must die with the child, not outlive the request that started it",
      );
      if (process.platform === "win32") {
        assert.equal(await reaped(loosePid), true, "taskkill /T /F must reach a grandchild that detached itself");
      }
    } finally {
      // On POSIX the loose grandchild is deliberately out of scope for the group kill —
      // reap it here so the test leaves no 10-minute process behind.
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already reaped by the tree kill, which is the expected path */
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
