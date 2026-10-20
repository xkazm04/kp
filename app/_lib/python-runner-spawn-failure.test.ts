// The runner's OWN failures used to be the only engine outcomes with no code.
//
// The CLI's failures carry one (parseStderrError, PYTHON_ERROR_CODES) and the admission
// refusal carries one (ENGINE_BUSY), but the deadline, the abort, the output ceiling
// and a missing interpreter rejected a plain `Error` whose message embedded
// `args.join(" ")` — the whole command line, jobfit-* temp paths included. Readers
// recovered the one fact they needed (was it the deadline?) with a regex over that
// sentence, and every other reader printed the sentence: analyze-run returned it to
// the recruiter verbatim, the task row stored and rendered it.
//
// So spawnPython now rejects with ONE typed failure, `SpawnFailure extends
// PipelineError`, whose `kind` is the fact and whose message carries no argv (the argv
// goes to the server's ops log). `isSpawnTimeout(err)` replaces the regex, and
// `engineRefusal(err)` lets a route answer the admission overload by its code.
//
// Hermetic: `node` stands in for PYTHON_CMD, metering is off, and the ops log is
// redirected into a temp dir this file reads back.
// Run: node scripts/run-unit-tests.mjs "app/_lib/python-runner-spawn-failure.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const LOG_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-spawn-failure-log-"));
after(() => rmSync(LOG_DIR, { recursive: true, force: true }));

process.env.PYTHON_CMD = process.execPath;
process.env.KP_LLM_USAGE_LOG = "0";
process.env.KP_LOG_DIR = LOG_DIR;
const runner = await import("./python-runner.ts");
const { spawnPython, PipelineError } = runner;
const { isSpawnTimeoutMessage } = await import("./intake-run.ts");
// Read through the namespace so a missing export is a failed assertion, not a link error
// that takes every case in the file down with it.
const SpawnFailure = (runner as Record<string, unknown>).SpawnFailure as
  | (new (...a: never[]) => Error & { kind: string; status: number; code?: string })
  | undefined;
const isSpawnTimeout = (runner as Record<string, unknown>).isSpawnTimeout as ((e: unknown) => boolean) | undefined;
const engineRefusal = (runner as Record<string, unknown>).engineRefusal as
  | ((e: unknown) => { code: string; status: number } | null)
  | undefined;

/** A temp path shaped exactly like a real workdir input, so "no temp path in the
 *  message" is asserted against the thing that actually leaked. */
const SECRET_INPUT = path.join(os.tmpdir(), "jobfit-spawnfailure7q", "recruiter.json");

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => assert.fail("the spawn was expected to reject"),
    (e: unknown) => e,
  );
}

function assertNoArgv(message: string): void {
  assert.ok(!message.includes("jobfit-spawnfailure7q"), `the temp path must not reach the message: ${message}`);
  assert.ok(!message.includes(os.tmpdir()), `no os.tmpdir() path in the message: ${message}`);
  assert.ok(!message.includes("setTimeout"), `the argv (the -e script) must not reach the message: ${message}`);
}

function opsLines(): Record<string, unknown>[] {
  const file = path.join(LOG_DIR, "ops-warn.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("1. the deadline rejects a SpawnFailure of kind 'timeout' at 504, with no argv in its message", async () => {
  assert.ok(SpawnFailure, "python-runner must export SpawnFailure");
  const err = await rejection(
    spawnPython(["-e", "setTimeout(()=>{},2000)", SECRET_INPUT], { timeoutMs: 100 }).result,
  );
  assert.ok(err instanceof SpawnFailure, "a typed failure, not a plain Error");
  assert.ok(err instanceof PipelineError, "…that every PipelineError reader already understands");
  assert.equal(err.kind, "timeout");
  assert.equal(err.status, 504);
  assert.equal(err.code, "timeout");
  assert.equal(err.message, "Python process timed out after 0s");
  assertNoArgv(err.message);
  // The argv did not vanish: it moved to the server's ops log, where an operator reads it.
  const logged = opsLines().find((l) => l.event === "engine:spawn:failed" && l.kind === "timeout");
  assert.ok(logged, "the timeout is logged server-side");
  assert.ok(String(logged.argv).includes("jobfit-spawnfailure7q"), "with the command line the message no longer carries");
});

test("2. the output ceiling rejects kind 'output_overflow' at 500 engine_error, argv-free", async () => {
  assert.ok(SpawnFailure, "python-runner must export SpawnFailure");
  const err = await rejection(
    spawnPython(
      ["-e", "process.stdout.write('x'.repeat(2*1024*1024));setTimeout(()=>{},5000)", SECRET_INPUT],
      { maxBufferBytes: 1024 * 1024, timeoutMs: 15_000 },
    ).result,
  );
  assert.ok(err instanceof SpawnFailure);
  assert.equal(err.kind, "output_overflow");
  assert.equal(err.status, 500);
  assert.equal(err.code, "engine_error");
  assert.match(err.message, /^Python process output exceeded 1 MB and was terminated$/);
  assertNoArgv(err.message);
});

test("3. a missing interpreter rejects kind 'spawn_failed'; the raw ENOENT text goes to the ops log", async () => {
  assert.ok(SpawnFailure, "python-runner must export SpawnFailure");
  const prev = process.env.PYTHON_CMD;
  process.env.PYTHON_CMD = "kp-no-such-python-binary-7q";
  let err: unknown;
  try {
    err = await rejection(spawnPython(["-m", "pipeline.jobfit.cli", SECRET_INPUT], { timeoutMs: 15_000 }).result);
  } finally {
    process.env.PYTHON_CMD = prev;
  }
  assert.ok(err instanceof SpawnFailure, "the child's own 'error' event is typed too");
  assert.equal(err.kind, "spawn_failed");
  assert.equal(err.code, "engine_error");
  assert.ok(!/ENOENT/.test(err.message), `the raw spawn error stays off the message: ${err.message}`);
  assert.ok(!err.message.includes("kp-no-such-python-binary-7q"), "PYTHON_CMD is server configuration");
  assertNoArgv(err.message);
  const logged = opsLines().find((l) => l.event === "engine:spawn:failed" && l.kind === "spawn_failed");
  assert.ok(logged && /ENOENT/.test(String(logged.detail)), "the ENOENT detail reaches the operator's log");
});

test("4. an abort is kind 'aborted' — and only the deadline answers isSpawnTimeout", async () => {
  assert.ok(SpawnFailure && isSpawnTimeout, "python-runner must export SpawnFailure and isSpawnTimeout");
  const controller = new AbortController();
  const running = spawnPython(["-e", "setTimeout(()=>{},5000)", SECRET_INPUT], {
    signal: controller.signal,
    timeoutMs: 15_000,
  }).result;
  setTimeout(() => controller.abort(), 50);
  const aborted = await rejection(running);
  assert.ok(aborted instanceof SpawnFailure);
  assert.equal(aborted.kind, "aborted");
  assert.equal(aborted.message, "Python process aborted");
  assert.equal(isSpawnTimeout(aborted), false);

  // Refused at the door before it ever forked: the same typed abort.
  const pre = new AbortController();
  pre.abort();
  const early = await rejection(spawnPython(["-e", "0"], { signal: pre.signal }).result);
  assert.ok(early instanceof SpawnFailure && early.kind === "aborted", "an already-aborted signal is typed at admission too");

  const timedOut = await rejection(spawnPython(["-e", "setTimeout(()=>{},2000)"], { timeoutMs: 100 }).result);
  assert.equal(isSpawnTimeout(timedOut), true);
  assert.equal(isSpawnTimeout(new Error("Python process timed out after 55s")), false, "a sentence is not a type");
  assert.equal(isSpawnTimeout(null), false);
  // The legacy predicate still matches the kept prefix, so a reader nobody migrated
  // (there are none left in app/ — see the guard below) would not silently break.
  assert.equal(isSpawnTimeoutMessage((timedOut as Error).message), true);
});

test("5. engineRefusal names the admission overload and nothing else", async () => {
  assert.ok(engineRefusal && SpawnFailure, "python-runner must export engineRefusal");
  const prevMax = process.env.KP_PYTHON_MAX_CONCURRENT;
  const prevWait = process.env.KP_PYTHON_QUEUE_WAIT_MS;
  process.env.KP_PYTHON_MAX_CONCURRENT = "1";
  process.env.KP_PYTHON_QUEUE_WAIT_MS = "50";
  let refused: unknown;
  let held: Promise<unknown>;
  try {
    held = spawnPython(["-e", "setTimeout(()=>{},600)"], { timeoutMs: 15_000 }).result;
    refused = await rejection(spawnPython(["-e", "0"], { timeoutMs: 15_000 }).result);
  } finally {
    if (prevMax === undefined) delete process.env.KP_PYTHON_MAX_CONCURRENT;
    else process.env.KP_PYTHON_MAX_CONCURRENT = prevMax;
    if (prevWait === undefined) delete process.env.KP_PYTHON_QUEUE_WAIT_MS;
    else process.env.KP_PYTHON_QUEUE_WAIT_MS = prevWait;
  }
  await held;
  assert.deepEqual(engineRefusal(refused), { code: "ENGINE_BUSY", status: 503 });
  assert.equal(engineRefusal(new Error("The analysis engine is busy right now.")), null, "a plain Error is not the gate");
  assert.equal(
    engineRefusal(new PipelineError({ message: "bad input", status: 400, code: "invalid_input" })),
    null,
    "a CLI refusal is the CLI's to answer",
  );
  const timedOut = await rejection(spawnPython(["-e", "setTimeout(()=>{},2000)"], { timeoutMs: 100 }).result);
  assert.equal(engineRefusal(timedOut), null, "a deadline is not an overload");
});

// ---- the guard ----------------------------------------------------------------
// The regex had SIX readers when this file was written, and the only thing that kept
// them correct was four tests pinning the runner's source text. A seventh reader must
// be a compile-time choice (isSpawnTimeout / err.kind), never a new sentence match.

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) yield full;
  }
}

/** Drop comments so a sentence QUOTED in prose is not mistaken for a reader. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

test("no source reads a spawn failure by its sentence — the kind is the contract", () => {
  const offenders: string[] = [];
  const callers: string[] = [];
  for (const root of ["app", "packages", "edge"].map((d) => path.join(ROOT, d))) {
    if (!existsSync(root)) continue;
    for (const file of sourceFiles(root)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      const body = code(readFileSync(file, "utf-8"));
      // python-runner spells the sentences; intake-run keeps the one @deprecated
      // predicate (its definition, which the callers check below holds at zero use).
      const home = rel === "app/_lib/python-runner.ts" || rel === "app/_lib/intake-run.ts";
      if (!home && /Python process (timed out|aborted|output exceeded)/.test(body)) {
        offenders.push(rel);
      }
      const calls = body.match(/isSpawnTimeoutMessage\(/g)?.length ?? 0;
      const defs = body.match(/function isSpawnTimeoutMessage\(/g)?.length ?? 0;
      if (calls - defs > 0) callers.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "only python-runner.ts may spell its failure sentences");
  assert.deepEqual(callers, [], "read isSpawnTimeout(err) / err.kind, not the legacy message predicate");
});
